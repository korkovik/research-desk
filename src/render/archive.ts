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
 * A hyperlink the reader may click is required by §7.6; a sub-resource the
 * document loads is forbidden by §8. The check is that distinction: strip every
 * anchor, then nothing remote may remain.
 */
export function assertNoRemoteResources(html: string, path: string): void {
  const forbidden: [RegExp, string][] = [
    [/<link\b/i, '<link>'],
    [/<script\b[^>]*\bsrc=/i, '<script src>'],
    [/<(img|iframe|video|audio|object|embed|source|base)\b/i, 'a remote-capable element'],
    [/@import/i, '@import'],
    [/url\(\s*['"]?(?!data:)/i, 'a CSS url()'],
    [/localStorage|sessionStorage|indexedDB/, 'a storage API'],
  ];
  for (const [pattern, what] of forbidden) {
    if (pattern.test(html)) throw new Error(`${path} would load ${what} — §8 forbids it`);
  }
  const withoutAnchors = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<a\b[^>]*>/gi, '');
  const remote = /https?:\/\//.exec(withoutAnchors);
  if (remote) {
    throw new Error(`${path} carries a remote URL outside a link: ${remote[0]} — §8 forbids it`);
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
