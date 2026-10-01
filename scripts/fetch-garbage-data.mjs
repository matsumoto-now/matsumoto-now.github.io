#!/usr/bin/env node
/**
 * Household waste collection calendar → public/data/garbage.json
 *
 * Source: 松本市「ごみ・資源物収集日程表」
 *   https://www.city.matsumoto.nagano.jp/soshiki/53/104597.html
 * Listed in the city's open-data catalogue (soshiki/5/4172.html) under
 * CC BY 4.0 — attribution 松本市. Only the extracted dates are stored; the PDFs
 * themselves are linked, never copied.
 *
 * The city publishes one A3 PDF per district (41 of them) and no HTML or CSV
 * version, so the dates have to come out of the PDF. The text layer is intact,
 * so `pdftotext -bbox-layout` gives every word with its bounding box and the
 * calendar's geometry can be read back: six month blocks per page (Apr–Sep on
 * the front, Oct–Mar on the back), a seven-column week grid, and each day's
 * collection codes printed ~20 pt below the day number and centred on the same
 * column.
 *
 * Nothing here is trusted blindly. Three assertions have to hold per district
 * or it is marked unparsed and the page links its PDF instead:
 *
 *   1. Twelve month blocks in fiscal order (4月…3月).
 *   2. Every day of every month appears exactly once, and the column a day
 *      sits in equals that date's real weekday. This is the assertion that
 *      matters: a layout change that shifted the grid by one column would
 *      otherwise quietly move every resident's collection day.
 *   3. Every collection code is in CODES below. An unrecognised code is
 *      reported by name and never guessed at — a new code means the city
 *      changed something a human should read.
 *
 * Two known layout variants are handled: the month label sits at the top-right
 * of its block in most districts but top-left in 島内A/B, so blocks are split
 * by page half rather than by where the label is.
 *
 * 安曇 publishes a combined 「くらしのカレンダー」 on a different template and does
 * not parse; 奈川 parses but carries no 町会 list. Both fall back to their PDF.
 *
 * Runs monthly, but the content is annual: the PDFs are reissued each April.
 * Attachment IDs change at every reissue (as the bus timetable PDFs do), so the
 * 41 URLs and the fiscal year are re-derived from the index page every run and
 * never hardcoded.
 *
 * Needs `pdftotext` (poppler-utils) on PATH.
 *
 * Run: node scripts/fetch-garbage-data.mjs
 */

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

const OUT = path.join(process.cwd(), 'public/data/garbage.json');
const HOST = 'https://www.city.matsumoto.nagano.jp';
const INDEX_URL = `${HOST}/soshiki/53/104597.html`;

/** Codes as printed on the calendars → the waste categories they stand for.
 *  Abbreviations are the city's: 可 = 可燃, プラ資 = プラスチック資源, 破 = 破砕,
 *  埋 = 埋立, 大 = 大型プラスチック, 雑 = 雑びん, ペ = ペットボトル, 小 = 小型家電,
 *  電 = 電池類, 蛍 = 蛍光管, 体 = 体温計, ス = スプレー缶, ラ = ライター,
 *  ア = アルミ缶, 生 = 生きびん. Districts combine them freely, and each distinct
 *  combination is printed as one label, so the whole label is the key. */
