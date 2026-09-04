/** Waste page: the household collection calendar for whichever of the city's 41
 *  districts the reader lives in, plus whether the two drop-off centres are open
 *  right now.
 *
 *  The calendar comes from public/data/garbage.json, parsed out of the city's
 *  per-district PDFs by scripts/fetch-garbage-data.mjs — the whole city, a full
 *  fiscal year, is 17 kB gzipped, so all 41 districts ship in one file and
 *  switching district costs nothing.
 *
 *  Two decisions worth keeping:
 *
 *  The district is chosen by 町会 (neighbourhood association), not only from the
 *  list of 41. Nobody knows they live in 第一地区; they know they live in 中町2丁目.
 *  The 467 名 of 町会 come out of the PDFs themselves, so the lookup costs nothing
 *  to maintain.
 *
 *  Colour is by the city's five sorting groups, never as the only signal: every
 *  chip carries its own label, because the whole point of the page is that the
 *  reader cannot yet read the label on the bag.
 */

import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import { fmtDateShort, fmtWeekday, jstParts, locale, pad2 } from './format';
import { isHoliday } from './jp-holidays';

interface District {
  name: string;
  slug: string;
  pdf: string;
  chokai: string[];
  /** Category indices into `categories`, by ISO date. Null when the PDF did not parse. */
  days: Record<string, number[]> | null;
}

interface GarbageFile {
  fetched: string;
  fiscalYear: number;
  from: string;
  to: string;
  source: string;
  categories: string[];
  groups: Record<string, string[]>;
  districts: District[];
}

const STORE_KEY = 'garbage-district';
const UPCOMING = 8;

/** The two drop-off centres. Both publish the same hours: weekdays 8:30–16:30,
 *  Saturdays to noon, closed Sundays, public holidays and 29 December–3 January.
 *
 *  Sundays and holidays are why src/lib/jp-holidays.ts exists — a hardcoded
 *  "open Mon–Sat" chip would be wrong on the ~16 holidays a year, Golden Week
 *  and the New Year fortnight among them, which is exactly when a resident has
 *  a car full of rubbish.
 *
 *  The year-end dates are the one thing that moves: 松本クリーンセンター's own site
 *  has previously stayed open on 29–30 December where the city page says the
 *  whole 年末年始 is closed. The stricter of the two is used and the card links
 *  the facility's notice, because sending someone home from a locked gate with a
 *  loaded car is the worse error. */
const FACILITIES = { cc: {}, rc: {} } as const;
type FacilityKey = keyof typeof FACILITIES;

const OPEN_AT = 8 * 60 + 30;
const CLOSE_WEEKDAY = 16 * 60 + 30;
const CLOSE_SATURDAY = 12 * 60;

interface DayHours {
  open: number;
  close: number;
}

/** Opening hours of `facility` on a given JST calendar day, or null if closed. */
function hoursOn(_facility: FacilityKey, y: number, m: number, d: number): DayHours | null {
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();

  if ((m === 1 && d <= 3) || (m === 12 && d >= 29)) return null; // 年末年始
  if (dow === 0 || isHoliday(date)) return null;
  return { open: OPEN_AT, close: dow === 6 ? CLOSE_SATURDAY : CLOSE_WEEKDAY };
}

