/**
 * §6 end to end — DESIGN-NOTES B.8 (the selection algorithm) and B.9 (tie-breaks).
 *
 * `selectForDay` is the whole of §11 step 6: "scoring, diversity constraint,
 * dedup against seen.json. Check: returns exactly 5, max 2 per subfield, none
 * present in seen.json."
 *
 * It is a pure function. The run date arrives as `today`, the dedup state
 * arrives as a lookup function, and the weights arrive from config — so the
 * same fixture produces the same page in every process, which is what §11 step
 * 10's two-consecutive-runs check ultimately rests on.
 *
 * It also never pads. §3 is explicit: a run that cannot produce five "publishes
 * with however many it found (minimum 3) and notes the shortfall — it does not
 * pad with older or off-category papers". So there is no branch here that
 * reaches back past an exclusion; a short day is reported short.
 */
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import type { EnrichedCandidate, ScoredCandidate } from '../types.js';
import { admitWithinCap, selectWithDiversity, type SelectionFlags } from './diversity.js';
import {
  applyExclusions,
  emptyExclusionCounts,
  type Exclusion,
  type ExclusionCounts,
  type SeenLookup,
} from './exclude.js';
import {
  effectiveDate,
  openAccessScore,
  passesExplainabilityGate,
  scoreCandidate,
  type RankingWeights,
} from './score.js';

export type { SeenLookup, SeenMatchKind } from './exclude.js';
export type { SelectionFlags } from './diversity.js';

/**
 * B.9: "Two candidates are tied if |scoreA − scoreB| < 0.005."
 *
 * Implemented as a quantisation band rather than as a pairwise epsilon, and the
 * difference is load-bearing. Pairwise epsilon equality is not transitive —
 * 0.700 ties 0.704 ties 0.708, but 0.700 does not tie 0.708 — and a comparator
 * built on it is not a strict weak ordering, so `Array.prototype.sort` may
 * return different orders for different input permutations. That would defeat
 * B.9 rule 5, whose entire stated purpose is that "two runs over the same data
 * produce the same page". Flooring both scores into 0.005-wide bands is
 * transitive, agrees with B.9 for all but the pairs that straddle a band edge,
 * and is provably permutation-invariant when combined with the unique final
 * tie-break below.
 */
const TIE_BAND = 0.005;

export interface SelectOptions {
  /** Run date, `YYYY-MM-DD`, in the configured timezone. */
  readonly today: string;
  /** `config.ranking.weights` — §6's magnitudes, never hardcoded here. */
  readonly weights: RankingWeights;
  /** `config.output.papersPerDay`. */
  readonly papersPerDay: number;
  /** `config.output.minPapersToPublish`. Independent of `papersPerDay` (§9). */
  readonly minPapersToPublish: number;
  /** `config.ranking.maxPerSubfield`. */
  readonly maxPerSubfield: number;
  /** `config.ranking.relaxDiversityToReachTarget`. */
  readonly relaxDiversityToReachTarget: boolean;
  /** `config.ranking.relaxedMaxPerSubfield`. */
  readonly relaxedMaxPerSubfield: number;
  /** `config.windows.freshnessDays`. */
  readonly freshnessDays: number;
  /** `config.ranking.minAbstractChars`. */
  readonly minAbstractChars: number;
  /** Injected §8 dedup state. Owned by `src/state/seen.ts`. */
  readonly isSeen: SeenLookup;
}

/**
 * Every knob `selectForDay` needs, read from `config.json` in one place.
 *
 * The selector takes plain values rather than the `Config` object so that it
 * stays a pure function of data — but the mapping lives here, next to the
 * options it fills, so that a reader can check in one glance that no weight,
 * window or cap was invented in code (§8).
 */
export function optionsFromConfig(
  config: Config,
  today: string,
  isSeen: SeenLookup,
): SelectOptions {
  return {
    today,
    weights: config.ranking.weights,
    papersPerDay: config.output.papersPerDay,
    minPapersToPublish: config.output.minPapersToPublish,
    maxPerSubfield: config.ranking.maxPerSubfield,
    relaxDiversityToReachTarget: config.ranking.relaxDiversityToReachTarget,
    relaxedMaxPerSubfield: config.ranking.relaxedMaxPerSubfield,
    freshnessDays: config.windows.freshnessDays,
    minAbstractChars: config.ranking.minAbstractChars,
    isSeen,
  };
}

/** Why a day produced fewer than `papersPerDay`. Goes into the run log (§9). */
export type ShortfallReason =
  | 'none'
  /** Not enough candidates survived §6's exclusions and gate. */
  | 'candidate-shortage'
  /** Enough eligible papers existed, but the per-subfield cap held them back. */
  | 'diversity-cap';

