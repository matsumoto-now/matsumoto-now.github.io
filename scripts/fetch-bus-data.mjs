#!/usr/bin/env node
/**
 * Matsumoto city-bus network (ぐるっとまつもとバス) → public/data/bus.json
 *
 * Sources: the two Matsumoto City GTFS-JP feeds on the GTFS data repository
 * (gtfs-data.jp), CC BY 4.0. The uid-less API URLs always resolve to the
 * currently valid feed version, so there is nothing to pin:
 *   https://api.gtfs-data.jp/v2/organizations/matsumotocity/feeds/<feed>/files/...
 *
 * Route shapes come from routes.geojson, enriched with per-route colors from
 * routes.txt and English stop names from translations.txt inside feed.zip.
 * Geometry is simplified (Douglas-Peucker) — for a city overview map, not
 * navigation. Feeds change a few times a year; run monthly.
 *
 * Run: node scripts/fetch-bus-data.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';

const OUT = path.join(process.cwd(), 'public/data/bus.json');
const OUT_TIMES = path.join(process.cwd(), 'public/data/bus-times.json');
const API = 'https://api.gtfs-data.jp/v2/organizations/matsumotocity/feeds';
const FEEDS = [
  { id: 'guruttomatsumotobus1', key: 'station' }, // lines from Matsumoto Sta. / bus terminal
  { id: 'guruttomatsumotobus2', key: 'regional' }, // Town Sneaker + regional community lines
];

const UA = { 'user-agent': 'matsumoto-now/1.0 (community dashboard; monthly fetch)' };

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return as === 'json' ? res.json() : new Uint8Array(await res.arrayBuffer());
}

/** Minimal quote-aware CSV: GTFS text files, one record per line. */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const parseLine = (line) => {
    const fields = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') fields.push(cur), (cur = '');
      else cur += ch;
    }
    fields.push(cur);
    return fields;
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const f = parseLine(l);
    return Object.fromEntries(header.map((h, i) => [h, f[i] ?? '']));
  });
}

/* ---- geometry ----------------------------------------------------------- */

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Douglas-Peucker on [lon, lat] points; tolerance in degrees (~5e-5 ≈ 5 m). */
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const sqTol = tol * tol;
  const sqSegDist = (p, a, b) => {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0];
        y = b[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let idx = 0;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > sqTol) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** GTFS-derived MultiLineStrings arrive chopped into many short segments;
 *  stitch consecutive ones back together so simplification can work. */
function stitch(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev) {
      const [lastLon, lastLat] = prev[prev.length - 1];
      const [firstLon, firstLat] = line[0];
      if (lastLon === firstLon && lastLat === firstLat) {
        prev.push(...line.slice(1));
        continue;
      }
    }
    out.push([...line]);
  }
  return out;
}

/* ---- per-line timetable PDFs (city page) --------------------------------- */

const CITY_BUS_PAGE = 'https://www.city.matsumoto.nagano.jp/soshiki/222/3237.html';

/** The city publishes one timetable PDF and one fare PDF per line, but every
 *  link is labelled the same ("時刻表（R8.3.14～）") — the line name is in the
 *  <h5> above the list. The attachment IDs change at each timetable revision,
 *  so the mapping is scraped here rather than hardcoded.
 *
 *  Returns Map(routeName -> { timetable, fare }); empty on any failure, in
 *  which case the page falls back to linking the city page as a whole. */
