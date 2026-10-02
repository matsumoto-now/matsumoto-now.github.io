/** Buses page: city bus routes & stops (GTFS open data, pre-processed by
 *  scripts/fetch-bus-data.mjs into /data/bus.json) on GSI tiles. */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import { chartMessage } from './chart';
import { addLocateControl } from './geolocate';
import { combobox, escapeHtml, fold } from './combobox';
import { addExpandControl, mapError } from './map-expand';

const MATSUMOTO: [number, number] = [36.238, 137.972];
const STOP_MIN_ZOOM = 14;

interface BusRoute {
  name: string;
  /** Hepburn reading, hand-kept in the fetch script; null for unknown lines */
  romaji: string | null;
  color: string | null;
  feed: 'station' | 'regional';
  /** the city's own timetable / fare PDF for this line (Japanese), when the
   *  monthly scrape matched it; null falls back to the city page as a whole */
  timetable: string | null;
  fare: string | null;
  paths: [number, number][][];
}

interface BusStop {
  name: string;
  nameEn: string | null;
  lat: number;
  lon: number;
}

interface BusFile {
  fetched: string;
  attribution: string;
  routes: BusRoute[];
  stops: BusStop[];
}

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Romanized name with the Japanese kept alongside (it is what the bus
 *  displays and the stop signs show); Japanese only for ja readers. */
function bilingual(ja: string, latin: string | null | undefined, lang: Lang): string {
  if (lang === 'ja' || !latin) return ja;
  return `${latin}（${ja}）`;
}

function stopLabel(stop: BusStop, lang: Lang): string {
  return bilingual(stop.name, stop.nameEn, lang);
}

function routeLabel(route: BusRoute, lang: Lang): string {
  return bilingual(route.name, route.romaji, lang);
}

/** Same as bilingual(), as DOM: the Japanese is secondary, so it is set
 *  smaller and muted and wraps on its own when space runs out. */
function bilingualNode(ja: string, latin: string | null | undefined, lang: Lang): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (lang === 'ja' || !latin) {
    frag.append(ja);
    return frag;
  }
  frag.append(latin, ' ');
  frag.appendChild(make('span', 'jp', ja));
  return frag;
}

const narrow = () => window.matchMedia('(max-width: 640px)').matches;

/* ---- next departures (bus-times.json sidecar, loaded on first stop click) --- */

interface BusService {
  days: boolean[]; // [sun..sat]
  start: string; // YYYYMMDD
  end: string;
  add: string[]; // extra service dates (holidays etc.)
  del: string[]; // removed dates
}

interface BusTimes {
  routes: string[];
  routesRomaji: (string | null)[];
  /** lines that end where they start: both "directions" share a destination */
  routesLoop: boolean[];
  /** where a trip is heading: tells the two directions apart */
  headsigns: { name: string; en: string | null }[];
  services: BusService[];
  // per stop: [routeIdx, serviceIdx, headsignIdx, minutes[], next stop
  // indices, typical minutes to the destination]
  stops: [number, number, number, number[], number[], number | null][][];
}

