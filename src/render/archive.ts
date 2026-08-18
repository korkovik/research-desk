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

export function writeDayOutputs(options: WriteDayOptions): WriteDayResult {
  const { digest, config, repoRoot, logger } = options;
  const { htmlPath, jsonPath } = dayOutputPaths(config, repoRoot, digest.date);

  // Re-running the same day overwrites that day's two files. It never creates a
  // second variant, so the archive has exactly one page per date and the index
  // cannot list a day twice.
  atomicWriteFile(htmlPath, renderDayPage(digest, config));
  atomicWriteJson(jsonPath, digest);
  logger.info(`archive: wrote ${htmlPath} and ${jsonPath} (${digest.entries.length} papers)`);

  const index = regenerateIndex({ config, repoRoot, logger });
  logger.info(`archive: index lists ${index.days} day(s) at ${index.path}`);

  return { htmlPath, jsonPath, indexPath: index.path, indexedDays: index.days };
}
