/** Dashboard hydration: fetches all live sources in parallel and renders widgets. */

import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import { fmtTime, fmtDateShort, fmtWeekday, fmtDateTime, fmtNum } from './format';
import { fetchAmedasNow, windDirLabel } from './jma';
import { renderWarnings } from './warnings-banner';
import { fetchForecast, fetchAirQuality, pm25Level, type Forecast } from './openmeteo';
import {
  BAND_COLOR,
  aqiBand,
  pollutantBand,
  uvBand,
  uvLevelOf,
  rainColor,
  popColor,
  heatLevel,
  heatBand,
  HEAT_BAND,
  type HeatLevel,
  type BandKey,
  type Pollutant,
  type UvLevel,
} from './scales';
import { fetchPollenToday, pollenLevel } from './pollen';
import { fetchQuakes, intensityLabel } from './quakes';
import { lineChart, barChart, chartMessage } from './chart';
import { wmoIcon, wmoLabel } from './wmo';
import { moonInfo, moonDiscPath } from './moon';

function widget(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-widget="${name}"]`);
}

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const LEVEL_COLORS: Record<string, string> = {
  good: 'var(--status-good)',
  moderate: 'var(--status-warning)',
  elevated: 'var(--status-serious)',
  high: 'var(--status-critical)',
  low: 'var(--status-good)',
  medium: 'var(--status-warning)',
  veryHigh: 'var(--status-critical)',
  extreme: 'var(--status-critical)',
  advisory: 'var(--status-warning)',
  warning: 'var(--status-serious)',
  emergency: 'var(--status-critical)',
};

function badge(text: string, levelKey: string): HTMLElement {
  const b = make('span', 'badge');
  const dot = make('span', 'dot');
  dot.style.background = LEVEL_COLORS[levelKey] ?? 'var(--muted)';
  b.appendChild(dot);
  b.appendChild(document.createTextNode(text));
  return b;
}

/** Badge coloured from the six-step band ramp shared by the AQI, pollutant and
 *  UV charts, rather than from the four-step status palette. */
function bandBadge(text: string, band: BandKey): HTMLElement {
  const b = make('span', 'badge');
  const dot = make('span', 'dot');
  dot.style.background = BAND_COLOR[band];
  b.appendChild(dot);
  b.appendChild(document.createTextNode(text));
  return b;
}

/** Collapsed "what does this mean?" panel. Collapsed by default so the numbers
 *  stay the point of the card, but present on every card that shows a scale a
 *  resident has no reason to already know. */
function explainer(summary: string, build: (body: HTMLElement) => void): HTMLElement {
  const details = make('details', 'guide') as HTMLDetailsElement;
  const head = make('summary', undefined, summary);
  details.appendChild(head);
  const body = make('div', 'guide-body');
  build(body);
  details.appendChild(body);
  return details;
}

/** One "▇ Name — advice" row of a colour-band legend. */
function legendRow(band: BandKey, range: string, name: string, advice: string): HTMLElement {
  const row = make('div', 'legend-row');
  const swatch = make('span', 'legend-swatch');
  swatch.style.background = BAND_COLOR[band];
  row.appendChild(swatch);
  const text = make('div');
  const title = make('span', 'legend-name', name);
  text.appendChild(title);
  text.appendChild(make('span', 'legend-range', ` ${range}`));
  text.appendChild(make('div', 'legend-advice', advice));
  row.appendChild(text);
  return row;
}

function setUpdated(selector: string, d: Date, lang: Lang, t: (k: UIKey) => string): void {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.textContent = `${t('common.updated')} ${fmtTime(d, lang)}`;
}

const decimal = (lang: Lang) => (v: number) =>
  Number.isInteger(v) ? fmtNum(v, lang) : fmtNum(v, lang, 1);

/* ---- widgets ----------------------------------------------------------- */

async function initNow(
  lang: Lang,
  t: (k: UIKey) => string,
  forecastP: Promise<Forecast> | null,
): Promise<void> {
  const host = widget('now');
  if (!host) return;
  try {
    const now = await fetchAmedasNow();
    host.textContent = '';

    const heroWrap = make('div');
    heroWrap.style.display = 'flex';
    heroWrap.style.alignItems = 'center';
    heroWrap.style.gap = '18px';

    const hero = make('div', 'hero-figure');
    if (now.temp !== null) {
      hero.appendChild(document.createTextNode(fmtNum(now.temp, lang, 1)));
      hero.appendChild(make('span', 'unit', '°C'));
    } else {
      hero.textContent = '—';
    }
    heroWrap.appendChild(hero);
    const cond = make('div');
    cond.style.fontSize = '15px';
    cond.style.color = 'var(--ink-2)';
    heroWrap.appendChild(cond);
    host.appendChild(heroWrap);

    const stats = make('div', 'stat-row');
    const stat = (label: string, value: string, unit?: string) => {
      const s = make('div', 'stat');
      s.appendChild(make('div', 'label', label));
      const v = make('div', 'value', value);
      if (unit) v.appendChild(make('span', 'unit', unit));
      s.appendChild(v);
      stats.appendChild(s);
      return s;
    };
    if (now.humidity !== null) stat(t('now.humidity'), fmtNum(now.humidity, lang), '%');
    if (now.windSpeed !== null)
      stat(t('now.wind'), `${windDirLabel(now.windDirection, lang)} ${fmtNum(now.windSpeed, lang, 1)}`, ' m/s');
    stat(t('now.precip1h'), fmtNum(now.precipitation1h ?? 0, lang, 1), ' mm');
    if (now.sun1h !== null) stat(t('now.sun1h'), fmtNum(Math.round(now.sun1h * 60), lang), ' min');
    if (now.snow !== null && now.snow > 0) stat(t('now.snow'), fmtNum(now.snow, lang), ' cm');
    host.appendChild(stats);

    setUpdated('[data-now-updated]', now.time, lang, t);

    // condition icon/label arrives with the forecast
    if (!forecastP) return;
    try {
      const fc = await forecastP;
      const icon = make('div', undefined, wmoIcon(fc.current.weatherCode));
      icon.style.fontSize = '34px';
      icon.style.lineHeight = '1.1';
      cond.appendChild(icon);
      cond.appendChild(make('div', undefined, wmoLabel(fc.current.weatherCode, lang)));
    } catch {
      /* condition is decoration; ignore */
    }
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

async function initForecast(
  lang: Lang,
  t: (k: UIKey) => string,
  forecastP: Promise<Forecast> | null,
): Promise<void> {
  if (!forecastP) return;
  const hostTemp = widget('hourly-temp');
  const hostWeek = widget('week');
  const hostPrecip = widget('precip');
  const hostUv = widget('uv');
  try {
    const fc = await forecastP;
    const nowMs = Date.now();
    const next24 = fc.hourly.filter((h) => h.time.getTime() >= nowMs - 30 * 60 * 1000).slice(0, 24);

    if (hostTemp) {
      lineChart(
        hostTemp,
        next24.map((h) => ({ label: fmtTime(h.time, lang), value: h.temp })),
        {
          seriesName: t('now.temperature'),
          unit: '°C',
          height: 230,
          xEvery: 4,
          valueFmt: decimal(lang),
          tableLabel: t('common.viewTable'),
          tableHead: [t('common.time'), `${t('now.temperature')} (°C)`],
        },
      );
      setUpdated('[data-forecast-updated]', fc.current.time, lang, t);
    }

    if (hostPrecip) {
      hostPrecip.textContent = '';
      const mm = (v: number) => `${fmtNum(v, lang, 1)} mm`;
      const total = next24.reduce((sum, h) => sum + h.precip, 0);

      const totalStat = make('div', 'stat-row');
      const s = make('div', 'stat');
      s.appendChild(make('div', 'label', t('forecast.precipTotal')));
      const v = make('div', 'value', fmtNum(total, lang, 1));
      v.appendChild(make('span', 'unit', ' mm'));
      s.appendChild(v);
      totalStat.appendChild(s);
      hostPrecip.appendChild(totalStat);

      // two charts, because they answer different questions: whether to take an
      // umbrella, and whether the umbrella will be enough
      // side by side when wide: the charts have a fixed aspect ratio, so one
      // full-width chart would scale up to an oversized block
      const pair = make('div', 'chart-pair');
      hostPrecip.appendChild(pair);
      const colChance = make('div');
      const colAmount = make('div');
      pair.append(colChance, colAmount);
      colChance.appendChild(make('p', 'card-sub chart-title', t('forecast.precipChance')));
      const chance = make('div');
      colChance.appendChild(chance);
      barChart(
        chance,
        next24.map((h) => ({ label: fmtTime(h.time, lang), value: h.pop })),
        {
          seriesName: t('forecast.pop'),
          unit: '%',
          height: 170,
          yDomain: [0, 100],
          xEvery: 4,
          colorFor: (val) => popColor(val),
          tipExtra: (i) => mm(next24[i]!.precip),
          tableLabel: t('common.viewTable'),
          tableHead: [t('common.time'), `${t('forecast.pop')} (%)`],
        },
      );

      colAmount.appendChild(make('p', 'card-sub chart-title', t('forecast.precipAmount')));
      const amount = make('div');
      colAmount.appendChild(amount);
      barChart(
        amount,
        next24.map((h) => ({ label: fmtTime(h.time, lang), value: h.precip })),
        {
          seriesName: t('forecast.precipAmount'),
          unit: ' mm',
          height: 170,
          yDomain: [0, Math.max(2, ...next24.map((h) => h.precip)) * 1.2],
          xEvery: 4,
          valueFmt: decimal(lang),
          colorFor: (val) => rainColor(val),
          tipExtra: (i) => `${fmtNum(next24[i]!.pop, lang)} %`,
          tableLabel: t('common.viewTable'),
          tableHead: [t('common.time'), `${t('forecast.precipAmount')} (mm)`],
        },
      );

      hostPrecip.appendChild(
        explainer(t('forecast.precipGuide'), (body) => {
          body.appendChild(make('p', undefined, t('forecast.precipGuideIntro')));
        }),
      );
    }

    if (hostWeek) {
      hostWeek.textContent = '';
      const strip = make('div', 'day-strip');
      fc.daily.forEach((d, i) => {
        const card = make('div', 'day-card');
        const name =
          i === 0 ? t('common.today') : i === 1 ? t('common.tomorrow') : fmtWeekday(d.date, lang);
        card.appendChild(make('div', 'd-name', name));
        card.appendChild(make('div', 'd-date', fmtDateShort(d.date, lang)));
        const icon = make('div', 'd-icon', wmoIcon(d.weatherCode));
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', wmoLabel(d.weatherCode, lang));
        card.appendChild(icon);
        card.appendChild(make('div', 'd-cond', wmoLabel(d.weatherCode, lang)));
        const temps = make('div', 'd-temps');
        temps.appendChild(make('span', 'hi', `${fmtNum(d.tMax, lang)}°`));
        temps.appendChild(document.createTextNode(' / '));
        temps.appendChild(make('span', 'lo', `${fmtNum(d.tMin, lang)}°`));
        card.appendChild(temps);
        card.appendChild(make('div', 'd-pop', `${t('forecast.pop')} ${fmtNum(d.popMax, lang)}%`));
        strip.appendChild(card);
      });
      hostWeek.appendChild(strip);
    }

    if (hostUv) {
      hostUv.textContent = '';
      const today = fc.daily[0];
      // today's own hours, not the next 24, so "the peak" is the peak of a day
      const todayKey = (fc.daily[0]?.date ?? new Date()).toDateString();
      const uvHours = fc.hourly.filter((h) => h.time.toDateString() === todayKey);
      const peak = uvHours.reduce<(typeof uvHours)[number] | null>(
        (best, h) => (best === null || h.uv > best.uv ? h : best),
        null,
      );
      if (today) {
        const uv = peak ? peak.uv : today.uvMax;
        const band = uvBand(uv);
        const level = uvLevelOf(uv);
        const head = make('div', 'aqi-head');
        const hero = make('div', 'hero-figure', fmtNum(uv, lang, 1));
        hero.style.fontSize = '44px';
        hero.style.color = BAND_COLOR[band];
        head.appendChild(hero);
        const side = make('div');
        side.appendChild(bandBadge(t(`forecast.uv.${level}` as UIKey), band));
        if (peak) {
          side.appendChild(
            make('div', 'aqi-scale', `${t('forecast.uvPeak')} ${fmtTime(peak.time, lang)}`),
          );
        }
        head.appendChild(side);
        hostUv.appendChild(head);
        hostUv.appendChild(make('p', 'aqi-advice', t(`forecast.uv.advice.${level}` as UIKey)));
      }

      if (uvHours.length) {
        const chartTitle = make('p', 'card-sub', t('forecast.uvHourly'));
        chartTitle.style.margin = '14px 0 2px';
        hostUv.appendChild(chartTitle);
        const chart = make('div');
        hostUv.appendChild(chart);
        barChart(
          chart,
          uvHours.map((h) => ({ label: fmtTime(h.time, lang), value: h.uv })),
          {
            seriesName: t('forecast.uv'),
            height: 170,
            yDomain: [0, Math.max(4, ...uvHours.map((h) => h.uv)) * 1.2],
            xEvery: 3,
            valueFmt: decimal(lang),
            colorFor: (val) => BAND_COLOR[uvBand(val)],
            tableLabel: t('common.viewTable'),
            tableHead: [t('common.time'), t('forecast.uv')],
          },
        );
      }

      hostUv.appendChild(
        explainer(t('forecast.uvGuide'), (body) => {
          body.appendChild(make('p', undefined, t('forecast.uvGuideIntro')));
          const legend = make('div', 'legend');
          const rows: [BandKey, string, UvLevel][] = [
            ['b1', '0–2', 'low'],
            ['b2', '3–5', 'moderate'],
            ['b3', '6–7', 'high'],
            ['b4', '8–10', 'veryHigh'],
            ['b5', '11+', 'extreme'],
          ];
          for (const [band, range, level] of rows) {
            legend.appendChild(
              legendRow(
                band,
                range,
                t(`forecast.uv.${level}` as UIKey),
                t(`forecast.uv.advice.${level}` as UIKey),
              ),
            );
          }
          body.appendChild(legend);
        }),
      );
    }
  } catch {
    for (const host of [hostTemp, hostWeek, hostPrecip, hostUv]) {
      if (host) chartMessage(host, t('common.error'), true);
    }
  }
}

const AQI_RANGES = ['0–50', '51–100', '101–150', '151–200', '201–300', '300+'];
const POLLUTANTS: { id: Pollutant; key: UIKey; def: UIKey }[] = [
  { id: 'pm25', key: 'air.pm25', def: 'air.def.pm25' },
  { id: 'pm10', key: 'air.pm10', def: 'air.def.pm10' },
  { id: 'o3', key: 'air.o3', def: 'air.def.o3' },
  { id: 'no2', key: 'air.no2', def: 'air.def.no2' },
];

async function initAir(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('air');
  if (!host) return;
  try {
    const air = await fetchAirQuality();
    host.textContent = '';

    // headline: the index itself, because a resident who does not already know
    // what 8 µg/m³ of PM2.5 means still knows what "Good" means
    const { aqi } = air.current;
    if (aqi !== null) {
      const band = aqiBand(aqi);
      const head = make('div', 'aqi-head');
      const hero = make('div', 'hero-figure', fmtNum(Math.round(aqi), lang));
      hero.style.color = BAND_COLOR[band];
      head.appendChild(hero);
      const side = make('div');
      side.appendChild(make('div', 'aqi-scale', t('air.aqiTitle')));
      side.appendChild(bandBadge(t(`air.band.${band}` as UIKey), band));
      head.appendChild(side);
      host.appendChild(head);
      host.appendChild(make('p', 'aqi-advice', t(`air.advice.${band}` as UIKey)));
    } else {
      host.appendChild(make('p', 'card-note', t('air.aqiUnavailable')));
    }

    // the raw concentrations stay, each dotted with its own band so the row
    // shows at a glance which pollutant is driving the index
    const stats = make('div', 'stat-row');
    for (const p of POLLUTANTS) {
      const value = air.current[p.id];
      const s = make('div', 'stat');
      const label = make('div', 'label');
      if (value !== null) {
        const dot = make('span', 'inline-dot');
        dot.style.background = BAND_COLOR[pollutantBand(p.id, value)];
        label.appendChild(dot);
      }
      label.appendChild(document.createTextNode(t(p.key)));
      s.appendChild(label);
      const v = make('div', 'value', value === null ? '—' : fmtNum(value, lang));
      v.appendChild(make('span', 'unit', ' µg/m³'));
      s.appendChild(v);
      stats.appendChild(s);
    }
    host.appendChild(stats);

    /* ---- 48-hour history, one series at a time ---- */
    const histTitle = make('p', 'card-sub');
    histTitle.style.margin = '18px 0 6px';
    host.appendChild(histTitle);

    const chips = make('div', 'chip-row');
    host.appendChild(chips);
    const chart = make('div');
    chart.style.marginTop = '10px';
    host.appendChild(chart);

    type Series = { id: 'aqi' | Pollutant; label: string };
    const series: Series[] = [
      { id: 'aqi', label: t('air.aqiShort') },
      ...POLLUTANTS.map((p) => ({ id: p.id, label: t(p.key) })),
    ];

    const draw = (s: Series): void => {
      const unit = s.id === 'aqi' ? '' : ' µg/m³';
      // name the series and its unit above the chart: the index is a 0–500
      // score and the pollutants are µg/m³, and an unlabelled index chart under
      // a row of µg/m³ figures reads as if the two were the same quantity
      histTitle.textContent = `${s.label}${unit ? ` (${unit.trim()})` : ''} · ${t('air.hist')}`;
      const points = air.history.map((h) => ({
        label: fmtDateTime(h.time, lang),
        value: h[s.id],
      }));
      barChart(chart, points, {
        seriesName: s.label,
        unit,
        height: 190,
        // 48 points with full date-time labels: any denser and they collide on
        // a phone, so one label per 12 hours
        xEvery: 12,
        valueFmt: decimal(lang),
        colorFor: (v) =>
          BAND_COLOR[s.id === 'aqi' ? aqiBand(v) : pollutantBand(s.id, v)],
        tableLabel: t('common.viewTable'),
        tableHead: [t('common.time'), `${s.label}${unit}`],
      });
    };

    let current: Series = series[0]!;
    for (const s of series) {
      const chip = make('button', 'badge', s.label) as HTMLButtonElement;
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(s.id === current.id));
      chip.addEventListener('click', () => {
        current = s;
        for (const other of chips.children) {
          other.setAttribute('aria-pressed', String(other === chip));
        }
        draw(s);
      });
      chips.appendChild(chip);
    }
    draw(current);

    /* ---- the guide ---- */
    host.appendChild(
      explainer(t('air.guide'), (body) => {
        body.appendChild(make('p', undefined, t('air.guideIntro')));
        const legend = make('div', 'legend');
        (['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as BandKey[]).forEach((band, i) => {
          legend.appendChild(
            legendRow(
              band,
              AQI_RANGES[i]!,
              t(`air.band.${band}` as UIKey),
              t(`air.advice.${band}` as UIKey),
            ),
          );
        });
        body.appendChild(legend);
        const defs = make('dl', 'defs');
        for (const p of POLLUTANTS) {
          defs.appendChild(make('dt', undefined, t(p.key)));
          defs.appendChild(make('dd', undefined, t(p.def)));
        }
        body.appendChild(defs);
      }),
    );

    setUpdated('[data-air-updated]', air.current.time, lang, t);
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

interface AirStationHour {
  time: string;
  so2: number | null;
  no2: number | null;
  ox: number | null;
  spm: number | null;
  pm25: number | null;
}

async function initAirStation(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('air-station');
  if (!host) return;
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/data/air.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const file = (await res.json()) as { hours: AirStationHour[] };
    const hours = file.hours ?? [];
    const latest = [...hours].reverse().find((h) => h.pm25 !== null || h.ox !== null);
    host.textContent = '';
    if (!latest) {
      host.appendChild(make('p', 'placeholder', t('airStation.empty')));
      return;
    }

    const stats = make('div', 'stat-row');
    const stat = (label: string, value: string, unit: string) => {
      const s = make('div', 'stat');
      s.appendChild(make('div', 'label', label));
      const v = make('div', 'value', value);
      v.appendChild(make('span', 'unit', unit));
      s.appendChild(v);
      stats.appendChild(s);
    };
    if (latest.pm25 !== null) stat(t('air.pm25'), fmtNum(latest.pm25, lang), ' µg/m³');
    if (latest.ox !== null) stat(t('airStation.ox'), fmtNum(latest.ox, lang, 3), ' ppm');
    if (latest.no2 !== null) stat(t('air.no2'), fmtNum(latest.no2, lang, 3), ' ppm');
    if (latest.spm !== null) stat(t('airStation.spm'), fmtNum(latest.spm, lang, 3), ' mg/m³');
    host.appendChild(stats);

    if (latest.pm25 !== null) {
      const level = pm25Level(latest.pm25);
      const b = badge(`${t('air.pm25')}: ${t(`air.level.${level}` as UIKey)}`, level);
      b.style.marginTop = '12px';
      host.appendChild(b);
    }

    const withPm = hours.filter((h) => h.pm25 !== null);
    if (withPm.length > 3) {
      const sparkTitle = make('p', 'card-sub', t('airStation.sparkTitle'));
      sparkTitle.style.margin = '16px 0 4px';
      host.appendChild(sparkTitle);
      const spark = make('div');
      host.appendChild(spark);
      lineChart(
        spark,
        withPm.map((h) => ({ label: fmtDateTime(new Date(h.time), lang), value: h.pm25! })),
        {
          seriesName: 'PM2.5',
          unit: ' µg/m³',
          height: 150,
          xEvery: 12,
          valueFmt: decimal(lang),
          tableLabel: t('common.viewTable'),
          tableHead: [t('common.time'), 'PM2.5 (µg/m³)'],
        },
      );
    }

    setUpdated('[data-air-station-updated]', new Date(latest.time), lang, t);
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

async function initPollen(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('pollen');
  if (!host) return;
  try {
    const hours = await fetchPollenToday();
    host.textContent = '';
    if (!hours.length) {
      host.appendChild(make('p', 'placeholder', t('pollen.offSeason')));
      return;
    }

    const latest = hours[hours.length - 1]!;
    const level = pollenLevel(latest.count);
    const b = badge(
      `${fmtNum(latest.count, lang)} ${t('pollen.unit')} · ${t(`pollen.level.${level}` as UIKey)}`,
      level,
    );
    b.style.marginBottom = '10px';
    host.appendChild(b);

    const chart = make('div');
    host.appendChild(chart);
    barChart(
      chart,
      hours.map((h) => ({ label: fmtTime(h.time, lang), value: h.count })),
      {
        seriesName: t('pollen.title'),
        height: 180,
        xEvery: 3,
        tableLabel: t('common.viewTable'),
        tableHead: [t('common.time'), `${t('pollen.title')} (${t('pollen.unit')})`],
      },
    );
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

/* ---- heat index (WBGT) --------------------------------------------------- */

interface HeatFile {
  season: boolean;
  current: { time: string; wbgt: number } | null;
  observed: { time: string; wbgt: number }[];
  forecast: { time: string; wbgt: number }[];
  alert: {
    today: number;
    tomorrow: number;
    peakToday: number | null;
    reportDate: string | null;
    reportTime: string | null;
  } | null;
}

async function initHeat(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('heat');
  if (!host) return;
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/data/heat.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const file = (await res.json()) as HeatFile;
    host.textContent = '';

    if (!file.season) {
      host.appendChild(make('p', 'card-sub', t('heat.offSeason')));
      return;
    }

    // The official alert leads when there is one: it is an instruction, not a
    // measurement, and it outranks any number on the card.
    if (file.alert && file.alert.today > 0) {
      const level = file.alert.today >= 2 ? 'special' : 'alert';
      const banner = make('div', `heat-alert ${level}`);
      banner.appendChild(make('strong', undefined, t(`heat.alert.${level}` as UIKey)));
      banner.appendChild(make('p', undefined, t(`heat.alert.${level}Advice` as UIKey)));
      host.appendChild(banner);
    }

    const current = file.current;
    if (current) {
      const level = heatLevel(current.wbgt);
      const band = heatBand(current.wbgt);
      const head = make('div', 'aqi-head');
      const hero = make('div', 'hero-figure', fmtNum(current.wbgt, lang, 1));
      hero.appendChild(make('span', 'unit', '°C'));
      hero.style.color = BAND_COLOR[band];
      head.appendChild(hero);
      const side = make('div');
      side.appendChild(make('div', 'aqi-scale', t('heat.wbgt')));
      side.appendChild(bandBadge(t(`heat.level.${level}` as UIKey), band));
      head.appendChild(side);
      host.appendChild(head);
      host.appendChild(make('p', 'aqi-advice', t(`heat.advice.${level}` as UIKey)));
      setUpdated('[data-heat-updated]', new Date(current.time), lang, t);
    }

    if (file.forecast.length) {
      const title = make('p', 'card-sub', t('heat.forecast'));
      title.style.margin = '16px 0 2px';
      host.appendChild(title);
      const chart = make('div');
      host.appendChild(chart);
      const points = file.forecast.map((h) => ({
        label: fmtDateTime(new Date(h.time), lang),
        value: h.wbgt,
      }));
      barChart(chart, points, {
        seriesName: t('heat.wbgt'),
        unit: ' °C',
        height: 180,
        xEvery: 4,
        valueFmt: decimal(lang),
        colorFor: (v) => BAND_COLOR[heatBand(v)],
        tableLabel: t('common.viewTable'),
        tableHead: [t('common.time'), `${t('heat.wbgt')} (°C)`],
      });
    }

    host.appendChild(
      explainer(t('heat.guide'), (body) => {
        body.appendChild(make('p', undefined, t('heat.guideIntro')));
        const legend = make('div', 'legend');
        const rows: [HeatLevel, string][] = [
          ['safe', '< 21'],
          ['caution', '21–25'],
          ['warning', '25–28'],
          ['severe', '28–31'],
          ['danger', '31+'],
        ];
        for (const [level, range] of rows) {
          legend.appendChild(
            legendRow(
              HEAT_BAND[level],
              range,
              t(`heat.level.${level}` as UIKey),
              t(`heat.advice.${level}` as UIKey),
            ),
          );
        }
        body.appendChild(legend);
        body.appendChild(make('p', undefined, t('heat.alertExplain')));
      }),
    );
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

/* ---- station map --------------------------------------------------------- */

async function initStations(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('stations');
  if (!host) return;
  try {
    const { renderStationMap } = await import('./station-map');
    const at = await renderStationMap(host, lang, t);
    host.appendChild(make('p', 'card-note', t('stations.note')));
    if (at) setUpdated('[data-stations-updated]', at, lang, t);
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

/* ---- moon ---------------------------------------------------------------- */

function initMoon(lang: Lang, t: (k: UIKey) => string): void {
  const host = widget('moon');
  if (!host) return;
  const m = moonInfo();
  host.textContent = '';

  const head = make('div', 'moon-head');

  // A photograph of the real near side rather than a plain disc or an emoji:
  // emoji have eight fixed shapes and some fonts mirror them for the southern
  // hemisphere, and the maria are what make a moon read as the Moon. The disc
  // never rotates — the near side always faces us; only the terminator moves,
  // so the same image is simply clipped differently each night.
  const NS_SVG = 'http://www.w3.org/2000/svg';
  const R = 30;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', `${-R - 2} ${-R - 2} ${(R + 2) * 2} ${(R + 2) * 2}`);
  svg.setAttribute('class', 'moon-disc');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t(`moon.phase.${m.name}` as UIKey));

  const clipId = 'moon-lit-clip';
  const discId = 'moon-disc-clip';
  const defs = document.createElementNS(NS_SVG, 'defs');

  const clip = document.createElementNS(NS_SVG, 'clipPath');
  clip.setAttribute('id', clipId);
  const clipPath = document.createElementNS(NS_SVG, 'path');
  clipPath.setAttribute('d', moonDiscPath(m.phase, R));
  clip.appendChild(clipPath);
  defs.appendChild(clip);

  // The photograph is square with black sky in the corners; without this the
  // dimmed layer beneath shows those corners as a grey box around the moon.
  const discClip = document.createElementNS(NS_SVG, 'clipPath');
  discClip.setAttribute('id', discId);
  const discCircle = document.createElementNS(NS_SVG, 'circle');
  discCircle.setAttribute('r', String(R));
  discClip.appendChild(discCircle);
  defs.appendChild(discClip);

  svg.appendChild(defs);

  const src = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/images/moon.jpg`;
  const image = (className: string, clipped: boolean) => {
    const img = document.createElementNS(NS_SVG, 'image');
    img.setAttribute('href', src);
    img.setAttribute('x', String(-R));
    img.setAttribute('y', String(-R));
    img.setAttribute('width', String(R * 2));
    img.setAttribute('height', String(R * 2));
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    img.setAttribute('class', className);
    img.setAttribute('clip-path', `url(#${clipped ? clipId : discId})`);
    return img;
  };
  // the unlit side stays faintly visible, the way earthshine makes it — a
  // hard-edged black bite out of the card reads as a rendering fault
  svg.appendChild(image('moon-shadow', false));
  svg.appendChild(image('moon-face', true));
  head.appendChild(svg);

  const side = make('div');
  side.appendChild(make('div', 'moon-name', t(`moon.phase.${m.name}` as UIKey)));
  side.appendChild(
    make('div', 'aqi-scale', `${t('moon.illumination')} ${fmtNum(m.illumination * 100, lang)} %`),
  );
  head.appendChild(side);
  host.appendChild(head);

  const stats = make('div', 'stat-row');
  const stat = (label: string, value: string) => {
    const s = make('div', 'stat');
    s.appendChild(make('div', 'label', label));
    s.appendChild(make('div', 'value', value));
    stats.appendChild(s);
  };
  stat(t('moon.rise'), m.rise ? fmtTime(m.rise, lang) : '—');
  stat(t('moon.set'), m.set ? fmtTime(m.set, lang) : '—');
  stat(t('moon.nextFull'), fmtDateShort(m.nextFull, lang));
  stat(t('moon.nextNew'), fmtDateShort(m.nextNew, lang));
  host.appendChild(stats);

  host.appendChild(make('p', 'card-note', t('moon.note')));
  // NASA imagery is public domain and needs no credit, but this site credits
  // every source it shows; the line carries no translatable words.
  const credit = make('p', 'card-note');
  const link = make('a', undefined, 'NASA / GSFC') as HTMLAnchorElement;
  link.href = 'https://images.nasa.gov/details/GSFC_20171208_Archive_e000868';
  link.target = '_blank';
  link.rel = 'noopener';
  // no © — NASA imagery is not copyrighted; the bare credit is the honest form
  credit.appendChild(link);
  host.appendChild(credit);
}

