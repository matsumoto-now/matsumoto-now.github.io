/** "Show my location" Leaflet control — browser Geolocation API (GPS on
 *  mobile, Wi-Fi/IP on desktop; needs HTTPS, which GitHub Pages provides). */

import L from 'leaflet';
import type { UIKey } from '../i18n/ui';

/** Non-blocking status line under the map (replaces the old alert()). */
function setStatus(map: L.Map, text: string): void {
  const host = map.getContainer();
  let node = host.nextElementSibling as HTMLElement | null;
  if (!node?.classList.contains('locate-status')) {
    node = document.createElement('p');
    node.className = 'locate-status card-note';
    node.setAttribute('role', 'status');
    host.after(node);
  }
  node.textContent = text;
  node.hidden = text === '';
}

/** Adds the control and returns a function that triggers the same lookup, so
 *  page buttons outside the map (e.g. "nearest shelters") can reuse it. */
export function addLocateControl(
  map: L.Map,
  t: (k: UIKey) => string,
  onLocate?: (latlng: L.LatLng) => void,
): () => void {
  let trigger: () => void = () => {};
  const Locate = L.Control.extend({
    options: { position: 'topleft' },
    onAdd(): HTMLElement {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('button', 'locate-btn', div) as HTMLButtonElement;
      btn.type = 'button';
      btn.title = t('map.locate');
      btn.setAttribute('aria-label', t('map.locate'));
      const glyph = '<span aria-hidden="true">⌖</span>';
      btn.innerHTML = glyph;

      let marker: L.CircleMarker | null = null;
      let accuracy: L.Circle | null = null;

      const done = (): void => {
        btn.innerHTML = glyph;
        btn.removeAttribute('aria-busy');
      };
      trigger = () => {
        if (!('geolocation' in navigator)) {
          setStatus(map, t('map.locateError'));
          return;
        }
        btn.innerHTML = '<span aria-hidden="true">…</span>';
        btn.setAttribute('aria-busy', 'true');
        setStatus(map, '');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            done();
            const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
            marker?.remove();
            accuracy?.remove();
            accuracy = L.circle(ll, {
              radius: pos.coords.accuracy,
              color: '#2a78d6',
              weight: 1,
              fillColor: '#2a78d6',
              fillOpacity: 0.08,
            }).addTo(map);
            marker = L.circleMarker(ll, {
              radius: 7,
              color: '#fff',
              weight: 2,
              fillColor: '#2a78d6',
              fillOpacity: 1,
            }).addTo(map);
            marker.bindTooltip(t('map.locate'));
            map.setView(ll, Math.max(map.getZoom(), 15));
            onLocate?.(ll);
          },
          () => {
            done();
            setStatus(map, t('map.locateError'));
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      };
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        trigger();
      });
      return div;
    },
  });
  map.addControl(new Locate());
  return () => trigger();
}