export interface SelectionResult {
  /** The day's papers, in rank order. Never more than `papersPerDay`. */
  readonly selected: ScoredCandidate[];
  /** Every survivor, scored and ranked. `rank` in B.11 is the index in here. */
  readonly ranked: ScoredCandidate[];
  /**
   * `ranked` minus `selected`, still in rank order — the queue §7.4 draws from
   * when example verification drops a paper and the day needs a replacement.
   */
  readonly remainder: ScoredCandidate[];
  readonly exclusionCounts: ExclusionCounts;
  readonly excluded: Exclusion[];
  readonly flags: SelectionFlags;
  /** How many papers short of `papersPerDay` the day came, ≥ 0. */
  readonly shortfall: number;
  readonly shortfallReason: ShortfallReason;
  /**
   * True when the day has fewer than `minPapersToPublish`. §9: publish nothing,
   * write a failure line, leave yesterday's index intact. The decision is the
   * orchestrator's; this flag is the fact it decides on.
   */
  readonly belowMinimum: boolean;
  /** B.11 — identifies the weight set a score was produced under. */
  readonly weightsVersion: string;
}

/**
 * B.11's `weightsVersion`: "without it, comparing scores across archive days
 * after a weight change is meaningless."
 *
 * B.11's example shows a date (`"2026-08-19"`) while its prose calls it the
 * config hash; a date cannot tell two days apart that share a weight set, so
 * the prose wins. Hashed over every input that changes a score — the four
 * weights and the freshness window — and short, because it is read by a human
 * diffing two archive files.
 */
export function weightsVersion(weights: RankingWeights, freshnessDays: number): string {
  const canonical = JSON.stringify([
    weights.explainability,
    weights.everydayRelevance,
    weights.freshness,
    weights.credibility,
    freshnessDays,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/** B.9 rule 5's identifier: the OpenAlex ID, else the arXiv ID. */
function stableId(candidate: ScoredCandidate): string {
  const openAlex = candidate.openAlexId;
  if (openAlex != null && openAlex.trim() !== '') return openAlex;
  return candidate.id;
}

/**
 * B.9's tie-breaks, in order, after the band comparison. The chain ends on a
 * unique key, so the ordering is total: no two candidates can compare equal,
 * and therefore no two runs can order them differently.
 */
export function compareRanked(a: ScoredCandidate, b: ScoredCandidate): number {
  const bandA = Math.floor(a.score.total / TIE_BAND + 1e-9);
  const bandB = Math.floor(b.score.total / TIE_BAND + 1e-9);
  if (bandA !== bandB) return bandB - bandA;

  // 1 — higher explainability. §6 factor 1 breaks its own ties.
  if (a.score.explainability !== b.score.explainability) {
    return b.score.explainability - a.score.explainability;
  }
  // 2 — newer effective date. §6 factor 3: "newer wins ties".
  const dateA = effectiveDate(a) ?? '';
  const dateB = effectiveDate(b) ?? '';
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  // 3 — open access, so the reader can actually read it (§6 factor 4).
  const oaA = openAccessScore(a);
  const oaB = openAccessScore(b);
  if (oaA !== oaB) return oaB - oaA;
  // 4 — higher credibility.
  if (a.score.credibility !== b.score.credibility) return b.score.credibility - a.score.credibility;
  // 5 — determinism, and nothing else.
  const idA = stableId(a);
  const idB = stableId(b);
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/**
 * B.8 steps 1–7.
 *
 * @param candidates enriched candidates (§11 step 5 has already run — B.1 rules
 *                   2 and 3 accept a TLDR in place of an abstract, so running
 *                   this before enrichment would drop papers §6 wants kept).
 */
export function selectForDay(
  candidates: readonly EnrichedCandidate[],
  options: SelectOptions,
): SelectionResult {
  // 1 — hard exclusions.
  const { survivors, excluded, counts } = applyExclusions(candidates, {
    today: options.today,
    freshnessDays: options.freshnessDays,
    minAbstractChars: options.minAbstractChars,
    isSeen: options.isSeen,
  });

  // 2 — score every survivor and rank the whole list.
  const scoreOptions = {
    today: options.today,
    weights: options.weights,
    freshnessDays: options.freshnessDays,
  };
  const ranked: ScoredCandidate[] = survivors
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, scoreOptions) }))
    .sort(compareRanked);

  // 3 — B.2's gate. An unexplainable paper stays in `ranked` (it may still be
  // needed at step 7) but cannot win a slot on the strength of the other three
  // factors, which outweigh explainability 0.60 to 0.40 if left unchecked.
  const eligible = ranked.filter(passesExplainabilityGate);
  const ungated = ranked.filter((paper) => !passesExplainabilityGate(paper));

  // 4 and 5 — greedy fill under the diversity cap, then the opt-in relax pass.
  const diversity = selectWithDiversity(eligible, {
    limit: options.papersPerDay,
    maxPerSubfield: options.maxPerSubfield,
    relaxToReachTarget: options.relaxDiversityToReachTarget,
    relaxedMaxPerSubfield: options.relaxedMaxPerSubfield,
  });
  const selected = diversity.selected;
  const flags: SelectionFlags = {
    diversityRelaxed: diversity.diversityRelaxed,
    explainGateWaived: false,
  };

  // 6 — still short of the target: that is a shortfall, not a licence to relax
  // further or to admit an ungated paper. §9's path, and §3's promise that the
  // page says so.

  // 7 — below the publishable minimum, and only then, the gate is waived far
  // enough to reach it. The cap is not waived with it.
  const capInForce = options.relaxDiversityToReachTarget
    ? Math.max(options.maxPerSubfield, options.relaxedMaxPerSubfield)
    : options.maxPerSubfield;
  if (selected.length < options.minPapersToPublish && ungated.length > 0) {
    const admitted = admitWithinCap(ungated, selected, options.minPapersToPublish, capInForce);
    if (admitted.length > 0) {
      selected.push(...admitted);
      flags.explainGateWaived = true;
    }
  }

  // Returned in rank order: `selected` was built greedily, so a paper admitted
  // by the relax pass or by step 7 would otherwise sit out of order on the page.
  selected.sort(compareRanked);

  const chosen = new Set(selected);
  const shortfall = Math.max(0, options.papersPerDay - selected.length);

  return {
    selected,
    ranked,
    remainder: ranked.filter((paper) => !chosen.has(paper)),
    exclusionCounts: counts,
    excluded,
    flags,
    shortfall,
    shortfallReason: shortfallReasonFor(shortfall, eligible.length, selected.length),
    belowMinimum: selected.length < options.minPapersToPublish,
    weightsVersion: weightsVersion(options.weights, options.freshnessDays),
  };
}