const CODES = new Map(
  Object.entries({
    可: ['burnable'],
    可燃ごみ: ['burnable'],
    プラ資: ['plastic'],
    'プラ資・大': ['plastic', 'bigplastic'],
    大プラ: ['bigplastic'],
    'プラ資・破': ['plastic', 'crush'],
    'プラ資・埋': ['plastic', 'landfill'],
    'プラ資・埋・ペ': ['plastic', 'landfill', 'pet'],
    'プラ資・埋ペ・生': ['plastic', 'landfill', 'pet', 'returnable'],
    'プラ資・小・電': ['plastic', 'smallappliance', 'battery'],
    プラ資資源: ['plastic', 'recyclables'],
    'プラ資・埋資源': ['plastic', 'landfill', 'recyclables'],
    'プラ資・破資源': ['plastic', 'crush', 'recyclables'],
    破砕: ['crush'],
    埋立: ['landfill'],
    資源: ['recyclables'],
    資源物: ['recyclables'],
    全資源物: ['recyclables'],
    '資源・大': ['recyclables', 'bigplastic'],
    可資源: ['burnable', 'recyclables'],
    '雑・ペ・蛍・ス': ['jarbottle', 'pet', 'fluoro', 'spray'],
    '雑・ペ・小・電': ['jarbottle', 'pet', 'smallappliance', 'battery'],
    '雑・ペ・蛍・小・ス': ['jarbottle', 'pet', 'fluoro', 'smallappliance', 'spray'],
    '雑・蛍・ス・ラ': ['jarbottle', 'fluoro', 'spray', 'lighter'],
    '小・電': ['smallappliance', 'battery'],
    小電・電池: ['smallappliance', 'battery'],
    '小・電・蛍・体': ['smallappliance', 'battery', 'fluoro', 'thermometer'],
    '小・電・蛍・体・ス・ラ': [
      'smallappliance',
      'battery',
      'fluoro',
      'thermometer',
      'spray',
      'lighter',
    ],
    'ス・ラ': ['spray', 'lighter'],
    ペット: ['pet'],
    'ペット・大': ['pet', 'bigplastic'],
    紙類: ['paper'],
    '紙・布': ['paper', 'cloth'],
    '紙・布・埋': ['paper', 'cloth', 'landfill'],
    金属: ['metal'],
    'スチール缶・その他金属': ['metal'],
    雑びん: ['jarbottle'],
    生きびん: ['returnable'],
    '雑・生びん': ['jarbottle', 'returnable'],
    びん類: ['jarbottle', 'returnable'],
    'ア・ペ・布': ['metal', 'pet', 'cloth'],
    '布・生': ['cloth', 'returnable'],
  }),
);

/** Every category the calendars can name, grouped as the city's 5分別 groups —
 *  the page colours by group and labels by category. Order is the order the
 *  city prints them in 「家庭ごみ・資源物の分け方・出し方」. */
export const CATEGORY_GROUPS = {
  burnable: ['burnable'],
  crush: ['crush'],
  landfill: ['landfill'],
  plastic: ['plastic', 'bigplastic'],
  recyclables: [
    'recyclables',
    'paper',
    'metal',
    'cloth',
    'jarbottle',
    'returnable',
    'pet',
    'fluoro',
    'spray',
    'lighter',
    'smallappliance',
    'battery',
    'thermometer',
  ],
};

const CATEGORIES = Object.values(CATEGORY_GROUPS).flat();

/** Stable URL slug per district, for the calendar-subscription routes.
 *  Written out by hand rather than transliterated so a subscription URL keeps
 *  working across the April reissue, and so an unrecognised district name stops
 *  the run instead of silently serving one district's calendar under another's
 *  address. */