let timesPromise: Promise<BusTimes | null> | null = null;
function loadTimes(): Promise<BusTimes | null> {
  if (!timesPromise) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    timesPromise = fetch(`${base}/data/bus-times.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<BusTimes>) : null))
      .catch(() => null);
  }
  return timesPromise;
}

interface ServiceDay {
  date: string; // YYYYMMDD
  day: number; // 0 = Sunday
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function jstNow(): ServiceDay & { minutes: number } {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`,
    day: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** "YYYY-MM-DD" (date input) → service day */
function serviceDay(iso: string): ServiceDay {
  const [y, m, d] = iso.split('-').map(Number);
  return { date: `${y}${pad2(m)}${pad2(d)}`, day: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

const toIso = (yyyymmdd: string) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

function serviceRuns(svc: BusService, on: ServiceDay): boolean {
  if (svc.del.includes(on.date)) return false;
  if (svc.add.includes(on.date)) return true;
  return svc.days[on.day] === true && svc.start <= on.date && on.date <= svc.end;
}

const fmtTime = (min: number) => `${Math.floor(min / 60)}:${pad2(min % 60)}`;

/** Same-name stop clusters close together: the poles on either side of the
 *  road (one per direction) usually land in separate clusters. */
function siblingStops(file: BusFile, stopIdx: number): number[] {
  const stop = file.stops[stopIdx];
  const out: number[] = [];
  file.stops.forEach((s, i) => {
    if (s.name === stop.name && Math.abs(s.lat - stop.lat) < 0.004 && Math.abs(s.lon - stop.lon) < 0.005)
      out.push(i);
  });
  return out;
}

interface Direction {
  /** unique per line × headsign: loops share a destination name both ways */
  key: string;
  route: [string, string | null]; // [ja, romaji]
  loop: boolean;
  headsign: [string, string | null];
  /** the next few stops after this one: what tells two directions apart */
  next: number[];
  /** typical ride to the destination, minutes */
  ride: number | null;
  minutes: number[];
}

/** Departures on one day at a group of stops, one entry per line × direction. */
function departuresOn(times: BusTimes, stopIndices: number[], on: ServiceDay, lang: Lang): Direction[] {
  const groups = new Map<
    string,
    { r: number; h: number; next: number[]; ride: number | null; minutes: Set<number> }
  >();
  for (const stopIdx of stopIndices) {
    for (const [r, s, h, minutes, next, ride] of times.stops[stopIdx] ?? []) {
      const svc = times.services[s];
      if (!svc || !serviceRuns(svc, on)) continue;
      const key = `${r}|${h}`;
      if (!groups.has(key)) groups.set(key, { r, h, next: next ?? [], ride: ride ?? null, minutes: new Set() });
      const g = groups.get(key)!;
      for (const min of minutes) g.minutes.add(min);
    }
  }
  return [...groups.values()]
    .map(({ r, h, next, ride, minutes }) => ({
      key: `${r}|${h}`,
      route: [times.routes[r] ?? '', times.routesRomaji?.[r] ?? null] as [string, string | null],
      loop: times.routesLoop?.[r] === true,
      next,
      ride,
      headsign: [times.headsigns[h]?.name ?? '', times.headsigns[h]?.en ?? null] as [string, string | null],
      minutes: [...minutes].sort((a, b) => a - b),
    }))
    .sort(
      (a, b) =>
        bilingual(...a.route, lang).localeCompare(bilingual(...b.route, lang)) ||
        bilingual(...a.headsign, lang).localeCompare(bilingual(...b.headsign, lang)),
    );
}

/** Short stop name for "next stops": one script only, it is a list. */
function shortStop(file: BusFile, idx: number, lang: Lang): string {
  const stop = file.stops[idx];
  return lang === 'ja' || !stop ? (stop?.name ?? '') : (stop.nameEn ?? stop.name);
}

const lineColor = (file: BusFile, routeName: string): string =>
  file.routes.find((r) => r.name === routeName)?.color ?? 'var(--series-1)';

/** Line name with its map colour, and a loop badge when it runs in a circle. */
function lineName(file: BusFile, d: Direction, lang: Lang, t: (k: UIKey) => string): HTMLElement {
  const el = make('div', 'line-name');
  const dot = make('span', 'dot');
  dot.style.background = lineColor(file, d.route[0]);
  el.appendChild(dot);
  el.appendChild(make('span')).appendChild(bilingualNode(...d.route, lang));
  if (d.loop) {
    const badge = make('span', 'loop-badge', `↻ ${t('bus.loop')}`);
    badge.title = t('bus.loopNote');
    el.appendChild(badge);
  }
  return el;
}

/** Among directions of one line that end at the same place (a loop, both
 *  ways round), the quicker one; null when nothing needs telling apart. */
function fastestOf(ds: Direction[]): Direction | null {
  let best: Direction | null = null;
  for (const d of ds) {
    const twin = ds.some((o) => o !== d && o.headsign[0] === d.headsign[0]);
    if (!twin || d.ride === null) continue;
    const rivals = ds.filter((o) => o.headsign[0] === d.headsign[0] && o !== d);
    if (rivals.every((o) => o.ride === null || o.ride > d.ride!)) best = d;
  }
  return best;
}

/** "Direction: X", how long it takes, and the stops the bus calls at next. */
function directionBlock(
  file: BusFile,
  d: Direction,
  lang: Lang,
  t: (k: UIKey) => string,
  opts: { big?: boolean; fastest?: boolean } = {},
): HTMLElement {
  const box = make('div', opts.big ? 'dir dir-big' : 'dir');
  box.appendChild(make('div', 'dir-label', t('bus.directionTo').replace(/\s*[:：]\s*$/, '')));
  const dest = make('div', 'dir-dest');
  dest.appendChild(make('strong')).appendChild(bilingualNode(...d.headsign, lang));
  if (opts.fastest) dest.appendChild(make('span', 'fast-badge', `⚡ ${t('bus.fastest')}`));
  box.appendChild(dest);
  if (d.ride !== null && d.ride > 0) {
    box.appendChild(make('div', 'dir-ride', `🕒 ${t('bus.rideTime').replace('{min}', String(d.ride))}`));
  }
  if (d.next.length) {
    const next = make('div', 'dir-next');
    next.appendChild(make('span', 'dir-next-label', t('bus.nextStops').replace(/\s*[:：]\s*$/, '')));
    const list = make('span', 'dir-next-list');
    d.next.forEach((idx, n) => {
      if (n) list.appendChild(make('span', 'dir-arrow', '›'));
      list.appendChild(make('span', undefined, shortStop(file, idx, lang)));
    });
    next.appendChild(list);
    box.appendChild(next);
  }
  return box;
}

function departuresContent(
  file: BusFile,
  stopIdx: number,
  lang: Lang,
  t: (k: UIKey) => string,
  timetable: TimetableControl | null,
  onFilled: () => void,
): HTMLElement {
  const stop = file.stops[stopIdx];
  const box = make('div');
  box.appendChild(make('strong', undefined, stopLabel(stop, lang)));
  const body = make('div', undefined, '…');
  body.style.marginTop = '4px';
  box.appendChild(body);
  void loadTimes().then((times) => {
    body.textContent = '';
    if (!times) {
      body.textContent = t('common.error');
      return;
    }
    // the timetable button comes first: with many lines the list scrolls,
    // and the way to the full day should not scroll away with it
    if (timetable) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'tt-open';
      open.textContent = t('bus.fullTimetable');
      open.addEventListener('click', () => timetable.show(stopIdx));
      body.appendChild(open);
    }
    const now = jstNow();
    const upcoming = departuresOn(times, siblingStops(file, stopIdx), now, lang)
      .map((d) => ({ ...d, minutes: d.minutes.filter((m) => m >= now.minutes).slice(0, 3) }))
      .filter((d) => d.minutes.length);
    body.appendChild(
      make('div', 'card-sub', t(upcoming.length ? 'bus.nextDepartures' : 'bus.noMoreToday')),
    );
    // grouped by line, both directions together, so "the other way" sits
    // right under the way you looked at; the line with the soonest bus first
    const byLine = new Map<string, Direction[]>();
    for (const d of upcoming) {
      if (!byLine.has(d.route[0])) byLine.set(d.route[0], []);
      byLine.get(d.route[0])!.push(d);
    }
    const soonest = (ds: Direction[]) => Math.min(...ds.map((d) => d.minutes[0]));
    for (const ds of [...byLine.values()].sort((a, b) => soonest(a) - soonest(b))) {
      const group = make('div', 'pop-line');
      group.style.setProperty('--line', lineColor(file, ds[0].route[0]));
      group.appendChild(lineName(file, ds[0], lang, t));
      const fastest = fastestOf(ds);
      for (const d of ds.sort((a, b) => a.minutes[0] - b.minutes[0])) {
        const row = make('div', 'pop-dir');
        row.appendChild(directionBlock(file, d, lang, t, { fastest: d === fastest }));
        const chips = make('div', 'time-chips');
        d.minutes.forEach((m, n) => chips.appendChild(make('span', n ? 'time-chip' : 'time-chip soon', fmtTime(m))));
        row.appendChild(chips);
        group.appendChild(row);
      }
      body.appendChild(group);
    }
    onFilled();
  });
  return box;
}

/* ---- full-day timetable for one stop, any day the feed covers ------------- */

interface TimetableControl {
  show(stopIdx: number): void;
}

function renderTimetable(file: BusFile, lang: Lang, t: (k: UIKey) => string): TimetableControl | null {
  const card = document.getElementById('bus-stop-timetable');
  const host = card?.querySelector<HTMLElement>('[data-widget="bus-timetable"]');
  if (!card || !host) return null;

  let stopIdx = -1;
  let picked: string | null = null; // YYYY-MM-DD, kept across stops
  // the line and direction on show; kept across dates so swapping the day
  // keeps the reader on the same bus
  let pickedRoute: string | null = null;
  let pickedHeadsign: string | null = null;

  const draw = async (): Promise<void> => {
    const times = await loadTimes();
    host.textContent = '';
    if (!times) {
      host.appendChild(make('p', 'placeholder error', t('common.error')));
      return;
    }

    const head = make('div', 'tt-head');
    const title = make('strong', 'tt-stop');
    title.appendChild(bilingualNode(file.stops[stopIdx].name, file.stops[stopIdx].nameEn, lang));
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'link-button';
    close.textContent = t('bus.close');
    close.addEventListener('click', () => {
      card.hidden = true;
      pickedRoute = pickedHeadsign = null;
    });
    head.appendChild(close);
    host.appendChild(head);

    // the date range the published calendars cover, from today on
    const now = jstNow();
    const today = now.date;
    const first = times.services.reduce((m, s) => (s.start < m ? s.start : m), '99991231');
    const last = times.services.reduce((m, s) => (s.end > m && s.end < '20990101' ? s.end : m), '00000000');
    const min = toIso(first > today ? first : today);
    const max = toIso(last);
    if (!picked || picked < min || picked > max) picked = min;

    const tomorrow = (() => {
      const [y, m, d] = toIso(today).split('-').map(Number);
      const n = new Date(Date.UTC(y, m - 1, d + 1));
      return `${n.getUTCFullYear()}-${pad2(n.getUTCMonth() + 1)}-${pad2(n.getUTCDate())}`;
    })();

    const section = (label: string): HTMLElement => {
      const sec = make('div', 'tt-section');
      sec.appendChild(make('div', 'tt-label', label));
      host.appendChild(sec);
      return sec;
    };
    const controls = make('div', 'tt-controls');
    const pick = (iso: string) => {
      picked = iso < min ? min : iso > max ? max : iso;
      void draw();
    };
    for (const [key, iso] of [
      ['bus.today', toIso(today)],
      ['bus.tomorrow', tomorrow],
    ] as const) {
      if (iso < min || iso > max) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'badge';
      b.textContent = t(key);
      b.setAttribute('aria-pressed', String(picked === iso));
      b.addEventListener('click', () => pick(iso));
      controls.appendChild(b);
    }
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'gb-input tt-date';
    input.min = min;
    input.max = max;
    input.value = picked;
    input.setAttribute('aria-label', t('bus.date'));
    input.addEventListener('change', () => input.value && pick(input.value));
    controls.appendChild(input);
    section(t('bus.date')).appendChild(controls);

    const directions = departuresOn(times, siblingStops(file, stopIdx), serviceDay(picked), lang);
    if (!directions.length) {
      host.appendChild(make('p', 'placeholder', t('bus.noService')));
      return;
    }
    // one line × one direction at a time: a stop like the bus terminal serves
    // a dozen, and all at once is a wall of numbers
    const lines = [...new Set(directions.map((d) => d.route[0]))];
    if (!pickedRoute || !lines.includes(pickedRoute)) pickedRoute = lines[0];
    const ways = directions.filter((d) => d.route[0] === pickedRoute);
    // unless the reader picked one, start on the quick way, not the way round
    const shown = ways.find((d) => d.key === pickedHeadsign) ?? fastestOf(ways) ?? ways[0];
    pickedHeadsign = shown.key;

    const lineSec = lines.length > 1 ? section(t('bus.line')) : null;
    if (lineSec && narrow()) {
      // a dozen chips fill a phone screen; the native picker does not
      const select = document.createElement('select');
      select.className = 'gb-input';
      select.setAttribute('aria-label', t('bus.line'));
      for (const name of lines) {
        const d = directions.find((x) => x.route[0] === name)!;
        select.appendChild(new Option(bilingual(...d.route, lang), name, false, name === pickedRoute));
      }
      select.addEventListener('change', () => {
        pickedRoute = select.value;
        void draw();
      });
      lineSec.appendChild(select);
    } else if (lineSec) {
      const row = make('div', 'chip-row');
      for (const name of lines) {
        const d = directions.find((x) => x.route[0] === name)!;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'badge';
        b.setAttribute('aria-pressed', String(name === pickedRoute));
        b.appendChild(bilingualNode(...d.route, lang));
        b.addEventListener('click', () => {
          pickedRoute = name;
          void draw();
        });
        row.appendChild(b);
      }
      lineSec.appendChild(row);
    }

    const dirRow = make('div', 'tt-dir-card');
    dirRow.style.setProperty('--line', lineColor(file, shown.route[0]));
    dirRow.appendChild(directionBlock(file, shown, lang, t, { big: true, fastest: shown === fastestOf(ways) }));
    if (ways.length > 1) {
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.className = 'tt-swap';
      swap.textContent = `⇄ ${t('bus.swapDirection')}`;
      swap.addEventListener('click', () => {
        const i = ways.indexOf(shown);
        pickedHeadsign = ways[(i + 1) % ways.length].key;
        void draw();
      });
      dirRow.appendChild(swap);
    }
    if (shown.loop) dirRow.appendChild(make('p', 'loop-note', `↻ ${t('bus.loopNote')}`));
    const dirSec = make('div', 'tt-section');
    dirSec.appendChild(dirRow);
    host.appendChild(dirSec);

    // on today's table, gone buses fade and the next one stands out
    const isToday = picked === toIso(today);
    const next = isToday ? shown.minutes.find((m) => m >= now.minutes) : undefined;
    const byHour = new Map<number, number[]>();
    for (const m of shown.minutes) {
      const h = Math.floor(m / 60);
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h)!.push(m);
    }
    const table = make('div', 'tt-table');
    for (const [h, mins] of byHour) {
      const row = make('div', 'tt-row');
      row.appendChild(make('span', 'tt-hour', pad2(h)));
      const cell = make('span', 'tt-mins');
      for (const m of mins) {
        const cls = m === next ? 'tt-next' : isToday && m < now.minutes ? 'tt-past' : undefined;
        cell.appendChild(make('span', cls, pad2(m % 60)));
      }
      row.appendChild(cell);
      table.appendChild(row);
    }
    dirSec.appendChild(table);
  };

  return {
    show(idx) {
      stopIdx = idx;
      card.hidden = false;
      void draw().then(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
  };
}

/** Stop indices served by a line, from the departures sidecar (bus.json has no
 *  stop↔route link). Empty when the sidecar is missing — the caller then leaves
 *  the zoom-based stop layer alone rather than showing a wrong subset. */
async function stopsOnRoute(routeName: string): Promise<number[]> {
  const times = await loadTimes();
  if (!times) return [];
  const routeIdx = times.routes.indexOf(routeName);
  if (routeIdx < 0) return [];
  const out: number[] = [];
  times.stops.forEach((entries, stopIdx) => {
    if (entries.some(([r]) => r === routeIdx)) out.push(stopIdx);
  });
  return out;
}

/** What the route list drives on the map. */
export interface MapControl {
  select(routeName: string | null): void;
  focusStop(stopIdx: number): void;
}

function renderMap(
  file: BusFile,
  lang: Lang,
  t: (k: UIKey) => string,
  timetable: TimetableControl | null,
): MapControl | null {
  const mapHost = document.getElementById('bus-map');
  if (!mapHost) return null;

  const map = L.map(mapHost, { scrollWheelZoom: false }).setView(MATSUMOTO, 12);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 (GSI)</a> · 松本市 (CC BY 4.0) · <a href="https://gtfs-data.jp" target="_blank" rel="noopener">gtfs-data.jp</a>',
    maxZoom: 18,
  }).addTo(map);

  const groups: Record<BusRoute['feed'], L.LayerGroup> = {
    station: L.layerGroup().addTo(map),
    regional: L.layerGroup().addTo(map),
  };

  let selected: string | null = null;
  const linesByRoute = new Map<string, L.Polyline[]>();
  for (const route of file.routes) {
    const color = route.color ?? 'var(--series-1)';
    const lines: L.Polyline[] = [];
    for (const path of route.paths) {
      const line = L.polyline(path as L.LatLngExpression[], {
        color,
        weight: 3,
        opacity: 0.8,
      });
      line.bindTooltip(routeLabel(route, lang), { sticky: true });
      // hover emphasis is suppressed while a line is selected, so the dimmed
      // lines stay dimmed and the selection reads unambiguously
      line.on('mouseover', () => !selected && line.setStyle({ weight: 5, opacity: 1 }));
      line.on('mouseout', () => !selected && line.setStyle({ weight: 3, opacity: 0.8 }));
      groups[route.feed].addLayer(line);
      lines.push(line);
    }
    linesByRoute.set(route.name, lines);
  }

  const stopMarker = (stopIdx: number): L.CircleMarker => {
    const stop = file.stops[stopIdx];
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: narrow() ? 7 : 4.5, // a fingertip needs a bigger target
      color: 'var(--ink, #333)',
      weight: 1.5,
      fillColor: '#fff',
      fillOpacity: 1,
    });
    marker.bindTooltip(stopLabel(stop, lang));
    marker.bindPopup('', {
      // scroll inside the popup rather than run off the top of the map
      maxHeight: narrow() ? 320 : 380,
      maxWidth: narrow() ? 260 : 320,
      autoPanPadding: [12, 28],
    });
    // departures fill in after opening; re-fit so the grown popup gets its
    // scrollbar and the map pans to keep it in view
    // (content is built at open time so "next departures" reflect the clock)
    marker.on('popupopen', (e) =>
      e.popup.setContent(departuresContent(file, stopIdx, lang, t, timetable, () => e.popup.update())),
    );
    return marker;
  };

  const stopsGroup = L.layerGroup();
  file.stops.forEach((_, stopIdx) => stopsGroup.addLayer(stopMarker(stopIdx)));

  // stops of the selected line only, shown at every zoom level
  const routeStops = L.layerGroup();

  const syncStops = () => {
    // while a line is selected its own stops replace the zoom-based layer
    const wantAll = !selected && map.getZoom() >= STOP_MIN_ZOOM;
    if (wantAll && !map.hasLayer(stopsGroup)) stopsGroup.addTo(map);
    if (!wantAll && map.hasLayer(stopsGroup)) map.removeLayer(stopsGroup);
  };
  map.on('zoomend', syncStops);
  syncStops();

  /** Guards against a slow stop lookup landing after the user picked another
   *  line: only the newest selection may draw. */
  let selectionToken = 0;

  const select = (routeName: string | null): void => {
    selected = routeName;
    const token = ++selectionToken;
    routeStops.clearLayers();
    if (map.hasLayer(routeStops)) map.removeLayer(routeStops);

    for (const [name, lines] of linesByRoute) {
      const on = routeName === null || name === routeName;
      for (const line of lines) {
        line.setStyle(
          routeName === null
            ? { weight: 3, opacity: 0.8 }
            : on
              ? { weight: 5, opacity: 1 }
              : { weight: 2, opacity: 0.15 },
        );
        if (on && routeName !== null) line.bringToFront();
      }
    }
    syncStops();
    if (routeName === null) return;

    const lines = linesByRoute.get(routeName) ?? [];
    const bounds = lines.reduce<L.LatLngBounds | null>(
      (acc, line) => (acc ? acc.extend(line.getBounds()) : line.getBounds()),
      null,
    );
    if (bounds) map.fitBounds(bounds, { padding: [30, 30] });
    // the chips sit below the map: on a phone the highlight would otherwise
    // happen off-screen
    mapHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    void stopsOnRoute(routeName).then((indices) => {
      if (token !== selectionToken) return;
      for (const stopIdx of indices) routeStops.addLayer(stopMarker(stopIdx));
      if (indices.length) routeStops.addTo(map);
    });
  };

  L.control
    .layers(
      undefined,
      {
        [t('bus.layerStation')]: groups.station,
        [t('bus.layerRegional')]: groups.regional,
      },
      // expanded it would cover a third of a phone-sized map
      { collapsed: narrow() },
    )
    .addTo(map);

  addLocateControl(map, t);
  addExpandControl(map, t);

  // on a phone the corner buttons would sit on top of an open popup
  map.on('popupopen', () => mapHost.classList.add('popup-open'));
  map.on('popupclose', () => mapHost.classList.remove('popup-open'));

  // a searched stop gets its own marker, whatever line or zoom is showing
  const focusLayer = L.layerGroup().addTo(map);
  const focusStop = (stopIdx: number): void => {
    focusLayer.clearLayers();
    const stop = file.stops[stopIdx];
    const marker = stopMarker(stopIdx);
    focusLayer.addLayer(marker);
    map.once('moveend', () => marker.openPopup());
    map.setView([stop.lat, stop.lon], Math.max(map.getZoom(), 16));
    mapHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  return { select, focusStop };
}

const CITY_BUS_URL = 'https://www.city.matsumoto.nagano.jp/soshiki/222/3237.html';
const BUS_LOCATION_URL = 'https://www.city.matsumoto.nagano.jp/soshiki/224/121490.html';

function externalLink(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = `${label} ↗`;
  return a;
}

function renderRouteList(
  file: BusFile,
  lang: Lang,
  t: (k: UIKey) => string,
  map: MapControl | null,
): void {
  const host = document.querySelector<HTMLElement>('[data-widget="bus-routes"]');
  if (!host) return;
  host.textContent = '';
  host.appendChild(make('p', 'card-sub', t('bus.chipNote')));

  // details of the selected line: its own timetable and fare PDFs
  const detail = make('div', 'line-detail');
  detail.hidden = true;
  host.appendChild(detail);

  const chips = new Map<string, HTMLButtonElement>();
  let current: string | null = null;

  const select = (route: BusRoute | null): void => {
    current = route ? route.name : null;
    for (const [name, chip] of chips) chip.setAttribute('aria-pressed', String(name === current));
    map?.select(current);

    detail.textContent = '';
    detail.hidden = route === null;
    if (!route) return;

    const name = make('strong');
    name.appendChild(bilingualNode(route.name, route.romaji, lang));
    detail.appendChild(name);
    const links = make('p', 'card-note');
    // the city publishes these per line as Japanese-language PDFs; without a
    // match (a new line, or a reworded heading) we can only offer the index page
    links.appendChild(
      externalLink(route.timetable ?? CITY_BUS_URL, t(route.timetable ? 'bus.lineTimetable' : 'bus.timetables')),
    );
    if (route.fare) {
      links.appendChild(document.createTextNode(' · '));
      links.appendChild(externalLink(route.fare, t('bus.lineFares')));
    }
    detail.appendChild(links);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link-button';
    clear.textContent = t('bus.clearSelection');
    clear.addEventListener('click', () => select(null));
    detail.appendChild(clear);
  };

  for (const feed of ['station', 'regional'] as const) {
    const routes = file.routes.filter((r) => r.feed === feed);
    if (!routes.length) continue;
    const sub = make('p', 'card-sub', t(feed === 'station' ? 'bus.layerStation' : 'bus.layerRegional'));
    sub.style.margin = '14px 0 6px';
    host.appendChild(sub);
    const list = make('div', 'chip-row');
    for (const route of routes) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'badge';
      chip.setAttribute('aria-pressed', 'false');
      chip.appendChild(bilingualNode(route.name, route.romaji, lang));
      const dot = make('span', 'dot');
      dot.style.background = route.color ?? 'var(--series-1)';
      chip.prepend(dot);
      // clicking the active chip clears the selection
      chip.addEventListener('click', () => select(current === route.name ? null : route));
      chips.set(route.name, chip);
      list.appendChild(chip);
    }
    host.appendChild(list);
  }

  const links = make('p', 'card-note');
  links.appendChild(externalLink(CITY_BUS_URL, t('bus.timetables')));
  links.appendChild(document.createTextNode(' · '));
  links.appendChild(externalLink(BUS_LOCATION_URL, t('bus.location')));
  host.appendChild(links);
}