async function fetchLinePdfs() {
  const strip = (s) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|​|　/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
  const out = new Map();
  try {
    const res = await fetch(CITY_BUS_PAGE, { headers: UA, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    // sections: <h5>line name</h5> … up to the next heading of any level
    const parts = html.split(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/);
    for (let i = 1; i < parts.length; i += 3) {
      if (parts[i] !== '5') continue;
      const body = parts[i + 2];
      const pick = (label) => {
        const links = [...body.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)];
        const hit = links.find((m) => strip(m[2]).includes(label));
        return hit ? new URL(hit[1], CITY_BUS_PAGE).href : null;
      };
      const timetable = pick('時刻表');
      if (!timetable) continue;
      const fare = pick('運賃表');
      // one heading can cover several lines ("空港今井線、大久保工場団地・神林線")
      for (const name of strip(parts[i + 1]).split(/[、,]/)) {
        const key = name.trim();
        if (key) out.set(key, { timetable, fare });
      }
    }
  } catch (err) {
    console.warn(`per-line timetables unavailable (${err.message}) — linking the city page only`);
    return new Map();
  }
  return out;
}

/* ---- romaji ------------------------------------------------------------- */

/** Line names have no translation in the feeds (stops do, via
 *  translations.txt), so non-Japanese readers get a hand-kept Hepburn reading.
 *  A new or renamed line simply shows without one until added here. */
const ROUTE_ROMAJI = {
  信大横田循環線: 'Shindai–Yokota Loop',
  横田信大循環線: 'Yokota–Shindai Loop',
  浅間線: 'Asama Line',
  新浅間線: 'Shin-Asama Line',
  美ヶ原温泉線: 'Utsukushigahara Onsen Line',
  北市内線: 'Kita-Shinai Line',
  岡田線: 'Okada Line',
  アルプス公園線: 'Alps Kōen Line',
  鹿教湯温泉線: 'Kakeyu Onsen Line',
  空港今井線: 'Kūkō–Imai Line',
  '大久保工場団地・神林線': 'Ōkubo Kōjō Danchi–Kambayashi Line',
  山形線: 'Yamagata Line',
  寿台線: 'Kotobukidai Line',
  松原線: 'Matsubara Line',
  内田線: 'Uchida Line',
  並柳団地線: 'Namiyanagi Danchi Line',
  四賀線: 'Shiga Line',
  タウンスニーカー北コース: 'Town Sneaker North',
  タウンスニーカー東コース: 'Town Sneaker East',
  タウンスニーカー南コース: 'Town Sneaker South',
  南部循環線: 'Nambu Loop',
  合庁ライナー: 'Gōchō Liner',
  '松本・島内線': 'Matsumoto–Shimauchi Line',
  '南松本・山形線': 'Minami-Matsumoto–Yamagata Line',
  '梓川・波田線': 'Azusagawa–Hata Line',
  '村井・山形線': 'Murai–Yamagata Line',
  '朝日・波田線': 'Asahi–Hata Line',
  '奈川・安曇線': 'Nagawa–Azumi Line',
  四賀循環線: 'Shiga Loop',
  波田循環バス: 'Hata Loop Bus',
  ほしみ線: 'Hoshimi Line',
  入山辺線: 'Iriyamabe Line',
  中山線: 'Nakayama Line',
  '浅間・大村線': 'Asama–Ōmura Line',
};

/** Landmarks the headsigns name ("松本城経由…") that are not stop names. */
const PLACE_ROMAJI = {
  松本駅: 'Matsumoto Sta.',
  松本城: 'Matsumoto Castle',
  並柳団地: 'Namiyanagi Danchi',
  秀峰学校: 'Shuho Gakko',
  信州大学: 'Shinshu University',
  イオンモール: 'AEON Mall',
  あがたの森: 'Agatanomori',
  旧開智学校: 'Former Kaichi School',
};

/* ---- main --------------------------------------------------------------- */

/** "HH:MM:SS" → minutes since midnight (GTFS allows hours ≥ 24 for
 *  after-midnight departures of the previous service day). */
function toMinutes(hms) {
  const [h, m] = hms.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

async function main() {
  const linePdfs = await fetchLinePdfs();
  const routes = [];
  const stopsByKey = new Map();

  // departure-times sidecar (bus-times.json), aligned to the stops order
  const timeRouteNames = [];
  const timeRouteIdx = new Map(); // route display name -> index
  const services = [];
  const serviceIdx = new Map(); // `${feed}:${service_id}` -> index
  const stopDepartures = []; // clusterIdx -> Map("r|s|h" -> minutes[])
  const headsigns = []; // { name, en } — where a trip is heading (its direction)
  const headsignIdx = new Map(); // headsign name -> index
  const nextCounts = new Map(); // "cluster|r|h" -> Map(next-stops key -> trips)
  const loopRoutes = new Set(); // route indices
  const rideTimes = new Map(); // "cluster|r|h" -> minutes to the line's end, per trip
  const clusterNames = []; // cluster index -> stop name
  const NEXT_STOPS = 3;

  for (const feed of FEEDS) {
    const base = `${API}/${feed.id}/files`;
    const [routesGeo, stopsGeo, zipBuf] = await Promise.all([
      get(`${base}/routes.geojson`),
      get(`${base}/stops.geojson`),
      get(`${base}/feed.zip`, 'buffer'),
    ]);

    const zip = unzipSync(zipBuf);
    const dec = new TextDecoder('utf-8');
    const routesTxt = parseCsv(dec.decode(zip['routes.txt']));
    const translations = parseCsv(dec.decode(zip['translations.txt']));

    const colorById = new Map(
      routesTxt.map((r) => [r.route_id, r.route_color ? `#${r.route_color}` : null]),
    );
    const enByStopId = new Map(
      translations
        .filter((t) => t.table_name === 'stops' && t.field_name === 'stop_name' && t.language === 'en')
        .map((t) => [t.record_id, t.translation]),
    );

    for (const f of routesGeo.features) {
      const lines =
        f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      // the feed repeats each route's shape once per trip — keep unique segments only
      const seen = new Set();
      const unique = lines.filter((line) => {
        const key = JSON.stringify(line);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const paths = stitch(unique)
        .map((line) => simplify(line, 5e-5).map(([lon, lat]) => [round5(lat), round5(lon)]))
        .filter((line) => line.length >= 2);
      if (!paths.length) continue;
      const name = f.properties.route_name;
      const pdfs = linePdfs.get(name);
      routes.push({
        name,
        romaji: ROUTE_ROMAJI[name] ?? null,
        color: colorById.get(f.properties.id) ?? null,
        feed: feed.key,
        timetable: pdfs?.timetable ?? null,
        fare: pdfs?.fare ?? null,
        paths,
      });
    }

    const clusterByStopId = new Map(); // this feed's stop_id -> cluster index
    for (const f of stopsGeo.features) {
      const [lon, lat] = f.geometry.coordinates;
      const name = f.properties.stop_name;
      // one marker per named stop cluster (multiple poles share a name nearby)
      const key = `${name}|${lat.toFixed(3)},${lon.toFixed(3)}`;
      if (!stopsByKey.has(key)) {
        stopsByKey.set(key, {
          idx: stopsByKey.size,
          name,
          nameEn: enByStopId.get(f.properties.stop_id) ?? null,
          lat: round5(lat),
          lon: round5(lon),
        });
        stopDepartures.push(new Map());
        clusterNames.push(name);
      }
      clusterByStopId.set(f.properties.stop_id, stopsByKey.get(key).idx);
    }

    /* ---- departure times (stop_times + trips + calendar) ---- */
    const trips = parseCsv(dec.decode(zip['trips.txt']));
    const calendar = parseCsv(dec.decode(zip['calendar.txt']));
    const calDates = zip['calendar_dates.txt'] ? parseCsv(dec.decode(zip['calendar_dates.txt'])) : [];
    const nameByRouteId = new Map(
      routesTxt.map((r) => [r.route_id, r.route_long_name || r.route_short_name || r.route_id]),
    );

    for (const c of calendar) {
      const key = `${feed.id}:${c.service_id}`;
      if (serviceIdx.has(key)) continue;
      serviceIdx.set(key, services.length);
      services.push({
        days: [c.sunday, c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday].map(
          (v) => v === '1',
        ),
        start: c.start_date,
        end: c.end_date,
        add: [],
        del: [],
      });
    }
    for (const cd of calDates) {
      const key = `${feed.id}:${cd.service_id}`;
      if (!serviceIdx.has(key)) {
        // service defined only via calendar_dates
        serviceIdx.set(key, services.length);
        services.push({ days: [false, false, false, false, false, false, false], start: '19000101', end: '20991231', add: [], del: [] });
      }
      const svc = services[serviceIdx.get(key)];
      (cd.exception_type === '1' ? svc.add : svc.del).push(cd.date);
    }

    // headsigns are stop names: borrow the stop's English name
    const enByStopName = new Map();
    for (const f of stopsGeo.features) {
      const en = enByStopId.get(f.properties.stop_id);
      if (en && !enByStopName.has(f.properties.stop_name)) enByStopName.set(f.properties.stop_name, en);
    }
    // the feeds spell ヶ and ケ interchangeably (美ヶ原 / 美ケ原)
    const enOf = (name) =>
      PLACE_ROMAJI[name] ?? enByStopName.get(name) ?? enByStopName.get(name.replace(/ケ/g, 'ヶ')) ?? null;
    // "A-B経由C": keyed by the whole string (A-B-C and C alone are different
    // runs), but only the destination C is shown — the next stops, computed
    // below, say which way the bus goes far more plainly than "via"
    const headsignOf = (name) => {
      if (!headsignIdx.has(name)) {
        const dest = name.includes('経由') ? name.split('経由').pop() : name;
        headsignIdx.set(name, headsigns.length);
        headsigns.push({ name: dest, en: enOf(dest) });
      }
      return headsignIdx.get(name);
    };

    const tripInfo = new Map(
      trips.map((tr) => [
        tr.trip_id,
        {
          route: nameByRouteId.get(tr.route_id) ?? tr.route_id,
          service: serviceIdx.get(`${feed.id}:${tr.service_id}`),
          headsign: tr.trip_headsign || '',
        },
      ]),
    );
    const stopTimes = parseCsv(dec.decode(zip['stop_times.txt']));
    // a trip's final stop is an arrival, not a departure anyone can board
    const lastSeq = new Map();
    for (const st of stopTimes) {
      const seq = Number(st.stop_sequence);
      if (!(lastSeq.get(st.trip_id) >= seq)) lastSeq.set(st.trip_id, seq);
    }
    const tripRows = new Map(); // trip -> [{ seq, cluster, key }]
    for (const st of stopTimes) {
      const info = tripInfo.get(st.trip_id);
      const cluster = clusterByStopId.get(st.stop_id);
      if (info && cluster !== undefined) {
        if (!tripRows.has(st.trip_id)) tripRows.set(st.trip_id, []);
        const h = headsignOf(st.stop_headsign || info.headsign);
        tripRows.get(st.trip_id).push({
          seq: Number(st.stop_sequence),
          cluster,
          h,
          route: info.route,
          min: toMinutes(st.arrival_time || st.departure_time || ''),
        });
      }
      if (st.pickup_type === '1') continue; // drop-off only, no boarding
      if (Number(st.stop_sequence) === lastSeq.get(st.trip_id)) continue;
      const minutes = toMinutes(st.departure_time || st.arrival_time || '');
      if (!info || info.service === undefined || cluster === undefined || minutes === null) continue;
      if (!timeRouteIdx.has(info.route)) {
        timeRouteIdx.set(info.route, timeRouteNames.length);
        timeRouteNames.push(info.route);
      }
      // the stop-level headsign tells a loop's outbound leg from its return
      // (trip_headsign is the loop's end, the same for both)
      const headsign = headsignOf(st.stop_headsign || info.headsign);
      const rs = `${timeRouteIdx.get(info.route)}|${info.service}|${headsign}`;
      const bucket = stopDepartures[cluster];
      if (!bucket.has(rs)) bucket.set(rs, []);
      bucket.get(rs).push(minutes);
    }

    // per stop × line × direction: the next few stops the bus serves (the
    // most common sequence across trips) — the plainest way to show which
    // way a bus goes; and which lines are loops (end where they start)
    const nameOf = (cluster) => clusterNames[cluster];
    for (const rows of tripRows.values()) {
      rows.sort((a, b) => a.seq - b.seq);
      const r = timeRouteIdx.get(rows[0].route);
      if (r === undefined) continue;
      if (nameOf(rows[0].cluster) === nameOf(rows[rows.length - 1].cluster)) loopRoutes.add(r);
      for (let i = 0; i < rows.length - 1; i++) {
        const next = [];
        for (let j = i + 1; j < rows.length && next.length < NEXT_STOPS; j++) {
          const c = rows[j].cluster;
          if (nameOf(c) !== nameOf(next.at(-1) ?? rows[i].cluster)) next.push(c);
        }
        const key = `${rows[i].cluster}|${r}|${rows[i].h}`;
        if (!nextCounts.has(key)) nextCounts.set(key, new Map());
        const counts = nextCounts.get(key);
        const nk = next.join(',');
        counts.set(nk, (counts.get(nk) ?? 0) + 1);
        // ride time to the shown destination (the first later stop of that
        // name, else the trip's end): on a loop, this is what tells the
        // short way from the way round
        const destName = headsigns[rows[i].h].name;
        const dest = rows.slice(i + 1).find((x) => nameOf(x.cluster) === destName) ?? rows[rows.length - 1];
        const end = dest.min;
        if (end !== null && rows[i].min !== null) {
          if (!rideTimes.has(key)) rideTimes.set(key, []);
          rideTimes.get(key).push(end - rows[i].min);
        }
      }
    }

    console.log(`${feed.id}: ${routesGeo.features.length} routes, ${stopsGeo.features.length} stop poles, ${stopTimes.length} stop_times`);
  }

  const out = {
    fetched: new Date().toISOString(),
    attribution: '松本市 (Matsumoto City), CC BY 4.0, via GTFSデータリポジトリ (gtfs-data.jp)',
    routes,
    stops: [...stopsByKey.values()].map(({ idx, ...stop }) => stop),
  };
  await writeFile(OUT, JSON.stringify(out) + '\n');
  const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
  console.log(`wrote ${OUT}: ${routes.length} routes, ${stopsByKey.size} stops, ${kb} KB`);
  const noPdf = routes.filter((r) => !r.timetable).map((r) => r.name);
  console.log(
    `per-line timetables: ${routes.length - noPdf.length}/${routes.length}` +
      (noPdf.length ? ` (no match: ${noPdf.join(', ')})` : ''),
  );

  // sidecar: departures per stop, aligned to the stops array order above
  const times = {
    fetched: out.fetched,
    routes: timeRouteNames,
    routesRomaji: timeRouteNames.map((n) => ROUTE_ROMAJI[n] ?? null),
    routesLoop: timeRouteNames.map((_, i) => loopRoutes.has(i)),
    headsigns,
    services,
    stops: stopDepartures.map((bucket, cluster) =>
      [...bucket.entries()].map(([rs, minutes]) => {
        const [r, s, h] = rs.split('|').map(Number);
        const counts = nextCounts.get(`${cluster}|${r}|${h}`);
        const best = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : '';
        const next = best ? best.split(',').map(Number) : [];
        const rides = (rideTimes.get(`${cluster}|${r}|${h}`) ?? []).sort((a, b) => a - b);
        const ride = rides.length ? rides[Math.floor(rides.length / 2)] : null; // median
        return [r, s, h, minutes.sort((a, b) => a - b), next, ride];
      }),
    ),
  };
  await writeFile(OUT_TIMES, JSON.stringify(times) + '\n');
  const tkb = Math.round(Buffer.byteLength(JSON.stringify(times)) / 1024);
  console.log(`wrote ${OUT_TIMES}: ${services.length} services, ${tkb} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
