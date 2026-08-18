/**
 * Paper identity — DESIGN-NOTES B.7.
 *
 * §8: "A paper never appears twice within 180 days." Three things make that
 * harder than comparing IDs:
 *
 *  1. The same paper carries different identifiers depending on who indexed it.
 *     An arXiv preprint has no OpenAlex ID on Monday and has one by Friday.
 *  2. DOIs are written five ways (`10.1/x`, `https://doi.org/10.1/X`, `doi:…`)
 *     and are case-insensitive, so string equality is the wrong test.
 *  3. The preprint and the journal version of one paper share **neither** DOI
 *     nor OpenAlex ID, and their titles differ by an article or a subtitle.
 *     Only a fuzzy title match catches that pair, which is why B.7 specifies a
 *     trigram-Jaccard threshold rather than exact title equality.
 *
 * Everything here is a pure function of its arguments — no file access, no
 * clock. `src/state/seen.ts` owns `state/seen.json` and calls into this module;
 * the matching logic lives with the selector because that is where it is
 * specified (§6) and where it is testable without touching the filesystem.
 */
import type { Candidate } from '../types.js';
import { daysBetween, isISODate } from '../util/dates.js';

/** B.7: the trigram-Jaccard similarity at which two titles are the same paper. */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

/**
 * B.7 DOI normalisation: lower-case; strip the resolver prefixes; strip
 * trailing punctuation, which is what a DOI picked out of running prose or a
 * reference list drags along with it.
 */
export function normaliseDoi(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const lowered = raw.trim().toLowerCase();
  if (lowered === '') return null;
  const withoutPrefix = lowered.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)\s*/u, '');
  const trimmed = withoutPrefix.replace(/[.,)\s]+$/u, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * B.7 OpenAlex ID normalisation: the bare `W…` id, never the URL form.
 * Upper-cased because OpenAlex renders the same id as `W123` in `id` and
 * `w123` in some `ids` maps, and `seen.json` must collide on both.
 */
export function normaliseOpenAlexId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const bare = trimmed
    .replace(/^https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?/iu, '')
    .replace(/^openalex:/iu, '');
  return bare === '' ? null : bare.toUpperCase();
}

/**
 * B.7 arXiv ID normalisation: strip the `arXiv:` prefix and any `vN` suffix, so
 * that v1 of a preprint and its v3 revision are one paper.
 */
export function normaliseArxivId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;
  const bare = trimmed
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//u, '')
    .replace(/^arxiv:/u, '')
    .replace(/\.pdf$/u, '')
    .replace(/v\d+$/u, '');
  return bare === '' ? null : bare;
}

/**
 * B.7 `titleKey`: lower-case, strip diacritics, keep only `[a-z0-9]`.
 *
 * NFD splits `é` into `e` + U+0301 so that the combining mark can be dropped by
 * class; `\p{M}` with the `u` flag is the only correct way to say "combining
 * mark" in JS, since `\w` and `\b` are ASCII-only (DESIGN-NOTES A.0.1).
 * Punctuation and spaces go too — the preprint's "Two-Year" and the journal's
 * "two year" must produce the same key.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '');
}

/** Character trigrams of a `titleKey`. Empty for keys shorter than 3 characters. */
export function trigrams(key: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + 3 <= key.length; i++) set.add(key.slice(i, i + 3));
  return set;
}

/**
 * Jaccard similarity of two `titleKey` trigram sets, in `[0, 1]`.
 *
 * Character trigrams rather than word shingles: the difference between a
 * preprint title and its journal version is usually one short word, which
 * changes ~3 of ~70 trigrams (similarity ≈ 0.93) but 1 of ~12 word shingles
 * (≈ 0.85). The character measure is the one that sits above B.7's 0.90 line
 * for a genuine duplicate and far below it for two different papers.
 */
export function trigramJaccard(keyA: string, keyB: string): number {
  if (keyA === keyB) return keyA === '' ? 0 : 1;
  const a = trigrams(keyA);
  const b = trigrams(keyB);
  // Too short to have trigrams: the exact-equality case above already answered.
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** B.7's title rule: exact `titleKey` match, or trigram Jaccard ≥ 0.90. */
export function titlesAreSamePaper(titleA: string, titleB: string): boolean {
  return trigramJaccard(titleKey(titleA), titleKey(titleB)) >= TITLE_SIMILARITY_THRESHOLD;
}

/** The four keys `seen.json` stores for one paper (B.7). */
export interface CandidateIdentity {
  readonly openAlexId: string | null;
  readonly doi: string | null;
  readonly arxivId: string | null;
  readonly titleKey: string;
}

/**
 * Every identifier a candidate can be recognised by.
 *
 * The arXiv id is read off `Candidate.id` (`arxiv:2608.16889`) rather than a
 * field of its own, because §10 fixes the seven-field contract and the prefix
 * in `id` already carries the source.
 */
export function candidateIdentity(candidate: Candidate): CandidateIdentity {
  const isArxiv = candidate.source === 'arxiv' || candidate.id.toLowerCase().startsWith('arxiv:');
  return {
    openAlexId: normaliseOpenAlexId(candidate.openAlexId ?? null),
    doi: normaliseDoi(candidate.doi ?? null),
    arxivId: isArxiv ? normaliseArxivId(candidate.id) : null,
    titleKey: titleKey(candidate.title),
  };
}

/**
 * B.7's dedup window, inclusive at both ends: a paper published exactly
 * `windowDays` ago is still excluded, `windowDays + 1` is eligible again. §8
 * says "never twice within 180 days" and "within 180" includes the 180th.
 *
 * Entries with an unreadable date are treated as inside the window: a broken
 * `seen.json` row must not become a licence to republish a paper.
 */
export function isWithinDedupWindow(
  publishedOn: string,
  today: string,
  windowDays: number,
): boolean {
  if (!isISODate(publishedOn) || !isISODate(today)) return true;
  const age = daysBetween(publishedOn, today);
  return age <= windowDays;
}
