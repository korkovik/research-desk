/**
 * Writes one day's outputs and rebuilds the index (§8, §11 step 9).
 *
 * Three files, in this order: the page a human reads, the JSON twin a later
 * pass reads, then the index. The twin is the serialised `DayDigest` verbatim —
 * "paper IDs, DOIs, scores, all text blocks", so a weekly recap or an English
 * translation pass never has to re-scrape. It round-trips exactly: nothing here
 * reshapes the digest on the way out, and `exactOptionalPropertyTypes` is what
 * guarantees no optional field is present-but-undefined, which is the one thing
 * `JSON.stringify` would quietly drop.
 *
 * Both writes are atomic (`src/util/atomicWrite.ts`), so a run killed mid-write
 * leaves yesterday's page intact rather than a truncated one.
 */
import { join, resolve } from 'node:path';
import type { Config } from '../config.js';
import type { DayDigest } from '../types.js';
import { atomicWriteFile, atomicWriteJson } from '../util/atomicWrite.js';
import { isISODate } from '../util/dates.js';
import type { Logger } from '../util/log.js';
import { regenerateIndex } from './index.js';
import { renderDayPage } from './page.js';

export interface DayOutputPaths {
  /** Absolute path of `archive/YYYY-MM-DD.html`. */
  htmlPath: string;
  /** Absolute path of `archive/YYYY-MM-DD.json`. */
  jsonPath: string;
}

export interface WriteDayOptions {
  readonly digest: DayDigest;
  readonly config: Config;
  /** Everything in `config.paths` is relative to this. */
  readonly repoRoot: string;
  readonly logger: Logger;
}

export interface WriteDayResult extends DayOutputPaths {
  /** Absolute path of the regenerated index. */
  indexPath: string;
  /** How many days the regenerated index lists, this one included. */
  indexedDays: number;
}

/**
 * The date is also a filename, so it is validated before it is joined to a
 * path: a digest carrying `../../etc/passwd` as its date must fail loudly here
 * rather than write somewhere surprising.
 */
export function dayOutputPaths(config: Config, repoRoot: string, date: string): DayOutputPaths {
  if (!isISODate(date)) throw new Error(`digest date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  const dir = resolve(repoRoot, config.paths.archiveDir);
  return {
    htmlPath: join(dir, `${date}.html`),
    jsonPath: join(dir, `${date}.json`),
  };
}

/**
 * Refuses to write a page that would fetch anything off the machine.
 *
 * The distinction being enforced: a sub-resource the document LOADS is
 * forbidden by §8; a hyperlink the reader may CLICK is required by §7.6.
 *
 * The subtlety is that a page's text is not markup. Summaries restate what
 * abstracts say, and abstracts carry data-availability statements — a sentence
 * ending "...available at https://osf.io/ab12c" reaches the page as an escaped
 * text node that loads nothing. A naive scan of the whole document rejects it,
 * and because this runs at write time that would abort the entire edition,
 * after the full Claude spend, over a sentence. So the scan looks at the two
 * places a request can actually come from — tags with their attributes, and the
 * stylesheet — and never at running text.
 */
export function assertNoRemoteResources(html: string, path: string): void {
  // The stylesheet is a text node, so it has to be lifted out before text nodes
  // are stripped, or the CSS rules below would be checking an empty string.
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1] ?? '')
    .join('\n');
  const markup = html.replace(/>[^<]*</g, '><');

  const cssRules: [RegExp, string][] = [
    [/@import/i, '@import'],
    [/url\(\s*['"]?(?!data:)/i, 'a CSS url()'],
  ];
  for (const [pattern, what] of cssRules) {
    if (pattern.test(css)) throw new Error(`${path} would load ${what} — §8 forbids it`);
  }

  const markupRules: [RegExp, string][] = [
    [/<link\b/i, '<link>'],
    [/<script\b[^>]*\bsrc=/i, '<script src>'],
    [/<(img|iframe|video|audio|object|embed|source|base)\b/i, 'a remote-capable element'],
    [/localStorage|sessionStorage|indexedDB/, 'a storage API'],
    [/\son[a-z]+\s*=/i, 'an inline event handler'],
  ];
  for (const [pattern, what] of markupRules) {
    if (pattern.test(markup)) throw new Error(`${path} would load or run ${what} — §8 forbids it`);
  }

  // Whatever remote URLs survive in markup after the anchors are removed are in
  // attributes, which is the only place left that can issue a request.
  const withoutAnchors = markup.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '');
  const remote = /https?:\/\//.exec(withoutAnchors);
  if (remote) {
    throw new Error(`${path} carries a remote URL in an attribute: ${remote[0]} — §8 forbids it`);
  }
}

export function writeDayOutputs(options: WriteDayOptions): WriteDayResult {
  const { digest, config, repoRoot, logger } = options;
  const { htmlPath, jsonPath } = dayOutputPaths(config, repoRoot, digest.date);

  // Re-running the same day overwrites that day's two files. It never creates a
  // second variant, so the archive has exactly one page per date and the index
  // cannot list a day twice.
  const html = renderDayPage(digest, config);
  // §8's self-contained rule is an acceptance check (§11 step 9), so it is
  // enforced where the file is written rather than only in the test suite. A
  // renderer change that started pulling in a font would otherwise ship, and
  // the family would meet it as a page that does not load on a slow train.
  assertNoRemoteResources(html, htmlPath);
  atomicWriteFile(htmlPath, html);
  atomicWriteJson(jsonPath, digest);
  logger.info(`archive: wrote ${htmlPath} and ${jsonPath} (${digest.entries.length} papers)`);

  const index = regenerateIndex({ config, repoRoot, logger });
  logger.info(`archive: index lists ${index.days} day(s) at ${index.path}`);

  return { htmlPath, jsonPath, indexPath: index.path, indexedDays: index.days };
}
