/**
 * `state/seen.json` — every paper this project has ever published, with the day
 * it appeared (§8). It exists to keep one promise: "a paper never appears twice
 * within 180 days".
 *
 * This module owns the FILE and the WINDOW. It does not own the matching rules:
 * DESIGN-NOTES B.7 puts identifier normalisation and the fuzzy-title rule in
 * `src/select/identity.ts`, next to the selector that specifies them, and
 * `src/select/exclude.ts` consumes the answer through an injected `SeenLookup`.
 * Re-implementing "what counts as the same paper" here would give the project
 * two definitions that could drift apart, and the drift would show up as a
 * paper republished a week later — the one bug a reader notices unaided.
 *
 * NOTHING IS PRUNED. Entries outside the dedup window stop *matching*, but they
 * stay in the file. DESIGN-NOTES B.7 specifies dropping rows older than 400
 * days on write; this implementation deliberately does not, because the file
 * stays small for years (a few hundred kilobytes) and the row list is the only
 * single place that answers "did we ever run this paper, and when" without
 * re-reading every archived JSON twin. **This is a live disagreement with B.7
 * and needs Tom's call** — if pruning wins, it belongs in `saveSeen`, and
 * TEST-SCENARIOS RISK-SELECT-05's "not deleted unless a documented pruning
 * policy exists" is then satisfied by B.7 itself.
 *
 * Write timing is the caller's job, not this module's: DESIGN-NOTES D.3 puts
 * the `seen.json` write *after* the page and twin have been renamed into place,
 * so a run that dies mid-render does not burn its candidates.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Candidate, DigestEntry } from '../types.js';
import type { SeenLookup, SeenMatchKind } from '../select/exclude.js';
import {
  TITLE_SIMILARITY_THRESHOLD,
  candidateIdentity,
  isWithinDedupWindow,
  normaliseDoi,
  normaliseOpenAlexId,
  trigramJaccard,
} from '../select/identity.js';
import { atomicWriteJson } from '../util/atomicWrite.js';
import { isISODate } from '../util/dates.js';

/** One published paper, in the shape DESIGN-NOTES B.7 fixes. */
export interface SeenEntry {
  /** Normalised OpenAlex work id (`W123`), or null when the source had none. */
  openalexId: string | null;
  /** Normalised DOI, or null. */
  doi: string | null;
  /** arXiv id with the `arXiv:` prefix and any `vN` suffix stripped, or null. */
  arxivId: string | null;
  /** Diacritic-free, punctuation-free title, for the preprint/journal duplicate. */
  titleKey: string;
  /** §8 — "the date it appeared", `YYYY-MM-DD`. The dedup window is measured from here. */
  publishedOn: string;
  /** The day's category key, so a later recap can group without re-reading the twins. */
  category: string | null;
}

export interface SeenState {
  version: 1;
  entries: SeenEntry[];
}

const IsoDate = z.string().refine(isISODate, { message: 'expected a YYYY-MM-DD date' });

const SeenEntrySchema = z.object({
  openalexId: z.string().nullable().default(null),
  doi: z.string().nullable().default(null),
  arxivId: z.string().nullable().default(null),
  titleKey: z.string().default(''),
  publishedOn: IsoDate,
  category: z.string().nullable().default(null),
});

const SeenStateSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(SeenEntrySchema).default([]),
});

export function emptySeenState(): SeenState {
  return { version: 1, entries: [] };
}

/**
 * A missing file is the first run and starts empty. A *malformed* file throws:
 * silently starting from scratch would re-publish every paper of the last six
 * months, and the reader would see the repetition long before Tom read the log.
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
  // Re-normalised on the way in, so a row hand-edited into the file — or written
  // by an older build — still matches by the current rules.
  return {
    version: 1,
    entries: parsed.data.entries.map((entry) => ({
      ...entry,
      openalexId: normaliseOpenAlexId(entry.openalexId),
      doi: normaliseDoi(entry.doi),
    })),
  };
}

export function saveSeen(path: string, state: SeenState): void {
  atomicWriteJson(path, state);
}

/**
 * Which key recognised this paper, or null if it is new to us.
 *
 * Identifier matches are searched before title matches, so a paper that matches
 * both is reported by the key that cannot be wrong. B.7's trigram threshold is
 * a judgement call, and the run log counts `EXCL_SEEN_TITLE` separately for
 * exactly that reason.
 *
 * The window is INCLUSIVE at the boundary (`isWithinDedupWindow`): a paper
 * published exactly `dedupDays` ago still blocks, and the day after that it is
 * eligible again. "Never twice within 180 days" covers the 180th day.
 */
