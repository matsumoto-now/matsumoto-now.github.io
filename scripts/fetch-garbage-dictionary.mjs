#!/usr/bin/env node
/**
 * 「ごみ処理辞典（ごみだす）」 → public/data/garbage-dictionary.json
 *
 * The city's item-by-item disposal index: ~1,700 household objects, each with
 * its category, whether it is collected at the kerb, whether you may bring it
 * in yourself, and any instructions. Ten HTML pages, one per kana row, from
 * https://www.city.matsumoto.nagano.jp/life/5/40/266/ — plain tables with the
 * columns 品目 / 形態 / 区分 / 収集 / 持ち込み / 備考.
 *
 * Reissued once a year (every page is dated 1 April), so this runs on the
 * monthly schedule and is gated by `garbageDictionary` in src/features.ts —
 * see the permission note there. The collection calendar
 * (scripts/fetch-garbage-data.mjs) is a separate, explicitly CC BY 4.0 dataset
 * and is not gated.
 *
 * Two integrity checks, so a silent scrape failure cannot ship a half-empty
 * dictionary: at least 1,500 rows, and every 区分 must be one of the city's own
 * 25 区分. An unknown category is reported by name and the run fails.
 *
 * Run: node scripts/fetch-garbage-dictionary.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public/data/garbage-dictionary.json');
const HOST = 'https://www.city.matsumoto.nagano.jp';
const INDEX_URL = `${HOST}/life/5/40/266/`;

/** The ten kana-row pages, in あいうえお order. */
const PAGES = [
  ['あ', 2839],
  ['か', 2841],
  ['さ', 2845],
  ['た', 2846],
  ['な', 2843],
  ['は', 2840],
  ['ま', 2842],
  ['や', 2848],
  ['ら', 2844],
  ['わ', 2847],
];

const MIN_ROWS = 1500;

/** The city's 25 区分, normalised. Printing varies across pages — full-width and
 *  half-width brackets, 生びん for 生きびん, 小型家電類 for 小型家電 — so the label is
 *  normalised before lookup and an unrecognised one fails the run. */
const CATEGORIES = new Map(
  Object.entries({
    可燃ごみ: 'burnable',
    破砕ごみ: 'crush',
    埋立ごみ: 'landfill',
    粗大ごみ: 'bulky',
    プラスチック資源: 'plastic',
    大型プラスチック資源: 'bigplastic',
    大型プラスチック: 'bigplastic',
    資源物: 'recyclables',
    '資源物（紙類）': 'paper',
    '資源物（金属類）': 'metal',
    '資源物（布類）': 'cloth',
    '資源物（雑びん）': 'jarbottle',
    '資源物（生きびん）': 'returnable',
    '資源物（生びん）': 'returnable',
    '資源物（ペットボトル）': 'pet',
    '資源物（小型家電）': 'smallappliance',
    '資源物（小型家電類）': 'smallappliance',
    '資源物（電池類）': 'battery',
    '資源物（蛍光管・体温計・スプレー缶・ライター）': 'hazardous',
    '資源物（廃食用油）': 'cookingoil',
    家電リサイクル法対象機器: 'appliancelaw',
    産業廃棄物: 'industrial',
    処理困難物: 'difficult',
  }),
);

/** Collapse the spacing and bracket variants the pages use. */
const normCategory = (s) =>
  s
    .replace(/[（(]/g, '（')
    .replace(/[)）]/g, '）')
    .replace(/[\s　]+/g, '')
    .trim();

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'matsumoto-now/1.0 (community dashboard; monthly fetch)' },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      console.error(`[retry ${i}] ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}

/** Cell text: <br> becomes a newline, tags go, entities and spacing collapse. */
function cellText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&times;/g, '×')
    .replace(/[ \t　]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

const yes = (s) => s.startsWith('可');

async function main() {
  const items = [];
  const unknown = new Map();

  for (const [kana, id] of PAGES) {
    const html = await get(`${HOST}/soshiki/53/${id}.html`);
    let rows = 0;
    for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => cellText(c[1]));
      if (cells.length < 6) continue; // header row, or a layout table
      const [item, form, rawCategory, collect, bring, note] = cells;
      if (!item) continue;
      const key = normCategory(rawCategory);
      if (!key) continue; // a handful of rows carry no 区分 (see "備考" only)
      const category = CATEGORIES.get(key);
      if (!category) {
        unknown.set(key, (unknown.get(key) ?? 0) + 1);
        continue;
      }
      items.push({
        item,
        form: form || null,
        category,
        collected: yes(collect),
        dropOff: yes(bring),
        note: note || null,
        kana,
      });
      rows++;
    }
    console.log(`  ${kana}行: ${rows} items`);
  }

  if (unknown.size) {
    throw new Error(
      `unrecognised 区分 (add to CATEGORIES): ${[...unknown].map(([k, n]) => `${k}(${n})`).join(' ')}`,
    );
  }
  if (items.length < MIN_ROWS) {
    throw new Error(`only ${items.length} items scraped (expected ≥ ${MIN_ROWS}) — refusing to write`);
  }

  // Notes repeat heavily (the same "take it to the Clean Center" paragraph on
  // dozens of rows), so they are interned: a note index keeps the file small and
  // makes translating the dictionary a matter of translating ~570 strings rather
  // than ~1,700.
  const notes = [...new Set(items.map((i) => i.note).filter(Boolean))];
  const noteIndex = new Map(notes.map((n, i) => [n, i]));

  const data = {
    fetched: new Date().toISOString(),
    source: INDEX_URL,
    notes,
    items: items.map((i) => ({
      ...i,
      note: i.note === null ? null : noteIndex.get(i.note),
    })),
  };
  await writeFile(OUT, JSON.stringify(data) + '\n');
  console.log(
    `wrote ${OUT}: ${items.length} items, ${new Set(items.map((i) => i.category)).size} categories, ${notes.length} distinct notes`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
