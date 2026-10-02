/** JMA warnings banner shared by the dashboard and the alerts page. Starts
 *  neutral ("loading", aria-busy) so it never shows green before the data says
 *  so, and turns into an error banner with a retry button when the fetch fails. */

import type { Lang, UIKey } from '../i18n/ui';
import { fmtDateTime } from './format';
import { fetchWarnings, warningLabel } from './jma';

const LEVEL_COLORS: Record<string, string> = {
  advisory: 'var(--status-warning)',
  warning: 'var(--status-serious)',
  emergency: 'var(--status-critical)',
};

const OK_PATH = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 13.6-3.4-3.4 1.4-1.4 2 2 4.6-4.6 1.4 1.4z';
const WARN_PATH = 'M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z';

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(d: string, fill: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'b-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', fill);
  svg.appendChild(path);
  return svg;
}

export async function renderWarnings(lang: Lang, t: (k: UIKey) => string): Promise<void> {
  const host = document.getElementById('warnings');
  if (!host) return;
  host.setAttribute('aria-busy', 'true');
  try {
    const { reportTime, active } = await fetchWarnings();
    host.textContent = '';
    const body = make('div');
    const meta = make(
      'div',
      'banner-meta',
      `${t('warnings.source')} · ${t('common.updated')} ${fmtDateTime(reportTime, lang)}`,
    );
    if (active.length === 0) {
      host.className = 'banner ok col-12';
      host.appendChild(icon(OK_PATH, 'var(--status-good)'));
      body.appendChild(make('strong', undefined, t('warnings.none')));
    } else {
      host.className = 'banner severe col-12';
      host.appendChild(icon(WARN_PATH, LEVEL_COLORS[active[0]!.level] ?? 'var(--status-warning)'));
      body.appendChild(make('strong', undefined, `${t('warnings.title')} — ${t('warnings.for')}`));
      const list = make('div', 'warn-list');
      for (const w of active) {
        const b = make('span', 'badge');
        const dot = make('span', 'dot');
        dot.style.background = LEVEL_COLORS[w.level] ?? 'var(--muted)';
        b.append(dot, warningLabel(w, lang));
        list.appendChild(b);
      }
      body.appendChild(list);
    }
    body.appendChild(meta);
    host.appendChild(body);
  } catch {
    host.className = 'banner error col-12';
    host.textContent = '';
    host.appendChild(icon(WARN_PATH, 'var(--muted)'));
    const body = make('div');
    body.appendChild(make('span', undefined, `${t('common.error')} `));
    const retry = make('button', 'link-button', t('common.retry')) as HTMLButtonElement;
    retry.type = 'button';
    retry.addEventListener('click', () => {
      host.className = 'banner loading col-12';
      host.textContent = '';
      host.appendChild(make('p', 'placeholder flush', t('common.loading')));
      void renderWarnings(lang, t);
    });
    body.appendChild(retry);
    host.appendChild(body);
  } finally {
    host.removeAttribute('aria-busy');
  }
}
