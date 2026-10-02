/** Shelters page: designated emergency evacuation sites (GSI open data, with
 *  per-hazard suitability flags) + AED locations (Matsumoto City open data),
 *  pre-processed by scripts/fetch-shelter-data.mjs into /data/shelters.json. */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import { addLocateControl } from './geolocate';
import { addExpandControl, mapError } from './map-expand';

const MATSUMOTO: [number, number] = [36.238, 137.972];
const AED_MIN_ZOOM = 14;
const HAZARDS = ['flood', 'landslide', 'earthquake', 'fire', 'volcano'] as const;
type Hazard = (typeof HAZARDS)[number];

interface Shelter {
  name: string;
  address: string;
  lat: number;
  lon: number;
  hazards: Hazard[];
}

interface Aed {
  name: string;
  place: string | null;
  hours: string;
  lat: number;
  lon: number;
}

interface StaySite {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

interface ShelterFile {
  fetched: string;
  shelters: Shelter[];
  staySites?: StaySite[];
  aeds: Aed[];
}

/** Official open hazard-overlay tiles from the national hazard-map portal. */
const HAZARD_TILE_OPTS = {
  opacity: 0.55,
  maxNativeZoom: 17,
  maxZoom: 18,
  attribution:
    '<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener">ハザードマップポータルサイト</a>',
};
const FLOOD_TILES =
  'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png';
const LANDSLIDE_TILES = [
  'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
  'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png',
  'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png',
];

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shelterPopup(s: Shelter, t: (k: UIKey) => string): HTMLElement {
  const box = make('div');
  box.appendChild(make('strong', undefined, s.name));
  box.appendChild(make('div', undefined, s.address));
  if (s.hazards.length) {
    const covered = s.hazards.map((h) => t(`shelter.hazard.${h}` as UIKey)).join(' · ');
    const line = make('div', undefined, `${t('shelter.hazardsCovered')}: ${covered}`);
    line.style.marginTop = '4px';
    box.appendChild(line);
  }
  return box;
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function initShelterPage(): void {
  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];
  const mapHost = document.getElementById('shelter-map');
  const filterHost = document.querySelector<HTMLElement>('[data-widget="hazard-filter"]');
  const nearestBtn = document.querySelector<HTMLButtonElement>('[data-nearest-btn]');
  const nearestList = document.querySelector<HTMLElement>('[data-nearest-list]');
  if (!mapHost) return;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  fetch(`${base}/data/shelters.json`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<ShelterFile>) : Promise.reject(res.status)))
    .then((file) => {
      const map = L.map(mapHost, { scrollWheelZoom: false }).setView(MATSUMOTO, 12);
      L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
        attribution:
          '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 (GSI)</a> · 松本市 (CC BY 4.0)',
        maxZoom: 18,
      }).addTo(map);

      // evacuation sites, refiltered in place when a hazard chip is pressed
      const shelterGroup = L.layerGroup().addTo(map);
      let visibleShelters: { s: Shelter; marker: L.CircleMarker }[] = [];
      const renderShelters = (hazard: Hazard | null): void => {
        shelterGroup.clearLayers();
        visibleShelters = [];
        for (const s of file.shelters) {
          if (hazard && !s.hazards.includes(hazard)) continue;
          const marker = L.circleMarker([s.lat, s.lon], {
            radius: 6,
            color: '#2a78d6',
            weight: 2,
            fillColor: '#2a78d6',
            fillOpacity: 0.35,
          });
          marker.bindTooltip(s.name);
          marker.bindPopup(shelterPopup(s, t));
          shelterGroup.addLayer(marker);
          visibleShelters.push({ s, marker });
        }
      };
      renderShelters(null);

      // designated shelters for longer stays (指定避難所) — separate overlay
      const stayGroup = L.layerGroup();
      for (const s of file.staySites ?? []) {
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 6,
          color: '#0ca30c',
          weight: 2,
          fillColor: '#0ca30c',
          fillOpacity: 0.35,
        });
        marker.bindTooltip(s.name);
        const box = make('div');
        box.appendChild(make('strong', undefined, s.name));
        box.appendChild(make('div', undefined, s.address));
        marker.bindPopup(box);
        stayGroup.addLayer(marker);
      }

      // hazard-zone overlays (official raster tiles, semi-transparent)
      const floodLayer = L.tileLayer(FLOOD_TILES, HAZARD_TILE_OPTS);
      const landslideLayer = L.layerGroup(
        LANDSLIDE_TILES.map((url) => L.tileLayer(url, HAZARD_TILE_OPTS)),
      );

      // AED overlay, shown when zoomed in
      const aedGroup = L.layerGroup();
      for (const a of file.aeds) {
        const marker = L.circleMarker([a.lat, a.lon], {
          radius: 4.5,
          color: '#d03b3b',
          weight: 1.5,
          fillColor: '#fff',
          fillOpacity: 1,
        });
        const label = [a.name, a.place, `${t('shelter.aedHours')}: ${a.hours}`]
          .filter(Boolean)
          .join(' · ');
        marker.bindTooltip(label);
        aedGroup.addLayer(marker);
      }
      let aedWanted = true;
      const syncAed = () => {
        const show = aedWanted && map.getZoom() >= AED_MIN_ZOOM;
        if (show && !map.hasLayer(aedGroup)) aedGroup.addTo(map);
        if (!show && map.hasLayer(aedGroup)) map.removeLayer(aedGroup);
      };
      map.on('zoomend', syncAed);
      map.on('overlayadd', (e) => {
        if (e.layer === aedGroup) aedWanted = true;
      });
      map.on('overlayremove', (e) => {
        if (e.layer === aedGroup) aedWanted = false;
      });

      L.control
        .layers(
          undefined,
          {
            [t('shelter.staySites')]: stayGroup,
            [t('shelter.aed')]: aedGroup,
            [t('shelter.floodLayer')]: floodLayer,
            [t('shelter.landslideLayer')]: landslideLayer,
          },
          // open on desktop; on phones it would cover most of the map
          { collapsed: window.matchMedia('(max-width: 640px)').matches },
        )
        .addTo(map);
      syncAed();

      // locate: center on the visitor, open the nearest visible site and list
      // the closest few above the map (re-ranked when the hazard filter changes)
      let here: L.LatLng | null = null;
      const renderNearest = (): void => {
        if (!here || !nearestList) return;
        const origin = here;
        const ranked = visibleShelters
          .map((v) => ({ ...v, d: map.distance(origin, [v.s.lat, v.s.lon]) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 5);
        ranked[0]?.marker.openPopup();
        nearestList.replaceChildren(
          ...ranked.map(({ s, marker, d }) => {
            const li = make('li', 'nearest-item');
            const main = make('button', 'nearest-main') as HTMLButtonElement;
            main.type = 'button';
            main.appendChild(make('strong', undefined, s.name));
            main.appendChild(make('span', 'nearest-dist', formatDistance(d)));
            main.appendChild(
              make(
                'span',
                'nearest-meta',
                s.hazards.map((h) => t(`shelter.hazard.${h}` as UIKey)).join(' · '),
              ),
            );
            main.addEventListener('click', () => {
              map.setView([s.lat, s.lon], Math.max(map.getZoom(), 16));
              marker.openPopup();
              mapHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            const dir = make('a', 'nearest-dir', t('shelter.directions')) as HTMLAnchorElement;
            dir.href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=walking`;
            dir.target = '_blank';
            dir.rel = 'noopener';
            li.append(main, dir);
            return li;
          }),
        );
      };
      const locate = addLocateControl(map, t, (ll) => {
        here = ll;
        renderNearest();
      });
      if (nearestBtn) {
        nearestBtn.disabled = false;
        nearestBtn.addEventListener('click', locate);
      }
      addExpandControl(map, t);

      // hazard filter chips
      if (filterHost) {
        const buttons: HTMLButtonElement[] = [];
        const addButton = (label: string, hazard: Hazard | null): void => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'filter-btn';
          btn.textContent =
            hazard === null
              ? `${label} (${file.shelters.length})`
              : `${label} (${file.shelters.filter((s) => s.hazards.includes(hazard)).length})`;
          btn.setAttribute('aria-pressed', hazard === null ? 'true' : 'false');
          btn.addEventListener('click', () => {
            for (const b of buttons) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            renderShelters(hazard);
            renderNearest();
          });
          buttons.push(btn);
          filterHost.appendChild(btn);
        };
        addButton(t('shelter.all'), null);
        for (const h of HAZARDS) addButton(t(`shelter.hazard.${h}` as UIKey), h);
      }
    })
    .catch(() => mapError(mapHost, t));
}