async function initQuakes(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = widget('quakes');
  if (!host) return;
  try {
    // Only quakes actually felt here. Nationwide, the overwhelming majority are
    // hundreds of km away and mean nothing to a Matsumoto resident — listing
    // them would fill the dashboard's second-largest block with noise. The full
    // nationwide list stays on the earthquakes page. A wider window is fetched
    // than shown because local quakes are rare: ~100 reports span two days.
    const quakes = (await fetchQuakes(100))
      .filter((q) => q.matsumotoScale !== null || q.feltNagano)
      .slice(0, 5);
    host.textContent = '';
    if (!quakes.length) {
      const none = make('p', 'card-sub', t('quakes.noneLocal'));
      none.style.margin = '0';
      host.appendChild(none);
      return;
    }
    const list = make('ul', 'item-list');
    for (const q of quakes) {
      const li = make('li');
      const tile = make('span', 'intensity', intensityLabel(q.maxScale, lang));
      tile.title = t('quakes.maxIntensity');
      li.appendChild(tile);
      const when = make('span', 'when', fmtDateTime(q.time, lang));
      li.appendChild(when);
      const what = make('div', 'what');
      const title = make('div', 'title', q.epicenterJa);
      if (q.matsumotoScale !== null) {
        const felt = badge(
          `${t('quakes.feltMatsumoto')}: ${intensityLabel(q.matsumotoScale, lang)}`,
          'elevated',
        );
        felt.style.marginLeft = '8px';
        felt.style.fontSize = 'var(--fs-xs)';
        felt.style.padding = '2px 9px';
        title.appendChild(felt);
      } else if (q.feltNagano) {
        const felt = badge(t('quakes.feltNagano'), 'moderate');
        felt.style.marginLeft = '8px';
        felt.style.fontSize = 'var(--fs-xs)';
        felt.style.padding = '2px 9px';
        title.appendChild(felt);
      }
      what.appendChild(title);
      const meta: string[] = [];
      if (q.magnitude !== null) meta.push(`M${fmtNum(q.magnitude, lang, 1)}`);
      if (q.depthKm !== null) meta.push(`${t('quakes.depth')} ${fmtNum(q.depthKm, lang)} km`);
      what.appendChild(make('div', 'meta', meta.join(' · ')));
      li.appendChild(what);
      list.appendChild(li);
    }
    host.appendChild(list);
    const note = make('p', 'card-note', t('quakes.intensityNote'));
    host.appendChild(note);
  } catch {
    chartMessage(host, t('common.error'), true);
  }
}