const SLUGS = {
  第一: 'daiichi',
  第二: 'daini',
  第三: 'daisan',
  東部: 'tobu',
  中央A: 'chuo-a',
  中央B: 'chuo-b',
  城北: 'johoku',
  安原: 'yasuhara',
  城東: 'joto',
  白板: 'shiraita',
  田川: 'tagawa',
  庄内A: 'shonai-a',
  庄内B: 'shonai-b',
  鎌田: 'kamata',
  松南: 'shonan',
  島内A: 'shimauchi-a',
  島内B: 'shimauchi-b',
  中山: 'nakayama',
  島立: 'shimadachi',
  新村: 'niimura',
  和田: 'wada',
  神林: 'kanbayashi',
  笹賀: 'sasaga',
  芳川: 'yoshikawa',
  寿: 'kotobuki',
  寿台: 'kotobukidai',
  松原: 'matsubara',
  岡田: 'okada',
  入山辺: 'iriyamabe',
  里山辺: 'satoyamabe',
  今井: 'imai',
  内田: 'uchida',
  本郷A1: 'hongo-a1',
  本郷A2: 'hongo-a2',
  本郷B: 'hongo-b',
  四賀: 'shiga',
  梓川: 'azusagawa',
  波田1班: 'hata-1',
  波田2班: 'hata-2',
  奈川: 'nagawa',
  安曇: 'azumi',
};

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'matsumoto-now/1.0 (community dashboard; monthly fetch)' },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      console.error(`[retry ${i}] ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}

const decode = (buf) =>
  new TextDecoder('utf-8').decode(
    buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf,
  );

/** Cluster 1-D values into groups whose neighbours are within `tol`, returning
 *  each group's mean — used for the grid's row and column positions. */
function cluster(values, tol) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Words of one PDF page, with bounding boxes, from pdftotext -bbox-layout. */
function pagesOf(xml) {
  return xml.split('<page ').slice(1).map((page) => {
    const words = [];
    const re =
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    for (const m of page.matchAll(re)) {
      words.push({
        x: +m[1],
        y: +m[2],
        x2: +m[3],
        y2: +m[4],
        cx: (+m[1] + +m[3]) / 2,
        h: +m[4] - +m[2],
        t: m[5],
      });
    }
    const size = page.match(/width="([\d.]+)"/);
    return { words, width: size ? +size[1] : 841.89 };
  });
}

/** Twelve months of a Japanese fiscal year, in the order the PDF prints them. */
function fiscalMonths(fy) {
  return Array.from({ length: 12 }, (_, i) =>
    i < 9 ? [i + 4, fy] : [i - 8, fy + 1],
  );
}

function parseCalendar(xml, fy) {
  const pages = pagesOf(xml);
  const months = fiscalMonths(fy);
  const warn = [];
  const unknown = new Map();
  const days = new Map();
  let monthIdx = 0;

  for (const [pi, page] of pages.slice(0, 2).entries()) {
    const w = page.words;
    // A month header is a tall digit immediately left of a tall 月 glyph, below
    // the sheet's masthead. The small 月 in the masthead's date line is excluded
    // by the height test, the masthead itself by the y test.
    const heads = [];
    for (const m of w.filter((o) => o.t === '月' && o.y > 100 && o.h > 18)) {
      const digit = w.find(
        (o) => /^\d{1,2}$/.test(o.t) && o.h > 18 && Math.abs(o.x2 - m.x) < 6 && Math.abs(o.y - m.y) < 8,
      );
      if (digit) heads.push({ month: +digit.t, x: m.x, y: m.y, digit });
    }
    if (heads.length !== 6) {
      warn.push(`page ${pi + 1}: ${heads.length} month headers (want 6)`);
      continue;
    }

    // Blocks are two per row, three rows. The label sits at the top-right of
    // its block in most districts and at the top-left in 島内A/B, so the column
    // is taken from which half of the sheet the label is on, not from its
    // distance to the block's edge.
    const rowYs = cluster(heads.map((h) => h.y), 10);
    const rowOf = (h) => rowYs.findIndex((y) => Math.abs(y - h.y) < 10);
    const colOfHead = (h) => (h.x < page.width / 2 ? 0 : 1);
    heads.sort((a, b) => rowOf(a) - rowOf(b) || colOfHead(a) - colOfHead(b));

    for (const head of heads) {
      const [month, year] = months[monthIdx++] ?? [];
      if (head.month !== month) {
        warn.push(`month order: ${head.month}月 where ${month}月 expected`);
        continue;
      }
      const row = rowOf(head);
      const half = colOfHead(head);
      const xLo = half === 0 ? 0 : page.width / 2;
      const xHi = half === 0 ? page.width / 2 : page.width;
      const yLo = head.y;
      const yHi = row + 1 < rowYs.length ? rowYs[row + 1] - 8 : head.y + 250;
      const box = w.filter(
        (o) => o !== head.digit && o.cx > xLo && o.cx < xHi && o.y > yLo && o.y < yHi,
      );

      // Day numbers are the short glyphs; the month header's digit is tall.
      const dayWords = box.filter(
        (o) => /^\d{1,2}$/.test(o.t) && +o.t >= 1 && +o.t <= 31 && o.h < 20,
      );
      const cols = cluster(dayWords.map((o) => o.cx), 20);
      if (cols.length !== 7) {
        warn.push(`${month}月: ${cols.length} day columns (want 7)`);
        continue;
      }
      const colOf = (cx) =>
        cols.reduce((best, x, i) => (Math.abs(x - cx) < Math.abs(cols[best] - cx) ? i : best), 0);

      // A day must sit in the column matching its real weekday, and every day
      // of the month must appear exactly once.
      const inMonth = new Date(year, month, 0).getDate();
      const seen = new Set();
      for (const d of dayWords) {
        const n = +d.t;
        if (n > inMonth) {
          warn.push(`${month}月: day ${n} out of range`);
          continue;
        }
        if (seen.has(n)) warn.push(`${month}月: day ${n} twice`);
        seen.add(n);
        const weekday = new Date(year, month - 1, n).getDay();
        if (weekday !== colOf(d.cx)) {
          warn.push(`${month}月/${n}: column ${colOf(d.cx)} but weekday ${weekday}`);
        }
      }
      for (let n = 1; n <= inMonth; n++) if (!seen.has(n)) warn.push(`${month}月: day ${n} missing`);

      // Each label word binds to the nearest day number above it in the same
      // column. Words above the first day row (the sheet's slogan band) and
      // below the last (footnotes, "10月からは裏面") find no anchor and are dropped.
      const cells = new Map();
      for (const l of box) {
        if (dayWords.includes(l) || !l.t.trim() || /^[0-9]+$/.test(l.t)) continue;
        const col = colOf(l.cx);
        const anchor = dayWords
          .filter((d) => colOf(d.cx) === col && l.y - d.y > 8 && l.y - d.y < 30)
          .sort((a, b) => l.y - a.y - (l.y - b.y))[0];
        if (!anchor) continue;
        const cell = cells.get(anchor.t) ?? cells.set(anchor.t, []).get(anchor.t);
        cell.push(l);
      }
      for (const [day, words] of cells) {
        // pdftotext splits some labels across words (資 / 源); the pieces of one
        // cell are joined in reading order. ※ and ◎ mark footnoted days.
        const label = words
          .sort((a, b) => a.x - b.x)
          .map((o) => o.t)
          .join('')
          .replace(/[※◎\s]/g, '');
        if (!label) continue;
        if (!CODES.has(label)) {
          unknown.set(label, (unknown.get(label) ?? 0) + 1);
          continue;
        }
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(+day).padStart(2, '0')}`;
        days.set(iso, CODES.get(label));
      }
    }
  }

  // 町会名: the district's neighbourhood associations, listed on one wrapped
  // line of the front page. This is what makes the district pickable by the
  // name a resident actually knows.
  const label = pages[0]?.words.find((o) => o.t === '町会名');
  const chokai = label
    ? pages[0].words
        .filter((o) => Math.abs(o.y - label.y) < 16 && o.x > label.x)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((o) => o.t)
        .join('')
        .split(/[、，]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return { days, chokai, warn, unknown, months: monthIdx };
}

