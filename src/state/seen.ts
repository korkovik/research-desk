/**
 * `state/seen.json` — every paper this project has ever published, with the day
 * it appeared (§8). It exists to keep the promise that "a paper never appears
 * twice within 180 days".
 *
 * Two deliberate decisions:
 *
 * NOTHING IS EVER PRUNED. Entries outside the dedup window stop *matching*,
 * but they stay in the file. The file is a few hundred kilobytes after years of
 * daily runs, and it is the only single place that answers "did we already run
 * this paper, and when" without re-reading every archived JSON twin. Deleting
 * old rows would trade that record for disk space we do not need.
 *
 * MATCHING IS ON NORMALISED KEYS, NOT ON RAW STRINGS. The same paper reaches us
 * as `10.1234/ABC`, `https://doi.org/10.1234/abc` and `doi:10.1234/abc`
 * depending on which source found it, and OpenAlex IDs arrive both bare and as
 * full URLs. A dedup check that compared raw strings would silently re-publish
 * the same study a week later, which is the failure a reader notices first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { DigestEntry } from '../types.js';
import { atomicWriteJson } from '../util/atomicWrite.js';
import { daysBetween, isISODate } from '../util/dates.js';

export interface SeenEntry {
  /** Source-prefixed candidate id (`openalex:W123`, `arxiv:2608.16889`). */
  id: string;
  /** Normalised OpenAlex work id (`W123`), or null when the source had none. */
  openAlexId: string | null;
  /** Bare lower-case DOI (`10.1234/abc`), or null. */
  doi: string | null;
  /** §8 — "the date it appeared". The FIRST day this paper was published here. */
  date: string;
  /**
   * The most recent day it was published. Equal to `date` unless a paper
   * legitimately came round again after the dedup window expired; the window
   * is measured from this, so a re-run paper blocks for another 180 days.
   */
  lastPublished: string;
}

export interface SeenState {
  schemaVersion: 1;
  entries: SeenEntry[];
}

/** Whatever a caller can offer for matching. A `Candidate` satisfies this as-is. */
export interface DedupKeys {
  id?: string | undefined;
  doi?: string | null | undefined;
  openAlexId?: string | null | undefined;
}

const IsoDate = z.string().refine(isISODate, { message: 'expected a YYYY-MM-DD date' });

const SeenEntrySchema = z.object({
  id: z.string().min(1),
  openAlexId: z.string().nullable().default(null),
  doi: z.string().nullable().default(null),
  date: IsoDate,
  // Absent in files written before this field existed: such a row has only ever
  // been published once, so its last appearance is its first.
  lastPublished: IsoDate.optional(),
});

const SeenStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  entries: z.array(SeenEntrySchema).default([]),
});

export function emptySeenState(): SeenState {
  return { schemaVersion: 1, entries: [] };
}

/**
 * A missing file is the first run and starts empty. A *malformed* file throws:
 * silently starting from scratch would re-publish every paper of the last six
 * months, and the reader would see the repetition long before Tom saw the log.
 */
export function loadSeen(path: string): SeenState {
  if (!existsSync(path)) return emptySeenState();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = SeenStateSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`${path} is not a valid dedup state:\n${lines.join('\n')}`);
  }
  return {
    schemaVersion: 1,
    entries: parsed.data.entries.map((entry) => ({
      id: entry.id,
      openAlexId: normaliseOpenAlexId(entry.openAlexId),
      doi: normaliseDoi(entry.doi),
      date: entry.date,
      lastPublished: entry.lastPublished ?? entry.date,
    })),
  };
}

export function saveSeen(path: string, state: SeenState): void {
  atomicWriteJson(path, state);
}

/**
 * `10.1234/ABC`, `https://doi.org/10.1234/abc`, `doi:10.1234/abc` and
 * `  10.1234/abc  ` all collapse to `10.1234/abc`. Anything that is not
 * recognisably a DOI becomes null rather than a key that could collide with
 * another paper's junk value.
 */
export function normaliseDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  let doi = value.trim().toLowerCase();
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  doi = doi.replace(/^doi:\s*/, '');
  doi = doi.trim();
  // Every DOI is `10.<registrant>/<suffix>`; nothing else is safe to match on.
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

/** `https://openalex.org/w123`, `W123`, `w123` → `W123`. */
export function normaliseOpenAlexId(value: string | null | undefined): string | null {
  if (!value) return null;
  const id = value
    .trim()
    .replace(/^https?:\/\/(api\.)?openalex\.org\/(works\/)?/i, '')
    .toUpperCase();
  return /^W\d+$/.test(id) ? id : null;
}

/**
 * §8 — has this paper appeared within the last `dedupDays` days?
 *
 * The window is INCLUSIVE at the boundary: a paper published exactly
 * `dedupDays` days ago still blocks, and the day after that it is free again.
 * "Never twice within 180 days" reads as covering the 180th day itself.
 *
 * Matching is `openAlexId` OR `doi` OR the source-prefixed candidate id. The
 * third key is not in §8's wording, but an arXiv-only preprint often has
 * neither a DOI nor an OpenAlex id, and without it such a paper could be
 * published twice in the same week.
 */
export function isSeen(
  state: SeenState,
  candidate: DedupKeys,
  today: string,
  dedupDays: number,
): boolean {
  const doi = normaliseDoi(candidate.doi);
  const openAlexId = normaliseOpenAlexId(candidate.openAlexId);
  const id = candidate.id?.trim() ?? '';
  if (!doi && !openAlexId && id === '') return false;

  for (const entry of state.entries) {
    const matches =
      (openAlexId !== null && entry.openAlexId === openAlexId) ||
      (doi !== null && entry.doi === doi) ||
      (id !== '' && entry.id === id);
    if (!matches) continue;
    if (daysBetween(entry.lastPublished, today) <= dedupDays) return true;
  }
  return false;
}

/**
 * Folds the day's published papers into the state. Pure — returns a new state,
 * so a caller can record, render and only then save, and a failed run leaves
 * `seen.json` untouched.
 *
 * A paper already in the file is updated in place rather than appended, so a
 * hundred runs cannot grow a hundred rows for the same study.
 */
export function recordPublished(
  state: SeenState,
  entries: readonly DigestEntry[],
  date: string,
): SeenState {
  if (!isISODate(date)) throw new Error(`recordPublished needs a YYYY-MM-DD date, got ${date}`);
  const next: SeenEntry[] = state.entries.map((entry) => ({ ...entry }));

  for (const entry of entries) {
    const candidate = entry.candidate;
    const doi = normaliseDoi(candidate.doi);
    const openAlexId = normaliseOpenAlexId(candidate.openAlexId);
    const id = candidate.id.trim();
    const existing = next.find(
      (row) =>
        (openAlexId !== null && row.openAlexId === openAlexId) ||
        (doi !== null && row.doi === doi) ||
        (id !== '' && row.id === id),
    );
    if (existing) {
      // Keep the earliest appearance as the historical record; move the window.
      existing.lastPublished = date > existing.lastPublished ? date : existing.lastPublished;
      existing.openAlexId ??= openAlexId;
      existing.doi ??= doi;
      continue;
    }
    next.push({ id, openAlexId, doi, date, lastPublished: date });
  }

  return { schemaVersion: 1, entries: next };
}
