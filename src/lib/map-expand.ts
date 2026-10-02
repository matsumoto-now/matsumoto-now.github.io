/** "Expand map" Leaflet control — grows the map host to fill the window.
 *
 *  This is a CSS overlay rather than the Fullscreen API on purpose: iOS Safari
 *  still refuses requestFullscreen() on anything but a <video>, and the maps
 *  matter most on a phone. A fixed-position host works everywhere and keeps
 *  the page's own theme (the browser's fullscreen chrome would not). */

import L from 'leaflet';
import type { UIKey } from '../i18n/ui';

const EXPANDED = 'map-expanded';

export function addExpandControl(map: L.Map, t: (k: UIKey) => string): void {
  const Expand = L.Control.extend({
    options: { position: 'topleft' },
    onAdd(): HTMLElement {
      const host = map.getContainer().closest('.map-frame') ?? map.getContainer();
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'expand-btn', div);
      btn.href = '#';
      btn.setAttribute('role', 'button');

      const sync = (): void => {
        const on = host.classList.contains(EXPANDED);
        btn.textContent = on ? '⤡' : '⤢';
        const label = t(on ? 'map.collapse' : 'map.expand');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', String(on));
      };

      const toggle = (want: boolean): void => {
        host.classList.toggle(EXPANDED, want);
        document.body.classList.toggle('map-locked', want);
        sync();
        // the host resizes with the class change, so Leaflet has to re-measure
        // before it will fetch the tiles that just came into view
        requestAnimationFrame(() => map.invalidateSize());
      };

      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        toggle(!host.classList.contains(EXPANDED));
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && host.classList.contains(EXPANDED)) toggle(false);
      });

      sync();
      return div;
    },
  });
  map.addControl(new Expand());
}

/** Failed map load: collapse the tall frame to a short message with a retry,
 *  instead of a big empty box with a small line of text in it. */
export function mapError(host: HTMLElement, t: (k: UIKey) => string): void {
  host.textContent = '';
  host.classList.add('map-error');
  const p = document.createElement('p');
  p.className = 'placeholder error';
  p.textContent = `${t('common.error')} `;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'link-button';
  retry.textContent = t('common.retry');
  retry.addEventListener('click', () => location.reload());
  p.appendChild(retry);
  host.appendChild(p);
}
