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
 * Translation. Item names and notes are Japanese, and a reader who could read
 * them would not need the page, so with DEEPL_API_KEY set the strings are
 * machine-translated into every locale DeepL supports and written to
 * garbage-dictionary.<lang>.json. Three things make that affordable against the
 * free tier's 500k characters a month:
 *
 *   - the notes are interned before translating. ~1,700 rows carry only ~540
 *     distinct 備考 (the same "take it to the Clean Center" paragraph on dozens
 *     of rows), which is the difference between 31k and ~100k characters;
 *   - each language file is its own cache, keyed by the Japanese source string,
 *     so a run only pays for strings it has never seen — and the source changes
 *     once a year;
 *   - a per-run character budget, spent in the order LANGS lists, so a first
 *     run fills English and French and later runs top up the rest instead of
 *     one run blowing the month's quota.
 *
 * Without the key the scrape still runs and the page falls back to the Japanese
 * item names, which is what the city itself publishes.
 *
 * Run: node scripts/fetch-garbage-dictionary.mjs
 */

import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'public/data');
const OUT = path.join(DATA_DIR, 'garbage-dictionary.json');
const outFor = (lang) => path.join(DATA_DIR, `garbage-dictionary.${lang}.json`);

/** Site locale → DeepL target. Spent in this order, so the languages the rest of
 *  the site translates first (see fetch-city-data.mjs) are filled first.
 *  Filipino is absent because DeepL does not translate into it; those readers
 *  get the Japanese item names and the hand-written category labels. A target
 *  DeepL rejects is skipped with a warning rather than failing the run — the
 *  supported list grows, and a 400 here should not cost the whole dictionary. */
const LANGS = [
  ['en', 'EN-GB'],
  ['fr', 'FR'],
  ['zh', 'ZH'],
  ['ko', 'KO'],
  ['pt', 'PT-PT'],
  ['es', 'ES'],
  ['vi', 'VI'],
  ['th', 'TH'],
  ['de', 'DE'],
  ['it', 'IT'],
  ['no', 'NB'],
];

/** DeepL free tier is 500k characters a month and this runs monthly. */
const BUDGET = 450000;
const BATCH = 50;
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

async function translate(texts, apiKey, targetLang) {
  if (!texts.length) return [];
  const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const res = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'JA', target_lang: targetLang }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  return (await res.json()).translations.map((t) => t.text);
}

/** Previous run's translations for `lang`, used as the cache. */
async function loadCache(lang) {
  try {
    const prev = JSON.parse(await readFile(outFor(lang), 'utf8'));
    return { items: prev.items ?? {}, forms: prev.forms ?? {}, notes: prev.notes ?? {} };
  } catch {
    return { items: {}, forms: {}, notes: {} };
  }
}

/** Fill `cache` with translations for whatever in `sources` it does not have,
 *  spending at most `budget` characters. Returns the characters actually spent. */
async function topUp(cache, sources, apiKey, target, budget) {
  let spent = 0;
  for (const [field, strings] of Object.entries(sources)) {
    const missing = [...new Set(strings)].filter((s) => s && !(s in cache[field]));
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const cost = batch.reduce((a, s) => a + s.length, 0);
      if (spent + cost > budget) return spent;
      const out = await translate(batch, apiKey, target);
      batch.forEach((src, j) => (cache[field][src] = out[j] ?? src));
      spent += cost;
    }
  }
  return spent;
}

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

  // Translations, keyed by the Japanese source string so each file is its own
  // cache and survives the city reordering or renaming rows in April.
  const sources = {
    items: items.map((i) => i.item),
    forms: items.map((i) => i.form).filter(Boolean),
    notes,
  };
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.log('DEEPL_API_KEY not set — item names stay Japanese on every page.');
    return;
  }

  let left = BUDGET;
  for (const [lang, target] of LANGS) {
    const cache = await loadCache(lang);
    const before = Object.values(cache).reduce((a, o) => a + Object.keys(o).length, 0);
    if (left > 0) {
      try {
        left -= await topUp(cache, sources, apiKey, target, left);
      } catch (err) {
        console.error(`[warn] ${lang} (${target}) skipped: ${err.message}`);
      }
    }
    const after = Object.values(cache).reduce((a, o) => a + Object.keys(o).length, 0);
    // Written even when nothing was translated this run, so a partially filled
    // language still serves what it has and the next run resumes from it.
    if (after) {
      await writeFile(
        outFor(lang),
        JSON.stringify({ lang, fetched: data.fetched, ...cache }) + '\n',
      );
    }
    const wanted = new Set([...sources.items, ...sources.forms, ...sources.notes]).size;
    console.log(
      `  ${lang}: ${after}/${wanted} strings${after > before ? ` (+${after - before} this run)` : ''}` +
        `${after < wanted ? ' — resumes next run' : ''}`,
    );
  }
  if (left <= 0) console.log(`character budget (${BUDGET}) spent; remaining languages resume next run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
