/** Collection-calendar subscriptions: one .ics per district per language.
 *
 *  This is the only part of the site that can reach a resident when they are
 *  not looking at it. A static site cannot push a notification, but a
 *  subscribed calendar can: each event carries a VALARM five hours before
 *  midnight, so the phone says "plastic tomorrow" at 19:00 the evening before,
 *  while there is still time to do something about it.
 *
 *  Served as a subscription rather than a download so that next April's reissue
 *  propagates on its own — REFRESH-INTERVAL asks clients to re-read weekly, and
 *  the UIDs are stable per district and date, so a re-read updates events in
 *  place instead of duplicating them.
 *
 *  DTSTAMP is the data file's fetch time, not the build time: the deploy runs on
 *  every push, and a moving DTSTAMP would tell every subscriber's client that
 *  all 190 events had changed.
 */

import type { APIRoute, GetStaticPaths } from 'astro';
import { languages, locales, type Lang, type UIKey } from '../../../i18n/ui';
import { features } from '../../../features';
import garbage from '../../../../public/data/garbage.json';

interface District {
  name: string;
  slug: string;
  pdf: string;
  days: Record<string, number[]> | null;
}

const data = garbage as unknown as {
  fetched: string;
  fiscalYear: number;
  categories: string[];
  districts: District[];
};

/** RFC 5545 text escaping: backslash, semicolon, comma and newline. */
const esc = (s: string) => s.replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');

/** Fold to 75 octets per line, continuing with a leading space. Counted in
 *  bytes, not characters — every summary here is Japanese in at least one
 *  language, and folding by character length would overrun the limit. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let used = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    // Continuation lines carry a leading space, so their budget is one less.
    const budget = out.length === 0 ? 75 : 74;
    if (used + size > budget) {
      out.push(current);
      current = '';
      used = 0;
    }
    current += ch;
    used += size;
  }
  if (current) out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n');
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dateValue = (iso: string) => iso.replace(/-/g, '');

/** The day after `iso` — an all-day VEVENT's DTEND is exclusive. */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dateValue(d.toISOString().slice(0, 10));
}

export const getStaticPaths: GetStaticPaths = () => {
  if (!features.garbagePage) return [];
  return (Object.keys(languages) as Lang[]).flatMap((lang) =>
    data.districts
      .filter((d) => d.days)
      .map((d) => ({ params: { lang, district: d.slug } })),
  );
};

export const GET: APIRoute = ({ params }) => {
  const lang = (params.lang ?? 'en') as Lang;
  const district = data.districts.find((d) => d.slug === params.district);
  if (!district?.days) return new Response('Not found', { status: 404 });

  const dict = locales[lang]?.dict ?? locales.en.dict;
  const t = (key: string) => dict[key as UIKey] ?? locales.en.dict[key as UIKey] ?? key;

  const dtstamp = stamp(data.fetched);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//matsumoto-now//garbage-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${t('gb.title')} — ${district.name}`)}`,
    // The district's own PDF and the "out by 7:00–8:15" instruction live here,
    // once, rather than on all ~190 events: repeating them per event tripled the
    // file for nothing a calendar app shows any better.
    `X-WR-CALDESC:${esc(`${t('gb.putOutBy')}\n${district.pdf}`)}`,
    `URL:${district.pdf}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:P7D',
    'X-PUBLISHED-TTL:P7D',
  ];

  for (const [iso, indices] of Object.entries(district.days)) {
    const names = indices
      .map((i) => t(`gb.cat.${data.categories[i]}`))
      .filter(Boolean)
      .join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${iso}-${district.slug}@matsumoto-now`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dateValue(iso)}`,
      `DTEND;VALUE=DATE:${nextDay(iso)}`,
      `SUMMARY:${esc(names)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      // Five hours before the event's midnight start: 19:00 the evening before.
      'TRIGGER:-PT5H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${names} — ${t('common.tomorrow')}`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/calendar; charset=utf-8' },
  });
};