/**
 * RISK-SELECT-07 asks the log to distinguish these two: a day with plenty of
 * eligible papers that could only place four of them was constrained by §6's
 * diversity rule, and reporting that as "not enough candidates" would send
 * whoever reads the log looking at the adapters instead of the cap.
 */
function shortfallReasonFor(
  shortfall: number,
  eligibleCount: number,
  selectedCount: number,
): ShortfallReason {
  if (shortfall === 0) return 'none';
  return eligibleCount > selectedCount ? 'diversity-cap' : 'candidate-shortage';
}

/** The `ranking` block B.11 writes into `archive/YYYY-MM-DD.json` for one paper. */
export interface RankingRecord {
  readonly score: number;
  readonly factors: {
    readonly explainability: number;
    readonly everydayRelevance: number;
    readonly freshness: number;
    readonly credibility: number;
  };
  readonly explainDetail: ScoredCandidate['score']['explainDetail'];
  readonly everydayDomains: string[];
  readonly subfieldKey: string;
  readonly rank: number;
  readonly diversityRelaxed: boolean;
  readonly weightsVersion: string;
}

/** B.11 — the JSON twin's view of one selected paper's ranking. */
export function rankingRecord(
  paper: ScoredCandidate,
  result: SelectionResult,
): RankingRecord {
  return {
    score: paper.score.total,
    factors: {
      explainability: paper.score.explainability,
      everydayRelevance: paper.score.everydayRelevance,
      freshness: paper.score.freshness,
      credibility: paper.score.credibility,
    },
    explainDetail: paper.score.explainDetail,
    everydayDomains: paper.score.everydayDomains,
    subfieldKey: paper.score.subfieldKey,
    // 1-based: it is read by a human next to a page that says "paper 2 of 5".
    rank: result.ranked.indexOf(paper) + 1,
    diversityRelaxed: result.flags.diversityRelaxed,
    weightsVersion: result.weightsVersion,
  };
}

/** An empty result, for a run whose discovery step returned nothing (§9). */
export function emptySelection(options: SelectOptions): SelectionResult {
  return {
    selected: [],
    ranked: [],
    remainder: [],
    exclusionCounts: emptyExclusionCounts(),
    excluded: [],
    flags: { diversityRelaxed: false, explainGateWaived: false },
    shortfall: options.papersPerDay,
    shortfallReason: 'candidate-shortage',
    belowMinimum: true,
    weightsVersion: weightsVersion(options.weights, options.freshnessDays),
  };
}
