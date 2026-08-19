/**
 * §6's hard exclusions — DESIGN-NOTES B.1.
 *
 * "Hard exclusions: retracted works, papers without an abstract, papers where
 * the abstract is behind a paywall and no TLDR exists, and anything already in
 * the dedup state file." B.1 turns that sentence into nine ordered rules, each
 * with a reason code, because §9 requires the run log to account for every
 * candidate: "candidates found, 5 selected, any failures". A candidate that
 * vanishes without a counted reason is indistinguishable from a bug.
 *
 * Order matters and is B.1's, not a convenience: a retracted paper is reported
 * as retracted even when it also has a thin abstract, so that a spike in one
 * reason code means what it looks like it means.
 *
 * Pure: no clock (`today` is injected), no filesystem. Dedup storage belongs to
 * `src/state/seen.ts`; this module receives a lookup function.
 */
import type { Candidate, EnrichedCandidate } from '../types.js';
import { ageInDays, normaliseWhitespace } from './score.js';

export const EXCLUSION_REASONS = [
  'EXCL_RETRACTED',
  'EXCL_NO_ABSTRACT',
  'EXCL_ABSTRACT_TOO_THIN',
  'EXCL_STALE',
  'EXCL_SEEN',
  'EXCL_SEEN_TITLE',
  'EXCL_TYPE',
  // Not produced by `applyExclusions` — the selector adds it after ranking,
  // when two records in the SAME day's pool turn out to be one paper. It lives
  // in this list so the run log reports every reason a candidate was dropped in
  // one place.
  'EXCL_SAME_PAPER_TWICE',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export type ExclusionCounts = Record<ExclusionReason, number>;

/**
 * How `seen.json` recognised a candidate.
 *
 * Richer than the boolean a "have I seen this?" question suggests, because B.1
 * splits the answer across two reason codes: an ID or DOI hit is `EXCL_SEEN`,
 * a fuzzy title hit is `EXCL_SEEN_TITLE`. The distinction earns its keep in the
 * log — title matches are the ones that can be wrong (B.7's 0.90 trigram
 * threshold is a judgement call), and they need to be countable on their own.
 */
export type SeenMatchKind = 'openalex-id' | 'doi' | 'arxiv-id' | 'title';

/**
 * Injected by the caller. `src/state/seen.ts` owns `state/seen.json` and the
 * 180-day window; this module only asks the question. Tests pass a stub, which
 * is the whole reason the dependency is inverted.
 */
export type SeenLookup = (candidate: Candidate) => SeenMatchKind | null;

/** B.1 rule 7 — record classes that are not a paper anyone can be told about. */
export const EXCLUDED_WORK_TYPES: ReadonlySet<string> = new Set([
  'editorial',
  'letter',
  'erratum',
  'book-review',
  'paratext',
  'dataset',
  'peer-review',
]);

/** B.1 rule 1 — the third of its three retraction signals. */
const RETRACTED_TITLE = /^\s*retracted(?!\p{L})/iu;

/** B.1 rule 8 — a title that announces the record is *about* another paper. */
const NON_ARTICLE_TITLE =
  /^\s*(?:correction|corrigendum|erratum|editorial|comment on|reply to|response to)(?!\p{L})/iu;

export interface ExclusionOptions {
  /** Run date, `YYYY-MM-DD`. Injected — nothing here reads a clock. */
  readonly today: string;
  /** `config.windows.freshnessDays`. B.1 rule 4 and B.5 must move together. */
  readonly freshnessDays: number;
  /** `config.ranking.minAbstractChars`. B.1 rule 3. */
  readonly minAbstractChars: number;
  /**
   * Set on the shortlisting pass, which runs BEFORE Semantic Scholar
   * enrichment. Rules 2 and 3 both accept a TLDR as a substitute for a thin or
   * missing abstract, and at that point no candidate has one yet — so applying
   * them there drops exactly the papers enrichment was about to rescue. They
   * are re-applied in full on the real pass, which is where they belong.
   */
  readonly deferAbstractRules?: boolean | undefined;
  readonly isSeen: SeenLookup;
}

export interface Exclusion {
  readonly candidate: EnrichedCandidate;
  readonly reason: ExclusionReason;
  /** One line for the run log, naming the rule that fired and what it saw. */
  readonly detail: string;
}

export interface ExclusionOutcome {
  readonly survivors: EnrichedCandidate[];
  readonly excluded: Exclusion[];
  readonly counts: ExclusionCounts;
}

export function emptyExclusionCounts(): ExclusionCounts {
  return {
    EXCL_RETRACTED: 0,
    EXCL_NO_ABSTRACT: 0,
    EXCL_ABSTRACT_TOO_THIN: 0,
    EXCL_STALE: 0,
    EXCL_SEEN: 0,
    EXCL_SEEN_TITLE: 0,
    EXCL_SAME_PAPER_TWICE: 0,
    EXCL_TYPE: 0,
  };
}

/**
 * B.1 rule 9 — "abstract is an inverted index that failed to reconstruct".
 *
 * B.1 states the condition but not the test, so here is the test. OpenAlex
 * ships abstracts as a word→positions map (§4.1); when reconstruction fails the
 * text that survives is one of three recognisable shapes, none of which is
 * prose:
 *
 *  - the raw JSON object leaked through verbatim;
 *  - the field name came with it;
 *  - the *positions* were serialised instead of the words, leaving a string
 *    that is mostly bare integers.
 *
 * The third is the one a length check cannot catch — a failed reconstruction is
 * often long — which is why B.1 gives it a rule of its own after the length
 * rules. Note that unlike rules 2 and 3, B.1 attaches no TLDR escape here: a
 * source text we cannot read is not made readable by a one-sentence summary of
 * it, and §7.4's verification would have nothing to verify the example against.
 */
export function looksLikeInvertedIndex(abstract: string): boolean {
  if (/^\s*\{[\s\S]*"\s*:\s*\[/u.test(abstract)) return true;
  if (/inverted[_\s]?index|indexlength/iu.test(abstract)) return true;
  const tokens = abstract.split(/\s+/u).filter((t) => t !== '');
  if (tokens.length < 10) return false;
  const numeric = tokens.filter((t) => /^\d+[,;\]]?$/u.test(t)).length;
  return numeric / tokens.length >= 0.5;
}

/** B.1, applied in order. Every drop is counted; nothing disappears silently. */
export function applyExclusions(
  candidates: readonly EnrichedCandidate[],
  options: ExclusionOptions,
): ExclusionOutcome {
  const survivors: EnrichedCandidate[] = [];
  const excluded: Exclusion[] = [];
  const counts = emptyExclusionCounts();

  for (const candidate of candidates) {
    const verdict = excludeOne(candidate, options);
    if (verdict === null) {
      survivors.push(candidate);
      continue;
    }
    excluded.push({ candidate, ...verdict });
    counts[verdict.reason]++;
  }

  return { survivors, excluded, counts };
}

function excludeOne(
  candidate: EnrichedCandidate,
  options: ExclusionOptions,
): { reason: ExclusionReason; detail: string } | null {
  const abstract = normaliseWhitespace(candidate.abstract ?? '');
  const tldr = normaliseWhitespace(candidate.tldr ?? '');

  // 1 — retracted. The adapter also asks OpenAlex to filter these server-side;
  // this is the braces, because a source that does not support the flag (arXiv)
  // would otherwise let one through unchallenged.
  const type = candidate.sourceType?.trim().toLowerCase() ?? null;
  if (candidate.isRetracted === true || type === 'retraction' || RETRACTED_TITLE.test(candidate.title)) {
    return { reason: 'EXCL_RETRACTED', detail: 'retracted work' };
  }

  // 2 — nothing to summarise from. §4.2's TLDR is the accepted substitute, so
  // this rule can only fire when both are missing. The ordering matters: this
  // check must run *after* Semantic Scholar enrichment, or a paywalled abstract
  // with a perfectly good TLDR is dropped for no reason.
  if (options.deferAbstractRules !== true && abstract === '' && tldr === '') {
    return { reason: 'EXCL_NO_ABSTRACT', detail: 'no abstract and no TLDR' };
  }

  // 3 — too thin to carry §7.3's 150–250 word explanation.
  if (options.deferAbstractRules !== true && abstract.length < options.minAbstractChars && tldr === '') {
    return {
      reason: 'EXCL_ABSTRACT_TOO_THIN',
      detail: `abstract is ${String(abstract.length)} chars (minimum ${String(options.minAbstractChars)}) and there is no TLDR`,
    };
  }

  // 4 — outside the seven-day window of §3. Inclusive at the boundary: a paper
  // from exactly D−7 is still "the last 7 days".
  const age = ageInDays(candidate, options.today);
  if (age === null) {
    return { reason: 'EXCL_STALE', detail: 'no readable publication or index date' };
  }
  if (age > options.freshnessDays) {
    return {
      reason: 'EXCL_STALE',
      detail: `${String(age)} days old (window is ${String(options.freshnessDays)})`,
    };
  }

  // 5 and 6 — §8's dedup state. The lookup, its 180-day window and the file
  // itself belong to `src/state/seen.ts`.
  const seen = options.isSeen(candidate);
  if (seen === 'title') {
    return { reason: 'EXCL_SEEN_TITLE', detail: 'title already published within the dedup window' };
  }
  if (seen !== null) {
    return { reason: 'EXCL_SEEN', detail: `already published within the dedup window (${seen})` };
  }

  // 7 — record classes that are not a research paper.
  if (type !== null && EXCLUDED_WORK_TYPES.has(type)) {
    return { reason: 'EXCL_TYPE', detail: `work type "${type}"` };
  }

  // 8 — the same thing said by the title, for sources that report no type.
  if (NON_ARTICLE_TITLE.test(candidate.title)) {
    return { reason: 'EXCL_TYPE', detail: 'title announces a correction, comment or reply' };
  }

  // 9 — an abstract that is a failed inverted-index reconstruction.
  if (abstract !== '' && looksLikeInvertedIndex(abstract)) {
    return { reason: 'EXCL_NO_ABSTRACT', detail: 'abstract is an unreconstructed inverted index' };
  }

  return null;
}

/** One log-line rendering of the counts (D.7). Zero-count reasons are omitted. */
export function formatExclusionCounts(counts: ExclusionCounts): string {
  const parts = EXCLUSION_REASONS.filter((reason) => counts[reason] > 0).map(
    (reason) => `${reason}=${String(counts[reason])}`,
  );
  return parts.length === 0 ? 'no exclusions' : parts.join(' ');
}