export function seenMatch(
  state: SeenState,
  candidate: Candidate,
  today: string,
  dedupDays: number,
): SeenMatchKind | null {
  const identity = candidateIdentity(candidate);
  const inWindow = state.entries.filter((entry) =>
    isWithinDedupWindow(entry.publishedOn, today, dedupDays),
  );

  for (const entry of inWindow) {
    if (identity.openAlexId !== null && entry.openalexId === identity.openAlexId) {
      return 'openalex-id';
    }
    if (identity.doi !== null && entry.doi === identity.doi) return 'doi';
    if (identity.arxivId !== null && entry.arxivId === identity.arxivId) return 'arxiv-id';
  }

  for (const entry of inWindow) {
    if (titleKeysAreSamePaper(identity.titleKey, entry.titleKey)) return 'title';
  }
  return null;
}

/** §8's question in its plainest form. */
export function isSeen(
  state: SeenState,
  candidate: Candidate,
  today: string,
  dedupDays: number,
): boolean {
  return seenMatch(state, candidate, today, dedupDays) !== null;
}

/**
 * The lookup `src/select/exclude.ts` asks for. Binding the state, the run date
 * and the window here is what lets the selector stay free of the filesystem and
 * of the clock.
 */
export function createSeenLookup(
  state: SeenState,
  today: string,
  dedupDays: number,
): SeenLookup {
  return (candidate) => seenMatch(state, candidate, today, dedupDays);
}

/**
 * Folds the day's published papers into the state. Pure — returns a new state,
 * so a caller can record, render and only then save, and a failed run leaves
 * `seen.json` untouched (D.3).
 *
 * A paper already recorded moves its `publishedOn` forward instead of gaining a
 * second row, so a hundred runs cannot grow a hundred rows for one study. The
 * per-day record of exactly what appeared when is the archive's JSON twins
 * (§8); this file answers "how recently", which is all the window needs.
 */
export function recordPublished(
  state: SeenState,
  entries: readonly DigestEntry[],
  date: string,
  category: string | null = null,
): SeenState {
  if (!isISODate(date)) throw new Error(`recordPublished needs a YYYY-MM-DD date, got ${date}`);
  const next: SeenEntry[] = state.entries.map((entry) => ({ ...entry }));

  for (const entry of entries) {
    const identity = candidateIdentity(entry.candidate);
    const existing = next.find(
      (row) =>
        (identity.openAlexId !== null && row.openalexId === identity.openAlexId) ||
        (identity.doi !== null && row.doi === identity.doi) ||
        (identity.arxivId !== null && row.arxivId === identity.arxivId) ||
        titleKeysAreSamePaper(identity.titleKey, row.titleKey),
    );
    if (existing) {
      if (date > existing.publishedOn) existing.publishedOn = date;
      // A paper first seen without a DOI often has one by the time it comes
      // round again; filling the gap makes the next match cheaper and surer.
      existing.openalexId ??= identity.openAlexId;
      existing.doi ??= identity.doi;
      existing.arxivId ??= identity.arxivId;
      if (existing.titleKey === '') existing.titleKey = identity.titleKey;
      if (existing.category === null) existing.category = category;
      continue;
    }
    next.push({
      openalexId: identity.openAlexId,
      doi: identity.doi,
      arxivId: identity.arxivId,
      titleKey: identity.titleKey,
      publishedOn: date,
      category,
    });
  }

  return { version: 1, entries: next };
}

/** B.7's title rule, guarded so two papers with no usable title never collide. */
function titleKeysAreSamePaper(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  return trigramJaccard(a, b) >= TITLE_SIMILARITY_THRESHOLD;
}

// Re-exported so the renderer and the tests have one obvious place to reach for
// identifier normalisation without importing the selector directly.
export { normaliseDoi, normaliseOpenAlexId };