const RECENT_KEY = 'bus-recent-stops';

/** Find a stop by name (romaji or Japanese) without hunting on the map. Picking
 *  one centres the map on it (popup = next departures) and opens its timetable;
 *  the last few picks stay as one-tap chips under the box. */
function renderStopSearch(
  file: BusFile,
  lang: Lang,
  t: (k: UIKey) => string,
  map: MapControl | null,
  timetable: TimetableControl | null,
): void {
  const input = document.querySelector<HTMLInputElement>('#bus-stop-search');
  const list = document.getElementById('bus-stop-results');
  const recentHost = document.querySelector<HTMLElement>('[data-bus-recent]');
  if (!input || !list || !map) return;

  // one entry per distinct name: platforms of the same stop share it
  const seen = new Set<string>();
  const index: { i: number; key: string }[] = [];
  file.stops.forEach((stop, i) => {
    if (seen.has(stop.name)) return;
    seen.add(stop.name);
    index.push({ i, key: fold(`${stop.name} ${stop.nameEn ?? ''}`) });
  });

  const optionHtml = (i: number): string => {
    const stop = file.stops[i];
    return lang === 'ja' || !stop.nameEn
      ? escapeHtml(stop.name)
      : `${escapeHtml(stop.nameEn)} <span class="jp">${escapeHtml(stop.name)}</span>`;
  };

  let recent: string[] = [];
  try {
    recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {}
  const renderRecent = (): void => {
    if (!recentHost) return;
    const idx = recent.map((n) => file.stops.findIndex((s) => s.name === n)).filter((i) => i >= 0);
    recentHost.hidden = idx.length === 0;
    recentHost.innerHTML = idx.length
      ? `<span class="tt-label">${escapeHtml(t('bus.recent'))}</span>` +
        idx.map((i) => `<button type="button" class="badge" data-i="${i}">${optionHtml(i)}</button>`).join('')
      : '';
  };

  const pick = (i: number): void => {
    const name = file.stops[i].name;
    recent = [name, ...recent.filter((n) => n !== name)].slice(0, 4);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {}
    renderRecent();
    map.focusStop(i);
    timetable?.show(i);
  };

  combobox({
    input,
    list,
    noMatch: escapeHtml(t('bus.noMatch')),
    search: (q) => {
      const fq = fold(q);
      return index
        .filter((e) => e.key.includes(fq))
        .sort((a, b) => Number(!a.key.startsWith(fq)) - Number(!b.key.startsWith(fq)))
        .slice(0, 8)
        .map((e) => ({ value: e.i, html: optionHtml(e.i) }));
    },
    onPick: pick,
  });
  recentHost?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (btn) pick(Number(btn.dataset.i));
  });
  renderRecent();
}

export function initBusPage(): void {
  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  fetch(`${base}/data/bus.json`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<BusFile>) : Promise.reject(res.status)))
    .then((file) => {
      const timetable = renderTimetable(file, lang, t);
      const map = renderMap(file, lang, t, timetable);
      renderRouteList(file, lang, t, map);
      renderStopSearch(file, lang, t, map, timetable);
    })
    .catch(() => {
      const host = document.querySelector<HTMLElement>('[data-widget="bus-routes"]');
      if (host) chartMessage(host, t('common.error'), true);
      const mapHost = document.getElementById('bus-map');
      if (mapHost) mapError(mapHost, t);
    });
}
