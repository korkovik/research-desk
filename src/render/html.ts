/**
 * The small, dull layer between untrusted text and the page.
 *
 * Everything rendered comes from a language model or a third-party API, so no
 * value is ever interpolated raw. There is deliberately ONE escape function
 * covering both text and attribute contexts, because two functions means one
 * day picking the wrong one; `'` and `"` are both escaped so a value is safe
 * inside either quoting style.
 */
import type { StringTable } from './stringTable.js';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Substitutes `{name}` slots in a locale string. An unknown slot is left
 * verbatim instead of throwing: a typo in a locale file should show up as a
 * visible `{neco}` on the page and in the tests, not stop the 06:00 run from
 * publishing anything at all (§9 — fail visibly, not loudly).
 */
export function fillText(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/** As `fillText`, escaped for direct insertion into the page. */
export function fillHtml(template: string, vars: Readonly<Record<string, string>>): string {
  return escapeHtml(fillText(template, vars));
}

/**
 * Returns the URL only if it is an ordinary web link. Source APIs hand us URL
 * strings we never see before render time; without this check a `javascript:`
 * or `data:` value from a bad record would become a live href in a page the
 * family opens.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `2026-08-19` → `19. srpna 2026`. Falls back to the raw ISO date if it is malformed. */
export function formatDateText(isoDate: string, strings: StringTable): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  if (!year || !month || !day) return isoDate;
  const monthName = strings.monthsInDates[Number(month) - 1];
  if (!monthName) return isoDate;
  return fillText(strings.datePattern, {
    day: String(Number(day)),
    month: monthName,
    year,
  });
}

/**
 * Renders a block of summary text as paragraphs. Summaries arrive as prose
 * with blank lines between paragraphs; single newlines inside a paragraph are
 * the model's line wrapping, not the author's intent, so they collapse to
 * spaces.
 */
export function paragraphsHtml(text: string, className?: string): string {
  const attr = className ? ` class="${escapeHtml(className)}"` : '';
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
  if (paragraphs.length === 0) return '';
  return paragraphs.map((part) => `<p${attr}>${escapeHtml(part)}</p>`).join('\n');
}

/** An `<a>` to somewhere off-page. Returns null when the URL is not usable. */
export function externalLink(url: string | null | undefined, text: string): string | null {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  // rel="noreferrer" keeps the reader's visit to this archive out of the
  // referrer header of the publisher they click through to.
  return `<a href="${escapeHtml(safe)}" rel="noreferrer">${escapeHtml(text)}</a>`;
}

/** Author lists run to hundreds of names on some papers; a phone screen does not. */
export function formatAuthors(
  authors: readonly string[] | undefined,
  strings: StringTable,
  maxNames = 6,
): string {
  const names = (authors ?? []).map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return strings.refAuthorsUnknown;
  if (names.length <= maxNames) return names.join(', ');
  return `${names.slice(0, maxNames).join(', ')} ${strings.refAndOthers}`;
}
