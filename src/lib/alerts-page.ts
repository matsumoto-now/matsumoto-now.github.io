/** Alerts page: live JMA warnings + city feeds fetched by the scheduled GitHub Action
 *  into /data/alerts.json (see scripts/fetch-city-data.mjs). */

import { ui, getLang, type Lang, type UIKey } from '../i18n/ui';
import { fmtDateTime } from './format';

export interface AlertItem {
  source: 'emergency' | 'important' | 'news' | 'anshin';
  title: string;
  titleEn?: string;
  titleFr?: string;
  link: string;
  date: string | null;
}

interface AlertsFile {
  fetched: string | null;
  items: AlertItem[];
}

/** Titles are machine-translated to EN and FR only (DeepL quota); every other
 *  non-Japanese language falls back to the English translation. */
function displayTitle(item: AlertItem, lang: Lang): string {
  if (lang === 'ja') return item.title;
  if (lang === 'fr') return item.titleFr ?? item.titleEn ?? item.title;
  return item.titleEn ?? item.title;
}

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FIRST_SHOWN = 5;

function renderFeed(host: HTMLElement, items: AlertItem[], lang: Lang, t: (k: UIKey) => string): void {
  host.textContent = '';
  if (!items.length) {
    host.appendChild(make('p', 'placeholder', t('alerts.empty')));
    return;
  }
  const list = make('ul', 'item-list');
  const shown = items.slice(0, 12);
  for (const [n, item] of shown.entries()) {
    const li = make('li');
    li.hidden = n >= FIRST_SHOWN; // short feeds keep the other sections in view
    const when = make('span', 'when', item.date ? fmtDateTime(new Date(item.date), lang) : '—');
    li.appendChild(when);
    const what = make('div', 'what');
    const title = make('div', 'title');
    const a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener';
    const label = displayTitle(item, lang);
    a.textContent = label;
    title.appendChild(a);
    what.appendChild(title);
    if (lang !== 'ja' && label !== item.title) {
      what.appendChild(make('div', 'meta', item.title));
    }
    li.appendChild(what);
    list.appendChild(li);
  }
  host.appendChild(list);
  if (shown.length > FIRST_SHOWN) {
    const more = make('button', 'link-button show-more', `${t('common.showMore')} (${shown.length - FIRST_SHOWN})`);
    (more as HTMLButtonElement).type = 'button';
    more.addEventListener('click', () => {
      for (const li of list.querySelectorAll<HTMLElement>('li[hidden]')) li.hidden = false;
      more.remove();
      (list.children[FIRST_SHOWN] as HTMLElement | undefined)?.querySelector('a')?.focus();
    });
    host.appendChild(more);
  }
}

export function initAlertsPage(): void {
  const lang = getLang();
  const t = (key: UIKey): string => ui[lang][key] ?? ui.en[key];

  void import('./warnings-banner').then((m) => m.renderWarnings(lang, t));

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  fetch(`${base}/data/alerts.json`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<AlertsFile>) : Promise.reject(res.status)))
    .then((file) => {
      for (const source of ['emergency', 'anshin', 'important', 'news'] as const) {
        const host = document.querySelector<HTMLElement>(`[data-feed="${source}"]`);
        if (!host) continue;
        renderFeed(host, file.items.filter((i) => i.source === source), lang, t);
      }
    })
    .catch(() => {
      // An error, not "no alerts": an empty feed would read as all-clear.
      for (const host of document.querySelectorAll<HTMLElement>('[data-feed]')) {
        host.textContent = '';
        const p = make('p', 'placeholder error', `${t('common.error')} `);
        const retry = make('button', 'link-button', t('common.retry')) as HTMLButtonElement;
        retry.type = 'button';
        retry.addEventListener('click', () => location.reload());
        p.appendChild(retry);
        host.appendChild(p);
      }
    });
}
