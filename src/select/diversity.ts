/**
 * §6's diversity constraint — DESIGN-NOTES B.8 (greedy selection) and B.10
 * (the subfield key).
 *
 * "The five must not all be from the same subfield. Max two papers per subfield
 * per day." §6 states that as a rule, not a preference, and §5 explains why:
 * the whole point of the weekday rotation is that the archive "covers science
 * broadly rather than drifting into AI-only". A day that cannot fill five slots
 * under the cap therefore publishes fewer and says so (§3, §9) — it does not
 * quietly raise the cap.
 *
 * The relax pass B.8 describes is kept, behind `ranking.relaxDiversityToReachTarget`
 * (shipped **false**). §9 requires degradation to be *visible*; a run that
 * relaxes the cap sets `diversityRelaxed`, which reaches the page footer.
 */
import type { Candidate, ScoredCandidate } from '../types.js';

/** The two ways a run can fall short of its own rules, both footer-visible (§9). */
export interface SelectionFlags {
  /** B.8 step 5 — the per-subfield cap was raised to fill the day. */
  diversityRelaxed: boolean;
  /** B.8 step 7 — a paper below the 0.35 explainability gate was admitted to reach the minimum. */
  explainGateWaived: boolean;
}

/**
 * B.10's fallback chain, resolved against the §10 candidate contract.
 *
 * 1. `subfield.id` — OpenAlex `primary_topic.subfield.id`, what the adapter
 *    stores. This is B.10 steps 1 and 3, which differ only in which topic of a
 *    multi-topic work is consulted; the contract keeps one topic, so they merge.
 * 2. `field.id` — B.10 step 2, one level coarser.
 * 3. B.10 step 4 (`"arxiv:" + arxivPrimaryCategory`) needs no code here: the
 *    arXiv adapter already writes the primary category into `subfield` as
 *    `arxiv:cs.LG`, so it arrives through step 1 already namespaced.
 * 4. `unknown:<id>` — B.10 step 5, and the deliberate part. An unknown subfield
 *    must be **unique**, never a shared "unknown" bucket: two unrelated papers
 *    whose topics OpenAlex has not classified would otherwise compete for one
 *    slot and the day would lose a paper for no reason.
 */
export function subfieldKey(candidate: Candidate): string {
  const subfield = candidate.subfield?.id;
  if (subfield != null && subfield.trim() !== '') return subfield;
  const field = candidate.field?.id;
  if (field != null && field.trim() !== '') return field;
  return `unknown:${candidate.id}`;
}

export interface DiversityOptions {
  /** How many papers the day wants — `config.output.papersPerDay`. */
  readonly limit: number;
  /** `config.ranking.maxPerSubfield`. Hard unless the relax flag is set. */
  readonly maxPerSubfield: number;
  /** `config.ranking.relaxDiversityToReachTarget`. */
  readonly relaxToReachTarget: boolean;
  /** `config.ranking.relaxedMaxPerSubfield`. The cap never goes above this. */
  readonly relaxedMaxPerSubfield: number;
}

export interface DiversityOutcome {
  /** Chosen papers, in the order they were taken (i.e. by rank). */
  readonly selected: ScoredCandidate[];
  /** True when the relax pass ran *and* actually admitted a paper. */
  readonly diversityRelaxed: boolean;
}

/**
 * B.8 step 4: walk the ranked list once, taking any paper whose subfield still
 * has room. Greedy is correct here rather than merely convenient — the list is
 * already in §6 order, so the first paper of a subfield is by construction the
 * best one, and the cap drops the *lowest*-ranked surplus.
 */
function fill(
  pool: readonly ScoredCandidate[],
  selected: ScoredCandidate[],
  counts: Map<string, number>,
  limit: number,
  cap: number,
): void {
  for (const paper of pool) {
    if (selected.length >= limit) return;
    if (selected.includes(paper)) continue;
    const key = paper.score.subfieldKey;
    const used = counts.get(key) ?? 0;
    if (used >= cap) continue;
    selected.push(paper);
    counts.set(key, used + 1);
  }
}

/**
 * B.8 steps 4–5. `eligible` must already be sorted into §6 rank order.
 *
 * The relax pass resumes from the papers the first pass rejected, keeping the
 * papers it already took — B.8 says "repeat step 4 over the remaining eligible
 * papers", not "start again", and restarting could swap out an
 * already-selected paper for a worse one from a subfield that now has room.
 */
export function selectWithDiversity(
  eligible: readonly ScoredCandidate[],
  options: DiversityOptions,
): DiversityOutcome {
  const selected: ScoredCandidate[] = [];
  const counts = new Map<string, number>();

  fill(eligible, selected, counts, options.limit, options.maxPerSubfield);

  if (selected.length >= options.limit || !options.relaxToReachTarget) {
    return { selected, diversityRelaxed: false };
  }

  const before = selected.length;
  // "The cap never goes above `relaxedMaxPerSubfield`" — five papers from one
  // subfield would break §5's whole purpose, so the relaxed value is a ceiling
  // and not an increment.
  fill(
    eligible,
    selected,
    counts,
    options.limit,
    Math.max(options.maxPerSubfield, options.relaxedMaxPerSubfield),
  );

  // Only report the degradation if it actually bought something. A relax pass
  // that admitted nobody is not a degradation the reader needs told about.
  return { selected, diversityRelaxed: selected.length > before };
}

/**
 * Papers from `pool` that can join `alreadySelected` without breaking `cap`,
 * up to `limit` in total. Returns only the newcomers.
 *
 * B.8 step 7's ungated top-up needs this: it admits papers the explainability
 * gate rejected, but §6's diversity cap is not what it is waiving, so the cap
 * still applies. That is also QA's reading in RISK-SELECT-07 — diversity is a
 * hard constraint, papers-per-day is a target.
 */
export function admitWithinCap(
  pool: readonly ScoredCandidate[],
  alreadySelected: readonly ScoredCandidate[],
  limit: number,
  cap: number,
): ScoredCandidate[] {
  const selected = [...alreadySelected];
  const counts = countBySubfield(alreadySelected);
  const before = selected.length;
  fill(pool, selected, counts, limit, cap);
  return selected.slice(before);
}

/** How many papers of each subfield a selection holds. For the run log and tests. */
export function countBySubfield(papers: readonly ScoredCandidate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    const key = paper.score.subfieldKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
