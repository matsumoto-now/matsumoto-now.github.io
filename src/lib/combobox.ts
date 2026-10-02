/** Search-as-you-type results list (WAI-ARIA combobox + listbox): arrow keys
 *  move through the results, Enter picks the highlighted (or first) one, Escape
 *  clears. Replaces <datalist>, which iOS Safari renders poorly and which gives
 *  no "nothing matches" feedback. Rendering of each option stays with the page. */

export interface ComboOption<V> {
  value: V;
  /** trusted HTML built by the page (escape any data before passing it) */
  html: string;
}

interface ComboboxConfig<V> {
  input: HTMLInputElement;
  list: HTMLElement;
  search: (query: string) => ComboOption<V>[];
  onPick: (value: V) => void;
  noMatch: string;
  /** class for each option button; defaults to "combo-option" */
  optionClass?: string;
}

let uid = 0;

export function combobox<V>(cfg: ComboboxConfig<V>): { close(): void } {
  const { input, list, search, onPick, noMatch } = cfg;
  const id = list.id || `combo-${++uid}`;
  list.id = id;
  list.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');

  let options: ComboOption<V>[] = [];
  let active = -1;

  const buttons = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')];

  const highlight = (i: number): void => {
    const all = buttons();
    active = all.length ? (i + all.length) % all.length : -1;
    all.forEach((b, k) => b.setAttribute('aria-selected', String(k === active)));
    const current = all[active];
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const close = (): void => {
    list.innerHTML = '';
    list.hidden = true;
    options = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const pick = (i: number): void => {
    const option = options[i];
    if (!option) return;
    input.value = '';
    close();
    input.blur(); // drops the phone keyboard so the answer is visible
    onPick(option.value);
  };

  const render = (): void => {
    const q = input.value.trim();
    if (!q) return close();
    options = search(q);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
    list.innerHTML = options.length
      ? options
          .map(
            (o, i) =>
              `<div role="option" id="${id}-${i}" data-i="${i}" aria-selected="false" class="${cfg.optionClass ?? 'combo-option'}">${o.html}</div>`,
          )
          .join('')
      : `<p class="card-note combo-empty" role="status">${noMatch}</p>`;
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) render();
      e.preventDefault();
      highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (!options.length) return;
      e.preventDefault();
      pick(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      input.value = '';
      close();
    }
  });
  // mousedown, not click: fires before the input's blur
  list.addEventListener('mousedown', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (!opt) return;
    e.preventDefault();
    pick(Number(opt.dataset.i));
  });
  close();
  return { close };
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Lowercase without macrons or width variants, so "hongo" finds "Hongō". */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