/* ---- entry -------------------------------------------------------------- */

/** Renders whichever of the shared widgets are present on the current page.
 *  Used by both the dashboard (warnings, earthquakes) and the weather page
 *  (conditions, forecast, air, pollen, UV) — each init below no-ops when its
 *  host element is absent, so a page only pays for the widgets it includes. */
/** Weather page headline: today's outlook, rain chance and UV in one row, so
 *  the three things people check first don't need any scrolling. */
async function initSummary(
  lang: Lang,
  t: (k: UIKey) => string,
  forecastP: Promise<Forecast> | null,
): Promise<void> {
  const host = widget('summary');
  if (!host || !forecastP) return;
  try {
    const fc = await forecastP;
    const today = fc.daily[0];
    if (!today) throw new Error('no daily forecast');
    const now = Date.now();
    const next24 = fc.hourly.filter((h) => h.time.getTime() >= now - 3.6e6).slice(0, 24);
    const pop = Math.max(0, ...next24.map((h) => h.pop));
    const level = uvLevelOf(today.uvMax);

    const tile = (label: string, value: string, sub: string, color?: string): HTMLElement => {
      const box = make('div', 'wx-tile');
      box.appendChild(make('div', 'wx-tile-label', label));
      const v = make('div', 'wx-tile-value', value);
      if (color) v.style.color = color;
      box.appendChild(v);
      box.appendChild(make('div', 'wx-tile-sub', sub));
      return box;
    };
    host.replaceChildren(
      tile(
        t('common.today'),
        `${wmoIcon(today.weatherCode)} ${fmtNum(Math.round(today.tMax), lang)}° / ${fmtNum(Math.round(today.tMin), lang)}°`,
        wmoLabel(today.weatherCode, lang),
      ),
      tile(
        t('forecast.precipChance'),
        `${fmtNum(pop, lang)} %`,
        `${fmtNum(next24.reduce((sum, h) => sum + h.precip, 0), lang, 1)} mm / 24 h`,
      ),
      tile(
        t('forecast.uv'),
        fmtNum(today.uvMax, lang, 1),
        t(`forecast.uv.${level}` as UIKey),
        BAND_COLOR[uvBand(today.uvMax)],
      ),
    );
  } catch {
    host.replaceChildren(make('p', 'placeholder error', t('common.error')));
  } finally {
    host.removeAttribute('aria-busy');
  }
}

export function initWidgets(): void {
  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];

  // Widgets absent from the page (feature toggles, see src/features.ts) are
  // skipped entirely — including their API calls.
  const needsForecast = ['summary', 'now', 'hourly-temp', 'week', 'precip', 'uv'].some((n) => widget(n));
  const forecastP = needsForecast ? fetchForecast() : null;
  void renderWarnings(lang, t);
  void initSummary(lang, t, forecastP);
  void initNow(lang, t, forecastP);
  void initForecast(lang, t, forecastP);
  void initAir(lang, t);
  void initHeat(lang, t);
  void initStations(lang, t);
  initMoon(lang, t);
  void initAirStation(lang, t);
  void initPollen(lang, t);
  void initQuakes(lang, t);
}