const hhmm = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/** Open/closed right now, and the next change — "closed, opens Monday 08:30". */
function facilityState(facility: FacilityKey, now: Date, lang: Lang) {
  const p = jstParts(now);
  const minutes = p.h * 60 + p.min;
  const today = hoursOn(facility, p.y, p.m, p.d);
  if (today && minutes >= today.open && minutes < today.close) {
    return { open: true, at: hhmm(today.close) };
  }
  // The next opening is either later today or on one of the coming days.
  if (today && minutes < today.open) {
    return { open: false, day: null as string | null, at: hhmm(today.open) };
  }
  for (let i = 1; i <= 14; i++) {
    const d = new Date(p.y, p.m - 1, p.d + i);
    const h = hoursOn(facility, d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (h) return { open: false, day: fmtWeekday(d, lang), at: hhmm(h.open) };
  }
  return { open: false, day: null, at: null };
}

interface DictItem {
  item: string;
  form: string | null;
  category: string;
  collected: boolean;
  dropOff: boolean;
  note: number | null;
}

interface DictFile {
  fetched: string;
  source: string;
  notes: string[];
  items: DictItem[];
}

/** A language file from scripts/fetch-garbage-dictionary.mjs: translations keyed
 *  by their Japanese source string, so it survives the city reordering rows. */
interface DictLang {
  items: Record<string, string>;
  forms: Record<string, string>;
  notes: Record<string, string>;
}

const DICT_RESULTS = 40;

/** The item-by-item dictionary (「ごみ処理辞典」), ~1,700 entries.
 *
 *  Loaded on first interaction rather than with the page: it is a few hundred
 *  kilobytes, most visitors came for "what goes out tomorrow", and the calendar
 *  above must not wait behind it.
 *
 *  Matching is on the translated name and the Japanese one at once, because both
 *  are things a reader might have: the word they know, or the characters they
 *  are looking at on the packaging. */
function initDictionary(root: HTMLElement, lang: Lang, t: (key: UIKey) => string): void {
  const section = root.querySelector<HTMLElement>('[data-gb-dict]');
  const search = section?.querySelector<HTMLInputElement>('[data-gb-dict-search]');
  const out = section?.querySelector<HTMLElement>('[data-gb-dict-results]');
  if (!section || !search || !out) return;
  const results = out;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  let loading: Promise<{ dict: DictFile; tr: DictLang | null }> | null = null;

  function load() {
    if (loading) return loading;
    results.innerHTML = `<p class="placeholder">${t('common.loading')}</p>`;
    loading = Promise.all([
      fetch(`${base}/data/garbage-dictionary.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DictFile>;
      }),
      // Absent for Japanese, and for any language DeepL cannot translate into
      // (Filipino) or has not been topped up to yet — the entry then shows the
      // city's own Japanese wording, which is better than showing nothing.
      lang === 'ja'
        ? Promise.resolve(null)
        : fetch(`${base}/data/garbage-dictionary.${lang}.json`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<DictLang>) : null))
            .catch(() => null),
    ]).then(([dict, tr]) => ({ dict, tr }));
    return loading;
  }

  function render(dict: DictFile, tr: DictLang | null, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '';
      return;
    }
    const name = (it: DictItem) => tr?.items[it.item] ?? it.item;
    const hits = dict.items.filter((it) => {
      const translated = tr?.items[it.item];
      return (
        it.item.toLowerCase().includes(q) ||
        (translated ? translated.toLowerCase().includes(q) : false)
      );
    });
    if (!hits.length) {
      results.innerHTML = `<p class="placeholder">${t('gb.dictNoMatch')}</p>`;
      return;
    }
    const shown = hits.slice(0, DICT_RESULTS);
    results.innerHTML =
      `<ul class="gb-dict-list">${shown
        .map((it) => {
          const label = t(`gb.cat.${it.category}` as UIKey);
          const translated = tr?.items[it.item];
          const note = it.note === null ? null : (tr?.notes[dict.notes[it.note]] ?? dict.notes[it.note]);
          const form = it.form ? (tr?.forms[it.form] ?? it.form) : null;
          return (
            '<li>' +
            `<div class="gb-dict-head"><span class="gb-dict-name">${name(it)}</span>` +
            (translated ? `<span class="gb-dict-ja">${it.item}</span>` : '') +
            (form ? `<span class="gb-dict-form">${form}</span>` : '') +
            '</div>' +
            `<div class="gb-chip-row"><span class="gb-chip" style="--gb-c:var(--gb-${groupFor(it.category)})">${label}</span>` +
            `<span class="gb-dict-flag${it.collected ? ' yes' : ''}">${t(it.collected ? 'gb.dictCollected' : 'gb.dictNotCollected')}</span>` +
            `<span class="gb-dict-flag${it.dropOff ? ' yes' : ''}">${t(it.dropOff ? 'gb.dictDropOff' : 'gb.dictNoDropOff')}</span>` +
            '</div>' +
            (note ? `<p class="gb-dict-note">${note.replace(/\n/g, '<br>')}</p>` : '') +
            '</li>'
          );
        })
        .join('')}</ul>` +
      (hits.length > shown.length
        ? `<p class="card-note">${t('gb.dictMore').replace('{n}', String(hits.length - shown.length))}</p>`
        : '');
  }

  let token = 0;
  const run = () => {
    const mine = ++token;
    const query = search.value;
    if (!query.trim() && !loading) return;
    load()
      .then(({ dict, tr }) => {
        if (mine === token) render(dict, tr, query);
      })
      .catch(() => {
        results.innerHTML = `<p class="placeholder">${t('common.error')}</p>`;
        loading = null;
      });
  };
  search.addEventListener('input', run);
  // Warm the fetch as soon as the reader shows intent, so the first keystroke
  // does not wait on the network.
  search.addEventListener('focus', () => void load(), { once: true });
}

/** The five sorting groups only cover the categories the calendars print; the
 *  dictionary also names things that are never collected at the kerb, and those
 *  get the neutral landfill-ish colour rather than a group they are not in. */
function groupFor(category: string): string {
  const groups: Record<string, string[]> = {
    burnable: ['burnable'],
    crush: ['crush'],
    landfill: ['landfill', 'bulky', 'appliancelaw', 'industrial', 'difficult'],
    plastic: ['plastic', 'bigplastic'],
    recyclables: [
      'recyclables', 'paper', 'metal', 'cloth', 'jarbottle', 'returnable', 'pet',
      'fluoro', 'spray', 'lighter', 'smallappliance', 'battery', 'thermometer',
      'hazardous', 'cookingoil',
    ],
  };
  for (const [group, members] of Object.entries(groups)) {
    if (members.includes(category)) return group;
  }
  return 'landfill';
}

export function initGarbagePage(): void {
  const root = document.querySelector<HTMLElement>('[data-garbage]');
  if (!root) return;

  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];
  const catLabel = (slug: string) => t(`gb.cat.${slug}` as UIKey);

  renderFacilities(lang, t);
  initDictionary(root, lang, t);

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const select = root.querySelector<HTMLSelectElement>('[data-gb-select]');
  const search = root.querySelector<HTMLInputElement>('[data-gb-search]');
  const matches = root.querySelector<HTMLElement>('[data-gb-matches]');
  const nextBox = root.querySelector<HTMLElement>('[data-gb-next]');
  const upcoming = root.querySelector<HTMLElement>('[data-gb-upcoming]');
  const monthBox = root.querySelector<HTMLElement>('[data-gb-month]');
  const monthLabel = root.querySelector<HTMLElement>('[data-gb-month-label]');
  const subscribe = root.querySelector<HTMLElement>('[data-gb-subscribe]');
  const legend = root.querySelector<HTMLElement>('[data-gb-legend]');
  const prevBtn = root.querySelector('[data-gb-prev]');
  const nextBtn = root.querySelector('[data-gb-next-month]');

  fetch(`${base}/data/garbage.json`, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<GarbageFile>;
    })
    .then((data) => start(data))
    .catch(() => {
      if (nextBox) nextBox.innerHTML = `<p class="placeholder">${t('common.error')}</p>`;
    });

  function start(data: GarbageFile) {
    /** Group of a category, for its colour. */
    const groupOf = new Map<string, string>();
    for (const [group, members] of Object.entries(data.groups)) {
      for (const m of members) groupOf.set(m, group);
    }

    if (legend) {
      legend.innerHTML = Object.keys(data.groups)
        .map(
          (g) =>
            `<div class="legend-row"><span class="legend-swatch" style="background:var(--gb-${g})"></span>` +
            `<span><span class="legend-name">${catLabel(g)}</span></span></div>`,
        )
        .join('');
    }

    if (select) {
      select.innerHTML = data.districts
        .map((d, i) => `<option value="${i}">${d.name}</option>`)
        .join('');
      select.addEventListener('change', () => {
        const i = Number(select.value);
        try {
          localStorage.setItem(STORE_KEY, data.districts[i]?.slug ?? '');
        } catch {}
        show(i);
      });
    }

    // 町会 → district. Matching is substring on the raw name, which is what a
    // resident types; the district's own name matches too, so "本郷" works.
    if (search && matches) {
      const index = data.districts.flatMap((d, i) => d.chokai.map((c) => ({ c, i })));
      const render = () => {
        const q = search.value.trim();
        if (!q) {
          matches.innerHTML = '';
          matches.hidden = true;
          return;
        }
        const hits = index.filter((e) => e.c.includes(q)).slice(0, 8);
        matches.hidden = false;
        matches.innerHTML = hits.length
          ? hits
              .map(
                (h) =>
                  `<button type="button" class="gb-match" data-i="${h.i}">` +
                  `<span class="gb-match-chokai">${h.c}</span>` +
                  `<span class="gb-match-district">${data.districts[h.i].name}</span></button>`,
              )
              .join('')
          : `<p class="card-note" style="margin:6px 0 0">${t('gb.noMatch')}</p>`;
      };
      search.addEventListener('input', render);
      matches.addEventListener('click', (ev) => {
        const btn = (ev.target as HTMLElement).closest<HTMLElement>('.gb-match');
        if (!btn) return;
        const i = Number(btn.dataset.i);
        if (select) select.value = String(i);
        try {
          localStorage.setItem(STORE_KEY, data.districts[i]?.slug ?? '');
        } catch {}
        search.value = '';
        matches.hidden = true;
        matches.innerHTML = '';
        show(i);
      });
    }

    /** Month currently shown in the grid; null until the first render picks one. */
    let cursor: { y: number; m: number } | null = null;

    let saved = '';
    try {
      saved = localStorage.getItem(STORE_KEY) ?? '';
    } catch {}
    const initial = Math.max(
      0,
      data.districts.findIndex((d) => d.slug === saved),
    );
    if (select) select.value = String(initial);
    show(initial);

    function show(i: number) {
      const district = data.districts[i];
      if (!district) return;
      cursor = null;
      renderNext(district);
      renderMonth(district);
      renderSubscribe(district);
    }

    function collectionDays(district: District): [string, number[]][] {
      return district.days ? Object.entries(district.days) : [];
    }

    function chips(indices: number[]): string {
      return indices
        .map((ci) => {
          const slug = data.categories[ci];
          if (!slug) return '';
          const group = groupOf.get(slug) ?? 'recyclables';
          const label = catLabel(slug);
          // The title carries the name where the chip is reduced to a colour bar
          // (the phone month grid); see the max-width 560 px block in global.css.
          return `<span class="gb-chip" style="--gb-c:var(--gb-${group})" title="${label}">${label}</span>`;
        })
        .join('');
    }

    function renderNext(district: District) {
      if (!nextBox) return;
      if (!district.days) {
        nextBox.innerHTML =
          `<p class="placeholder">${t('gb.noParse')}</p>` +
          `<p class="card-note"><a href="${district.pdf}" target="_blank" rel="noopener">` +
          `${t('gb.pdfFor').replace('{district}', district.name)} ↗</a></p>`;
        if (upcoming) upcoming.innerHTML = '';
        return;
      }
      const p = jstParts(new Date());
      const todayIso = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      const future = collectionDays(district).filter(([iso]) => iso >= todayIso);

      if (!future.length) {
        nextBox.innerHTML = `<p class="placeholder">${t('gb.seasonOver')}</p>`;
        if (upcoming) upcoming.innerHTML = '';
        return;
      }

      const [iso, cats] = future[0];
      const date = new Date(`${iso}T00:00:00+09:00`);
      const daysAway = Math.round(
        (Date.parse(`${iso}T00:00:00+09:00`) - Date.parse(`${todayIso}T00:00:00+09:00`)) / 86400000,
      );
      const when =
        daysAway === 0
          ? t('common.today')
          : daysAway === 1
            ? t('common.tomorrow')
            : new Intl.DateTimeFormat(locale(lang), {
                timeZone: 'Asia/Tokyo',
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }).format(date);

      nextBox.innerHTML =
        `<p class="gb-when">${when}` +
        (daysAway <= 1 ? ` <span class="gb-when-date">${fmtDateShort(date, lang)}</span>` : '') +
        `</p><div class="gb-chip-row">${chips(cats)}</div>` +
        `<p class="card-note gb-timing">${t('gb.putOutBy')}</p>`;

      if (upcoming) {
        upcoming.innerHTML = future
          .slice(1, UPCOMING + 1)
          .map(([d, cs]) => {
            const day = new Date(`${d}T00:00:00+09:00`);
            return (
              `<li><span class="when">${fmtWeekday(day, lang)} ${fmtDateShort(day, lang)}</span>` +
              `<span class="what"><span class="gb-chip-row">${chips(cs)}</span></span></li>`
            );
          })
          .join('');
      }
    }

    function renderMonth(district: District) {
      if (!monthBox) return;
      if (!district.days) {
        monthBox.innerHTML = '';
        if (monthLabel) monthLabel.textContent = '';
        return;
      }
      if (!cursor) {
        const p = jstParts(new Date());
        // Clamp to the published fiscal year, so April's calendar is still
        // readable in March and the grid is never empty on arrival.
        const first = `${p.y}-${pad2(p.m)}-01`;
        cursor =
          first < data.from
            ? { y: Number(data.from.slice(0, 4)), m: Number(data.from.slice(5, 7)) }
            : first > data.to
              ? { y: Number(data.to.slice(0, 4)), m: Number(data.to.slice(5, 7)) }
              : { y: p.y, m: p.m };
      }
      const { y, m } = cursor;
      if (monthLabel) {
        monthLabel.textContent = new Intl.DateTimeFormat(locale(lang), {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: 'long',
        }).format(new Date(`${y}-${pad2(m)}-01T00:00:00+09:00`));
      }

      const p = jstParts(new Date());
      const todayIso = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      const firstDow = new Date(y, m - 1, 1).getDay();
      const inMonth = new Date(y, m, 0).getDate();
      const weekdays = Array.from({ length: 7 }, (_, i) =>
        fmtWeekday(new Date(2024, 8, 1 + i), lang),
      ); // 1 Sep 2024 was a Sunday

      let cells = '';
      for (let i = 0; i < firstDow; i++) cells += '<div class="gb-cell empty"></div>';
      for (let d = 1; d <= inMonth; d++) {
        const iso = `${y}-${pad2(m)}-${pad2(d)}`;
        const cats = district.days[iso];
        cells +=
          `<div class="gb-cell${iso === todayIso ? ' today' : ''}">` +
          `<span class="gb-day">${d}</span>` +
          (cats ? `<div class="gb-cell-chips">${chips(cats)}</div>` : '') +
          '</div>';
      }
      monthBox.innerHTML =
        `<div class="gb-grid-head">${weekdays.map((w) => `<div>${w}</div>`).join('')}</div>` +
        `<div class="gb-grid">${cells}</div>`;
    }

    prevBtn?.addEventListener('click', () => step(-1));
    nextBtn?.addEventListener('click', () => step(1));

    function step(delta: number) {
      if (!cursor) return;
      const d = new Date(cursor.y, cursor.m - 1 + delta, 1);
      const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      if (ym < data.from.slice(0, 7) || ym > data.to.slice(0, 7)) return;
      cursor = { y: d.getFullYear(), m: d.getMonth() + 1 };
      const i = Number(select?.value ?? 0);
      renderMonth(data.districts[i]);
    }

    function renderSubscribe(district: District) {
      if (!subscribe) return;
      if (!district.days) {
        // The next-collection card has already said why there is no calendar;
        // repeating the paragraph here would just push the PDF link down.
        subscribe.innerHTML =
          `<p><a class="gb-cta" href="${district.pdf}" target="_blank" rel="noopener">` +
          `${t('gb.pdfFor').replace('{district}', district.name)} ↗</a></p>`;
        return;
      }
      const path = `${base}/${lang}/garbage/${district.slug}.ics`;
      const abs = new URL(path, location.href).href;
      subscribe.innerHTML =
        `<p><a class="gb-cta" href="${abs.replace(/^https?:/, 'webcal:')}">${t('gb.subscribe')}</a></p>` +
        `<p class="card-note">${t('gb.subscribeDesc')}</p>` +
        `<p class="card-note"><a href="${path}" download>${t('gb.download')}</a>` +
        ` · <a href="${district.pdf}" target="_blank" rel="noopener">` +
        `${t('gb.pdfFor').replace('{district}', district.name)} ↗</a></p>`;
    }
  }
}

/** "Open now · until 16:30" / "Closed · opens Mon 08:30" on the two centres. */
function renderFacilities(lang: Lang, t: (key: UIKey) => string): void {
  const now = new Date();
  for (const el of document.querySelectorAll<HTMLElement>('[data-gb-facility]')) {
    const key = el.dataset.gbFacility as FacilityKey;
    if (!(key in FACILITIES)) continue;
    const s = facilityState(key, now, lang);
    const label = s.open
      ? `${t('gb.openNow')} · ${t('gb.until').replace('{time}', s.at ?? '')}`
      : s.at
        ? `${t('gb.closedNow')} · ${t('gb.opens').replace('{when}', [s.day, s.at].filter(Boolean).join(' '))}`
        : t('gb.closedNow');
    el.className = `badge ${s.open ? 'ok' : ''}`.trim();
    el.innerHTML = `<span class="dot" style="background:var(--${s.open ? 'status-good' : 'muted'})"></span>${label}`;
  }
}
