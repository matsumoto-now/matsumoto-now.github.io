import type { Lang } from '../i18n/ui';

const JST = 'Asia/Tokyo';

const LOCALES: Record<Lang, string> = {
  en: 'en-GB',
  ja: 'ja-JP',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-BR',
  it: 'it-IT',
  de: 'de-DE',
  no: 'nb-NO',
  zh: 'zh-CN',
  ko: 'ko-KR',
  tl: 'fil-PH',
  vi: 'vi-VN',
  th: 'th-TH',
};

export function locale(lang: Lang): string {
  return LOCALES[lang] ?? 'en-GB';
}

export function fmtTime(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: JST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function fmtDateTime(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: JST,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function fmtDateShort(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: JST,
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

export function fmtWeekday(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: JST, weekday: 'short' }).format(d);
}

export function fmtNum(n: number, lang: Lang, digits = 0): string {
  return new Intl.NumberFormat(locale(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Date parts in JST for a given instant. `dow`: 0 = Sunday. */
export function jstParts(d: Date): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
} {
  const shifted = new Date(d.getTime() + 9 * 3600 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
  };
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