async function main() {
  try {
    await run('pdftotext', ['-v']);
  } catch {
    throw new Error('pdftotext not found — install poppler-utils');
  }

  const html = decode(await get(INDEX_URL));

  // 令和N年度 → Gregorian (令和1 = 2019). Re-derived every run: in April the
  // city replaces the whole set and every attachment ID changes with it.
  const era = html.match(/令和\s*(\d+)\s*年度/);
  if (!era) throw new Error('could not find 令和N年度 on the index page');
  const fy = 2018 + Number(era[1]);
  const [aprIso, marIso] = [`${fy}-04-01`, `${fy + 1}-03-31`];

  // District name → PDF. The link text carries the name, but 本郷A1's trailing
  // "1" sits outside the anchor, so an alphanumeric run right after </a> is
  // taken as part of the name.
  const districts = [];
  const re = /href="(\/uploaded\/attachment\/(\d+)\.pdf)"[^>]*>([^<]*)<\/a>([0-9A-Za-z]*)/g;
  for (const m of html.matchAll(re)) {
    const name = (m[3].replace(/&nbsp;/g, ' ') + m[4])
      .replace(/地区(くらしのカレンダー)?$/, '')
      .trim();
    if (name) districts.push({ id: m[2], name, pdf: HOST + m[1] });
  }
  if (districts.length < 30) throw new Error(`only ${districts.length} district PDFs found`);
  const unslugged = districts.filter((d) => !SLUGS[d.name]).map((d) => d.name);
  if (unslugged.length) {
    throw new Error(`no slug for district(s): ${unslugged.join(', ')} — add them to SLUGS`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'garbage-'));
  const out = [];
  const unknownAll = new Map();
  try {
    for (const d of districts) {
      const pdf = path.join(dir, `${d.id}.pdf`);
      const xml = path.join(dir, `${d.id}.xml`);
      await writeFile(pdf, await get(d.pdf));
      await run('pdftotext', ['-bbox-layout', pdf, xml]);
      const r = parseCalendar(readFileSync(xml, 'utf8'), fy);
      for (const [u, n] of r.unknown) unknownAll.set(u, (unknownAll.get(u) ?? 0) + n);

      const parsed = r.months === 12 && r.warn.length === 0 && r.unknown.size === 0;
      if (!parsed) {
        const why = [...[...r.unknown.keys()].map((u) => `unknown code "${u}"`), ...r.warn];
        console.error(`  ${d.name}: unparsed — ${why.slice(0, 3).join('; ')}${why.length > 3 ? ` (+${why.length - 3} more)` : ''}`);
      }
      out.push({
        name: d.name,
        slug: SLUGS[d.name],
        pdf: d.pdf,
        chokai: r.chokai,
        // Category indices into `categories`, keyed by ISO date. Omitted when
        // the parse failed, so the page can only ever link the PDF.
        days: parsed
          ? Object.fromEntries(
              [...r.days]
                .filter(([iso]) => iso >= aprIso && iso <= marIso)
                .sort()
                .map(([iso, cats]) => [iso, cats.map((c) => CATEGORIES.indexOf(c))]),
            )
          : null,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const parsed = out.filter((d) => d.days);
  const dates = parsed.reduce((a, d) => a + Object.keys(d.days).length, 0);
  if (!parsed.length) throw new Error('no district parsed — refusing to overwrite good data');

  const data = {
    fetched: new Date().toISOString(),
    fiscalYear: fy,
    from: aprIso,
    to: marIso,
    source: INDEX_URL,
    categories: CATEGORIES,
    groups: CATEGORY_GROUPS,
    districts: out,
  };
  await writeFile(OUT, JSON.stringify(data) + '\n');
  console.log(
    `wrote ${OUT}: 令和${era[1]}年度 (${aprIso}…${marIso}), ` +
      `districts parsed ${parsed.length}/${out.length}, ${dates} collection dates, ` +
      `${parsed.reduce((a, d) => a + d.chokai.length, 0)} 町会 names`,
  );
  if (unknownAll.size) {
    console.warn(
      `unknown codes (add to CODES in this script): ${[...unknownAll]
        .map(([u, n]) => `${u}(${n})`)
        .join(' ')}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
