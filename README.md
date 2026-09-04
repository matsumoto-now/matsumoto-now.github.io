# Matsumoto Now · 松本なう

An unofficial live dashboard for citizens of Matsumoto City, Nagano, in
13 languages (English, 日本語, Français, Español, Português, Italiano, Deutsch,
Norsk, 中文, 한국어, Filipino, Tiếng Việt, ไทย): weather, warnings, air quality,
pollen, earthquakes, city alerts, crime statistics, city buses, evacuation
shelters & AEDs, emergency medical contacts, fire & rescue information and the
household waste collection calendar —
all from free public data
sources, hosted for free on GitHub Pages.

## How it works

- **Static site** built with [Astro](https://astro.build). No server, no cost.
- **Live data in the browser.** CORS-open APIs are fetched directly by the
  visitor's browser, so the dashboard is current to the minute:
  - JMA AMeDAS observations (Matsumoto station 48361) and warnings/advisories
    (Nagano 200000) — undocumented but long-stable `jma.go.jp/bosai` JSON
  - Open-Meteo forecast, UV, and modelled air quality (CC BY 4.0, free for
    non-commercial use)
  - Weathernews "Pollen Robo" open data (city code 20202, attribution required)
  - P2P地震情報 earthquake API (secondary use permitted)
- **Scheduled fetch for everything else.** Sources without CORS headers
  (Matsumoto City RSS feeds, Matsumoto Anshin-net) are pulled every 30 minutes
  by a GitHub Action (`.github/workflows/fetch-data.yml`) into
  `public/data/alerts.json` and committed, which redeploys the site.
  Slow-moving open data (police crime CSVs, GTFS bus feeds, shelter/AED
  designations, the waste collection calendar) is refreshed monthly by
  `.github/workflows/fetch-monthly.yml` into
  `public/data/{crime,bus,shelters,garbage}.json`. The 30-minute job also fetches
  the heat index and heat alerts into `public/data/heat.json` while
  `heatIndex` is on. The bus fetch also scrapes the
  city's bus page for each line's own timetable and fare PDF: every link there
  is labelled identically (`時刻表（R8.3.14～）`) with the line name in the
  `<h5>` above it, and the attachment IDs change at every timetable revision,
  so the mapping is re-derived monthly rather than hardcoded. Only the URLs are
  stored — the PDFs are linked, never copied. If the scrape fails or a line
  stops matching, `timetable` is `null` and the page links the city's index
  page for that line instead; the run logs `per-line timetables: n/34`.
- **i18n**: every page exists under each language slug (`/en/`, `/ja/`,
  `/fr/`, `/es/`, `/pt/`, `/it/`, `/de/`, `/no/`, `/zh/`, `/ko/`, `/tl/`,
  `/vi/`, `/th/`); the root redirects by browser language. Each language is
  one module in `src/i18n/locales/` holding the UI dictionary plus JMA
  warning, WMO weather-code, and compass labels — `npx tsx
  scripts/check-locales.mjs` verifies every locale has exactly the same keys.
  City-alert titles are machine-translated (DeepL) to English and French
  only; other languages show the English title. The Resources and About
  pages are curated in en/ja/fr and fall back to English elsewhere.

## Local development

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production build in dist/
npm run fetch-data # populate public/data/alerts.json from the live city feeds
```

`npm run fetch-monthly` additionally needs `pdftotext` (poppler-utils) on PATH,
which is what reads the waste collection calendars:
`brew install poppler` / `apt install poppler-utils`.

## Deploy to GitHub Pages

1. Create a GitHub repository (any name — the base path is derived
   automatically) and push this project to `main`.
2. In the repository: **Settings → Pages → Source: GitHub Actions**.
3. Push (or run the "Deploy to GitHub Pages" workflow manually). The site
   appears at `https://<username>.github.io/<repo>/`.
4. Optional — English/French translation of city alerts: create a free DeepL
   API account and add the key as a repository secret named `DEEPL_API_KEY`
   (**Settings → Secrets and variables → Actions**). Without it, alert titles
   are shown in Japanese on every non-Japanese page. (Only EN and FR are
   machine-translated, to preserve the DeepL free-tier quota; other languages
   reuse the English titles.)

The scheduled fetch workflow needs no setup; it starts running on schedule
once the repo is on GitHub. (GitHub may pause schedules on inactive forks —
re-enable under the Actions tab.)

## Page structure

The landing page (**"Now"**) is emergency-first: active JMA warnings, who to
call (119 fire & ambulance, 110 police, medical advice lines), and any
earthquake actually felt in Matsumoto or Nagano. Nothing else. Weather,
forecast, air quality and UV live on their own **weather page**, so the landing
page stays scannable when something is wrong.

Its earthquake card filters to locally-felt quakes on purpose: of the last 100
reports nationwide (about two days' worth) typically **none** are felt in
Matsumoto, so an unfiltered list fills the second-largest block with tremors
hundreds of km away. When nothing has been felt it says so in one line. The
full nationwide list stays on the earthquakes page.

Both pages share `src/lib/dashboard.ts` via `initWidgets()`, which renders only
the widgets present in the DOM — so a card moves between pages by moving its
markup, with no change to the renderer.

On the **buses page** the route chips are a selector, not links: picking a line
dims the other 33, zooms to its extent and shows that line's stops at any zoom
level (stop membership comes from `bus-times.json`, which is the only file that
links stops to routes), while a panel above the chips links that line's own
timetable and fare PDFs. The chips used to be 34 links to the same city page,
which is what made them feel broken. The map does the explaining because the
PDFs are Japanese-only — for the other 12 languages, "where does this bus go"
has to be answered visually.

The **weather page** treats "is this number good or bad?" as the thing to
answer, not the number itself. Air quality leads with the US EPA index
(`us_aqi`, computed by Open-Meteo from all pollutants) — one 0–500 figure with a
colour, a band name and one sentence of health advice — and the four raw
concentrations sit below it, each dotted with its own band so you can see which
pollutant is driving the index. A chip row switches the 48-hour chart between
the index and each pollutant.

Every chart on the page is coloured per bar rather than in one hue, so a glance
finds the dangerous hour: UV, the index and the pollutants share one six-step
ramp (`--aqi-1` … `--aqi-6`, the site's status colours plus the EPA's purple and
maroon), defined once in `src/lib/scales.ts` with the EPA and WHO thresholds
they come from. Rain deliberately uses the sequential blue ramp instead —
heavy rain is wet, not hazardous, and colouring a 90 % chance red would be
crying wolf on the page that also carries evacuation advice.

Rain shows chance **and** amount as two charts, because they answer different
questions: a 90 % chance of 0.2 mm is drizzle, a 30 % chance of 15 mm is worth
planning around. Each chart's tooltip carries the other figure.

Every scale a resident has no reason to already know has a collapsed "what does
this mean?" panel: a colour legend with per-band advice, and for air quality a
plain-language definition of PM2.5, PM10, ozone and NO₂ — what they are, where
they come from and what they do to you. These are written and translated in all
13 languages rather than linking to Wikipedia, whose leads are chemistry rather
than health advice and whose coverage across these 13 languages is uneven.

Three more weather cards answer questions one number cannot:

- **Heat index** (`heatIndex`). The 暑さ指数 (WBGT) is not the temperature — it
  folds in humidity and sunlight, and it is what predicts heat stroke. When 環境省
  issues a 熱中症警戒アラート for Nagano the card leads with the alert banner,
  because an alert is an instruction and outranks any reading. Seasonal: the
  ministry publishes from late April to 21 October, and `scripts/fetch-heat-data.mjs`
  writes `season: false` on the expected off-season 404 so the card says so
  instead of showing an error. Watch the units — the forecast feed is in tenths
  of a degree, the observed feed in degrees.
- **Around the city** (`stationMap`). Four AMeDAS stations sit inside the city
  limits, from 610 m downtown to 1,510 m at Kamikochi, and on a summer night
  Nagawa runs ~7 °C colder than the centre while both reach the same temperature
  by midday. The reading *is* the map marker — a pin plus a legend would make the
  reader look twice for the only thing the map exists to show. Kamikochi has a
  rain gauge but no thermometer, so its marker says so rather than going blank.
  Leaflet is behind a dynamic import here: `dashboard.ts` is shared with the
  landing page, which has no map and should not pay ~150 kB for one.
- **Moon** (`moon`). Phase and rise/set are computed from the orbit in
  `src/lib/moon.ts` — no API, no network. The disc itself is a NASA/GSFC
  photograph of the near side (`public/images/moon.jpg`, 13 kB, public domain),
  clipped to the terminator: the near side always faces us, so the image never
  rotates and only the clip changes. Both layers are clipped to a circle —
  without that, the dimmed earthshine layer shows the photo's black sky corners
  as a grey box around the moon. Two things in there are easy to get wrong and were:
  the phase must come from the elongation, not the bright-limb position angle,
  which flips sign at new and full moon and sends a "next new moon" search to
  the wrong date; and in the two-arc disc path the terminator's sweep flips
  between crescent and gibbous, so getting it backwards renders the whole cycle
  inside-out — new moon as a full disc.

The **waste page** answers three questions in that order: what goes out where
you live and when, how to get that into your own calendar, and where to take
what the trucks will not.

The city publishes the collection calendar as 41 per-district A3 PDFs — one per
district, no HTML and no CSV — so `scripts/fetch-garbage-data.mjs` reads them
with `pdftotext -bbox-layout` and recovers the grid from the word coordinates:
six month blocks per page (Apr–Sep on the front, Oct–Mar on the back), a
seven-column week, and each day's collection codes printed ~20 pt below the day
number and centred on the same column. 40 of the 41 parse; the whole city, a
full fiscal year and the 町会 index come to 17 kB gzipped, so every district
ships in one file and switching district costs no network.

Three assertions have to hold per district or it is marked unparsed and the page
links its PDF instead — the same discipline as `timetable: null` on the buses
page:

- twelve month blocks in fiscal order;
- every day of every month present exactly once, **and the column a day sits in
  equal to that date's real weekday**. This is the one that matters: a layout
  change that shifted the grid by one column would otherwise quietly move every
  resident's collection day, and nothing on the page would look wrong;
- every collection code (`可`, `プラ資・破`, `雑・ペ・小・電`, …) already in the code
  table. An unrecognised code is reported by name and never guessed at, because a
  new code means the city changed something a person should read.

Two layout variants are handled: 島内A/B print the month label at the top *left*
of its block where every other district puts it top right, so blocks are split
by page half rather than by where the label is. 安曇 publishes a combined
「くらしのカレンダー」 on an entirely different template and does not parse. As with
the bus timetables, the 41 attachment IDs and the fiscal year are re-derived from
the index page every run: the city replaces the whole set each April.

The district is chosen by **町会** as well as from the list of 41. Nobody knows
they live in 第一地区; they know they live in 中町2丁目. The 467 neighbourhood names
come out of the same PDFs, so the lookup costs nothing to maintain.

Each district also gets a **calendar subscription**, one `.ics` per language
(`/[lang]/garbage/<district>.ics`, 520 files). This is the only part of the site
that can reach a resident who is not looking at it: a static site cannot push a
notification, but every event carries a `VALARM` at `-PT5H`, so the phone says
"plastic tomorrow" at 19:00 the evening before, while there is still time to act.
It is served as a subscription rather than a download so next April's reissue
propagates on its own, and the UIDs are stable per district and date so a re-read
updates events in place instead of duplicating them. `DTSTAMP` is the data file's
fetch time, not the build time — the deploy runs on every push, and a moving
`DTSTAMP` would tell every subscriber that all 190 events had changed.

Colour is by the city's five sorting groups and is never the only signal: every
chip carries its category name, because a reader who could already read the label
on the bag would not need the page. Below ~560 px a seven-column grid gives each
cell about 45 px and "Plastic packaging (プラスチック資源)" wraps to one character per
line, so on phones the month view drops to one coloured bar per category — the
fully labelled list of coming collections sits directly above it, and the names
stay in the DOM, clipped rather than removed, for screen readers.

The two drop-off centres carry an **open/closed now** chip, which is why
`src/lib/jp-holidays.ts` exists: both close on Sundays and public holidays, and a
hardcoded "open Mon–Sat" would be wrong on the ~16 holidays a year — Golden Week
and the New Year fortnight included, which is exactly when someone has a car full
of rubbish. Like `moon.ts` it is arithmetic rather than data: fixed dates, the
happy-Monday rules, the equinoxes, 振替休日 and 国民の休日. Where the city page and the
centre's own page disagree about the year-end closure, the page takes the
stricter reading and links the centre's notice — sending someone home from a
locked gate with a loaded car is the worse error.

All three maps (buses, shelters, earthquakes) carry an **expand** button next to
the locate button, which grows the map to fill the window (Escape or the button
again returns it). It is a fixed-position CSS overlay, not the Fullscreen API:
iOS Safari still refuses `requestFullscreen()` on anything but a `<video>`, and
a phone is exactly where a 340 px-tall map is too small to follow a bus line.

**About & Data** ends with a **Terms of use** section (`#terms`) rather than a
separate page: no warranty, don't rely on it in an emergency, the reader is
responsible for their own use, unofficial and unaffiliated, whose data it is,
privacy, and how it may change. Its date is a constant in `about.astro`
(`TERMS_REVISED`) rather than the build date — the build date moves on every
deploy and would imply the terms had been revised when they had not. The
privacy paragraph is a factual claim worth keeping true: the site sets no
cookies, runs no analytics, and `localStorage` holds only the language and
theme choice. Geolocation never leaves the browser.

The nav wraps rather than scrolls horizontally: with 12 destinations (longer
labels in German and French) a scrolling strip with a hidden scrollbar left
items unreachable on phones. Every destination is now one tap away at every
width — verified at 375 px in every language, where German now wraps to five
rows.

**Capitalisation**, because it is easy to get wrong when adding a page: in the
Latin-script locales — French, Spanish, Italian, Portuguese, Norwegian, Filipino
and Vietnamese included — nav labels, page titles and card `<h2>`s are Title
Case, with each language's own short function words left lowercase: *Abris
d'Évacuation & DAE*, *Prévisions à 7 Jours*, *Cảnh Báo & Thông Báo của Thành
Phố*. German follows German orthography rather than English Title Case (*Über
die Seite & Daten*). Everything smaller stays sentence case: the collapsed
`<summary>` of a "what does this mean?" panel, table column headings, `<dt>`
field labels, and link and button text. CJK and Thai are unaffected.

## Feature toggles

Every dashboard card and secondary page can be switched on/off in
`src/features.ts` — set a flag to `false` and push. Disabled cards disappear
from the dashboard (and their APIs are no longer called); disabled pages are
not built and vanish from the navigation.

Currently `pollen` is **off** pending Weathernews' confirmation that
public-site use of the Pollen Robo open data is acceptable, `fireLiveData`
is **off** pending 松本広域消防局's confirmation (see below) — the fire page
itself stays up, showing only what needs no permission — and
`garbageDictionary` is **off** because it needs permission, not merely
clarification. The city's site terms are prohibitive by default —
「松本市の許可なく当サイトに掲載されている文書・画像等を無断使用・複製・転載…することはできません」
(`/site/userguide/58387.html`) — and the open-data catalogue is the carve-out,
naming datasets one at a time. The collection calendar and the sorting guide are
named in it (CC BY 4.0, no permission needed); the 「ごみ処理辞典」 pages are not, so
reproducing their ~1,700 rows needs a yes from 環境業務課. Linking them needs
nothing, which is what the page does today. The waste page stays up either way: the calendar half needs
no permission, and the dictionary is linked rather than reproduced.

Attribution is derived from the feature flags in three places, never hardcoded:
the per-card notes where the data appears, the table on the **About & Data**
page, and a short footer line naming only the providers whose licence requires
attribution wherever their data is shown (CC BY 4.0, or the Government Standard
Terms' 出典 requirement). P2P地震情報 permits secondary use without attribution,
so it appears in the About table only — hence the footer line ends with a link to
the full list rather than pretending to be one.

Gate a new source on the flag that actually **displays** it, not the flag that
builds its page: the fire bureau is credited under `fireLiveData`, not
`firePage`, because with the scraped feeds off the site only links to them. The
old hardcoded footer had drifted exactly this way — it credited Weathernews while
`pollen` was off, and omitted GSI, the police crime data and gtfs-data.jp.

## Data sources & terms

| Source | Used for | Terms |
|---|---|---|
| Japan Meteorological Agency | observations, warnings | attribution (出典: 気象庁); endpoints are undocumented and may change |
| Open-Meteo | forecast, UV, air quality | free non-commercial, CC BY 4.0, attribution |
| Weathernews Pollen Robo | pollen counts | attribution required; for a public site, confirm usage with Weathernews |
| P2P地震情報 | earthquakes | secondary use permitted; rate limits apply |
| Matsumoto City / 松本安心ネット | alerts, news | attribution (city terms, CC BY 4.0-aligned) |
| 長野県警察 犯罪オープンデータ | crime statistics | CC BY 4.0-compatible, attribution |
| 環境省 熱中症予防情報サイト | heat index (WBGT), 熱中症警戒アラート | PDL 1.0, attribution (出典: 環境省); published for third-party reuse, no permission needed |
| 松本市 GTFS (gtfs-data.jp) | bus routes & stops | CC BY 4.0, attribution (松本市) |
| 松本市 バス時刻表ページ | per-line timetable & fare PDF links | city page, CC BY 4.0; only the URLs are stored, the PDFs are linked |
| 松本市 ごみ・資源物収集日程表 | household collection calendar (41 districts) | listed in the city's open-data catalogue, CC BY 4.0, attribution 松本市 |
| 松本市 ごみ処理辞典（ごみだす） | item-by-item disposal index (disabled) | **not** in the open-data catalogue, so the site's default "no reuse without permission" applies — ask 環境業務課 before enabling `garbageDictionary` |
| 国土地理院 指定緊急避難場所データ | evacuation shelters | attribution (政府標準利用規約) |
| 松本市オープンデータ | AED locations | CC BY 4.0, attribution |
| 環境省 そらまめくん | measured air quality (disabled) | preliminary values; non-national stations: confirm reuse with the operator (長野県) |
| 松本広域消防局 | live fire reports, 119 dispatch counts, fire statistics (disabled) | **no published licence or terms** — ask the bureau before enabling `firePage` |
| 国土地理院 (GSI) | map tiles | attribution |

**Disclaimer:** this is a volunteer community project, not affiliated with
Matsumoto City, JMA, or any data provider. Data may be delayed or wrong; in an
emergency follow official guidance (110 police / 119 fire & ambulance).

## Ideas for later

- Live police incident feed (bears, suspicious persons, scams): the Raiporisu
  web map (map.police.nagano.dsvc.jp) exposes fresh public TSVs, but the
  Nagano Police terms prohibit republication without permission — ask
  生活安全企画課 first. The Safety page links to the official map instead.
- Duty-doctor (休日当番医) live schedule: the Matsumoto City Medical
  Association publishes a clean daily rotation at matsu-med.or.jp, but their
  terms prohibit reproduction without written permission — ask them first.
  (The medical page currently links out instead.)
- Stop-first bus view ("what leaves from *my* stop", or the ordered stop list
  of a line). `bus-times.json` aggregates departures per stop/route/service
  with no `stop_sequence`, so ordering by first departure interleaves services
  and produces a wrong sequence — it would need `scripts/fetch-bus-data.mjs` to
  carry the sequence through from `stop_times.txt`.
- Crime map (the police CSVs have neighborhood names but no coordinates —
  would need geocoding against MLIT 位置参照情報).
- Enable `measuredAir` once Nagano Prefecture confirms republication of the
  Soramame station values (pipeline is ready in `scripts/fetch-air-data.mjs`).
- Enable `firePage` once 松本広域消防局 confirms republication of their 災害発生状況 incident feed,
  指令件数 dispatch counters and 火災発生状況 statistics. Their site permits
  crawling (robots.txt) but publishes no open-data licence, so consent has to
  be asked for — draft inquiry at `Desktop/Test/matsumoto-fire-bureau-email.md`
  (outside the repo), contact form at m-kouiki119.jp or (0263)25-0119. Both
  pipelines are ready: `scripts/fetch-fire-data.mjs` (30 min) and
  `scripts/fetch-fire-stats.mjs` (monthly). No fire data is committed to
  `public/data/` while the flag is off, so nothing is republished early.
- Searchable in-page waste dictionary — the UI does not exist yet, only the
  pipeline, so `garbageDictionary: true` would currently fetch and display
  nothing. `scripts/fetch-garbage-dictionary.mjs` yields 1,675 items across 20 categories with 536 distinct 備考, which
  it interns — that is what makes translation affordable: after de-duplication a
  language costs ~43 k characters (7.6 k of item names, 31 k of notes), one-time,
  cached by source string, against content that changes once a year. Nothing is
  committed to `public/data/` while `garbageDictionary` is off.
- The 特別収集 dates (tyres, fire extinguishers, gas cylinders, car batteries) and
  the mid-year rule changes are printed on the district calendars and exist
  nowhere else, but sit outside the month grids the parser reads. Worth
  extracting: they are the least findable thing on the sheet.
- 安曇 and 島内A/B: 島内 now parses, 安曇's 「くらしのカレンダー」 still needs its own
  layout branch (or should stay a PDF link — it is one district).
- No fire-station map: residents dial 119 rather than travel to a station, and
  the ~15 Matsumoto fires a year are too sparse — and too close to
  sensationalism — to map at 町丁目 precision. The fire page shows live state
  instead.
