/** Earthquakes page: full list + Leaflet epicenter map on GSI (国土地理院) tiles. */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import {
  fetchQuakes,
  fetchJmaEventIds,
  jmaEventKey,
  jmaQuakeUrl,
  intensityLabel,
  type Quake,
} from './quakes';
import { fmtDateTime, fmtNum } from './format';
import { chartMessage } from './chart';
import { addLocateControl } from './geolocate';
import { addExpandControl } from './map-expand';

const MATSUMOTO: [number, number] = [36.238, 137.972];

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderList(
  host: HTMLElement,
  quakes: Quake[],
  eids: Map<string, string>,
  lang: Lang,
  t: (k: UIKey) => string,
): void {
  host.textContent = '';
  if (!quakes.length) {
    host.appendChild(make('p', 'placeholder', t('quakes.none')));
    return;
  }
  const list = make('ul', 'item-list');
  for (const q of quakes) {
    const li = make('li');
    const tile = make('span', 'intensity', intensityLabel(q.maxScale, lang));
    tile.title = t('quakes.maxIntensity');
    li.appendChild(tile);
    li.appendChild(make('span', 'when', fmtDateTime(q.time, lang)));
    const what = make('div', 'what');
    const title = make('div', 'title', q.epicenterJa);
    if (q.matsumotoScale !== null || q.feltNagano) {
      const text =
        q.matsumotoScale !== null
          ? `${t('quakes.feltMatsumoto')}: ${intensityLabel(q.matsumotoScale, lang)}`
          : t('quakes.feltNagano');
      const felt = make('span', 'badge', text);
      felt.style.marginLeft = '8px';
      felt.style.fontSize = 'var(--fs-xs)';
      felt.style.padding = '2px 9px';
      const dot = make('span', 'dot');
      dot.style.background = q.matsumotoScale !== null ? 'var(--status-serious)' : 'var(--series-2)';
      felt.prepend(dot);
      title.appendChild(felt);
    }
    what.appendChild(title);
    const meta: string[] = [];
    if (q.magnitude !== null) meta.push(`M${fmtNum(q.magnitude, lang, 1)}`);
    if (q.depthKm !== null) meta.push(`${t('quakes.depth')} ${fmtNum(q.depthKm, lang)} km`);
    const metaLine = make('div', 'meta', meta.length ? `${meta.join(' · ')} · ` : '');
    const jma = document.createElement('a');
    jma.href = jmaQuakeUrl(eids.get(jmaEventKey(q)), lang);
    jma.target = '_blank';
    jma.rel = 'noopener';
    jma.textContent = `${t('quakes.jmaDetail')} ↗`;
    metaLine.appendChild(jma);
    what.appendChild(metaLine);
    li.appendChild(what);
    list.appendChild(li);
  }
  host.appendChild(list);
}

function renderMap(quakes: Quake[], lang: Lang, t: (k: UIKey) => string): void {
  const mapHost = document.getElementById('quake-map');
  if (!mapHost) return;

  const map = L.map(mapHost, { scrollWheelZoom: false }).setView(MATSUMOTO, 6);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 (GSI)</a>',
    maxZoom: 18,
  }).addTo(map);

  // Matsumoto marker for orientation
  L.circleMarker(MATSUMOTO, {
    radius: 6,
    color: 'var(--ink, #333)',
    weight: 2,
    fillColor: '#fff',
    fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip(lang === 'ja' ? '松本市' : 'Matsumoto');

  const bounds: [number, number][] = [MATSUMOTO];
  for (const q of quakes) {
    if (q.lat === null || q.lon === null) continue;
    const radius = q.magnitude === null ? 6 : Math.max(5, q.magnitude * 3.2);
    const color = q.feltNagano ? '#eb6834' : '#2a78d6';
    const marker = L.circleMarker([q.lat, q.lon], {
      radius,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.25,
    }).addTo(map);
    const label = [
      q.epicenterJa,
      q.magnitude !== null ? `M${fmtNum(q.magnitude, lang, 1)}` : '',
      `${t('quakes.maxIntensity')} ${intensityLabel(q.maxScale, lang)}`,
      fmtDateTime(q.time, lang),
    ]
      .filter(Boolean)
      .join(' · ');
    marker.bindTooltip(label);
    bounds.push([q.lat, q.lon]);
  }
  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 7 });
  }

  addLocateControl(map, t);
  addExpandControl(map, t);
}

export function initQuakePage(): void {
  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];
  const listHost = document.querySelector<HTMLElement>('[data-widget="quake-list"]');

  // event-ID lookup is decoration — quakes still render if it fails
  const eidsP = fetchJmaEventIds().catch(() => new Map<string, string>());
  fetchQuakes(20)
    .then(async (quakes) => {
      const eids = await eidsP;
      if (listHost) renderList(listHost, quakes, eids, lang, t);
      renderMap(quakes, lang, t);
    })
    .catch(() => {
      if (listHost) chartMessage(listHost, t('common.error'), true);
    });
}
