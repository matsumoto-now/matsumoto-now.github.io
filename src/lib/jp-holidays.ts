/** Japanese public holidays (祝日), computed rather than fetched.
 *
 *  Needed only to say whether the waste facilities are open right now: both are
 *  closed on Sundays and public holidays, and a hardcoded "open Mon–Sat" chip
 *  would be wrong on the ~16 holidays a year — the two weeks around New Year
 *  and Golden Week being exactly when people have a car full of rubbish.
 *
 *  Same reasoning as src/lib/moon.ts: this is arithmetic, not data. It needs no
 *  API, no network and no yearly update.
 *
 *  Covers the three rules that make the list non-obvious:
 *   - happy Monday (成人の日, 海の日, 敬老の日, スポーツの日): the nth Monday of a month;
 *   - the equinoxes (春分の日, 秋分の日): astronomical, so the date moves — the
 *     standard approximation below is exact for 1980–2099;
 *   - 振替休日 and 国民の休日: a holiday falling on a Sunday moves to the next day
 *     that is not itself a holiday, and a lone weekday between two holidays
 *     becomes one (which is what makes 22 September a holiday in some years).
 *
 *  Not covered: one-off moves by special legislation (the 2020–21 Olympic
 *  shuffle, an imperial succession). Those are announced years ahead and would
 *  need a dated exception here.
 */

/** Vernal / autumnal equinox day, valid 1980–2099. */
function equinox(year: number, spring: boolean): number {
  const base = spring ? 20.8431 : 23.2488;
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** Date of the nth `weekday` of a month (weekday: 0 = Sunday). */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const cache = new Map<number, Set<string>>();

/** Every public holiday in `year`, as a set of YYYY-MM-DD strings. */
export function holidaysOf(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const fixed: [number, number][] = [
    [1, 1], // 元日
    [2, 11], // 建国記念の日
    [2, 23], // 天皇誕生日
    [4, 29], // 昭和の日
    [5, 3], // 憲法記念日
    [5, 4], // みどりの日
    [5, 5], // こどもの日
    [8, 11], // 山の日
    [11, 3], // 文化の日
    [11, 23], // 勤労感謝の日
  ];
  const days = new Set<string>(fixed.map(([m, d]) => iso(year, m, d)));
  days.add(iso(year, 1, nthWeekday(year, 1, 1, 2))); // 成人の日
  days.add(iso(year, 7, nthWeekday(year, 7, 1, 3))); // 海の日
  days.add(iso(year, 9, nthWeekday(year, 9, 1, 3))); // 敬老の日
  days.add(iso(year, 10, nthWeekday(year, 10, 1, 2))); // スポーツの日
  days.add(iso(year, 3, equinox(year, true))); // 春分の日
  days.add(iso(year, 9, equinox(year, false))); // 秋分の日

  // 振替休日: a holiday on a Sunday moves to the next non-holiday day.
  for (const key of [...days]) {
    const d = new Date(`${key}T00:00:00`);
    if (d.getDay() !== 0) continue;
    do d.setDate(d.getDate() + 1);
    while (days.has(iso(d.getFullYear(), d.getMonth() + 1, d.getDate())));
    days.add(iso(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }

  // 国民の休日: a single weekday with a holiday on either side. In practice only
  // ever September, between 敬老の日 and 秋分の日.
  for (let day = 2; day <= 30; day++) {
    const key = iso(year, 9, day);
    if (days.has(key)) continue;
    const d = new Date(`${key}T00:00:00`);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (days.has(iso(year, 9, day - 1)) && days.has(iso(year, 9, day + 1))) days.add(key);
  }

  cache.set(year, days);
  return days;
}

/** Is `date` a Japanese public holiday? */
export function isHoliday(date: Date): boolean {
  return holidaysOf(date.getFullYear()).has(
    iso(date.getFullYear(), date.getMonth() + 1, date.getDate()),
  );
}
