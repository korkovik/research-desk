/**
 * The four ranking factors of §6 — DESIGN-NOTES B.2 through B.6.
 *
 * §6 fixes the *ordering* of importance (explainability > everyday relevance >
 * freshness > credibility) and leaves the magnitudes to the build. The
 * magnitudes therefore live in `config.ranking.weights` and arrive here as an
 * argument: nothing in this file may hardcode a weight, or `config.json`'s
 * promise that "nothing a future change would touch is hardcoded" (§8) becomes
 * false for the one layer most likely to be tuned.
 *
 * Every function here is pure. The run date arrives as `today`; there is no
 * `new Date()` anywhere in this module, because two runs over the same fixture
 * must produce the same page (§11 step 10, B.9 rule 5).
 *
 * ---------------------------------------------------------------------------
 * Where DESIGN-NOTES B was ambiguous, and what this file does about it
 * ---------------------------------------------------------------------------
 *
 * 1. **Title doubling and the `t` penalty.** B.3's preamble says "hits in the
 *    title count double"; its worked example only exercises the positive `v`
 *    and `s` counts. The doubling is applied to `t` as well, for the same
 *    reason it applies to `v`: a title that announces "We propose a framework"
 *    is stronger evidence of a methods paper than the same phrase buried on
 *    line 9 of an abstract.
 *
 * 2. **B.4's "title (×2)".** Everyday relevance counts *distinct* domains and
 *    *distinct* terms, so repeating the title in the search corpus provably
 *    cannot change either number. The corpus is built once; the ×2 is recorded
 *    here as inert rather than implemented as a no-op that a reader would have
 *    to work out for themselves.
 *
 * 3. **B.6 needs OpenAlex fields the §10 candidate contract does not carry** —
 *    `primary_location.source.issn`, `open_access.oa_status`,
 *    `source.summary_stats["2yr_mean_citedness"]`. Each fallback is documented
 *    at the factor it affects. `c4` is the honest casualty: with no venue
 *    citedness in the contract it is B.6's own "field is missing" constant.
 */
import type { EnrichedCandidate, ExplainDetail, ScoreBreakdown } from '../types.js';
import { daysBetween, isISODate } from '../util/dates.js';
import {
  EVERYDAY_DOMAIN_CAP,
  EVERYDAY_DOMAINS,
  EVERYDAY_TERM_CAP,
  JARGON_SATURATION_SHARE,
  JARGON_TOKEN_MIN_CHARS,
  matchTerms,
  OUTCOME_VERBS,
  QUANTIFIED_EFFECT_PATTERNS,
  SUBJECT_NOUNS,
  THEORETICAL_MARKERS,
  TITLE_LONG_TOKEN_MIN_CHARS,
  TITLE_LONG_TOKEN_MIN_COUNT,
  TITLE_MAX_WORDS,
  TITLE_METHOD_SUBTITLE,
  weightedHitCount,
  type TermHit,
} from './lexicons.js';
import { subfieldKey } from './diversity.js';

/**
 * B.2's gate. A weighted sum alone cannot keep an unexplainable paper out of
 * the top five, because the other three factors sum to 0.60 against
 * explainability's 0.40. Without this constant, "explainability highest"
 * (§6 factor 1) would be a statement about a number rather than about which
 * papers can win.
 */
export const EXPLAINABILITY_GATE = 0.35;

/** The §6 factor weights. Structurally identical to `Config['ranking']['weights']`. */
export interface RankingWeights {
  readonly explainability: number;
  readonly everydayRelevance: number;
  readonly freshness: number;
  readonly credibility: number;
}

export interface ScoreOptions {
  /** Run date, `YYYY-MM-DD`. Injected — this module never reads a clock. */
  readonly today: string;
  /** From `config.ranking.weights`. */
  readonly weights: RankingWeights;
  /** From `config.windows.freshnessDays`. */
  readonly freshnessDays: number;
}

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Collapses every run of whitespace, including the newlines arXiv wraps at. */
export function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

interface SourceText {
  /** Title, lower-cased. */
  readonly title: string;
  /** Abstract + TLDR, lower-cased — B.3's `T` minus the title. */
  readonly body: string;
  /** Abstract only, original case, for the numeric extractions of B.3.1 q and B.6 c2. */
  readonly rawAbstract: string;
  /** Title, original case, for the word/token measurements of B.3.1 c. */
  readonly rawTitle: string;
}

function sourceText(candidate: EnrichedCandidate): SourceText {
  const rawTitle = normaliseWhitespace(candidate.title);
  const rawAbstract = normaliseWhitespace(candidate.abstract ?? '');
  const tldr = normaliseWhitespace(candidate.tldr ?? '');
  return {
    title: rawTitle.toLowerCase(),
    // B.3: `T` = title + ". " + abstract + ". " + tldr. The title is matched
    // separately (it scores double), so it is not repeated here.
    body: `${rawAbstract}. ${tldr}`.toLowerCase(),
    rawAbstract,
    rawTitle,
  };
}

/**
 * Word-ish tokens for the jargon-density measure. Keeps the internal `+`, `.`
 * and digits that make `CD8+`, `PM2.5` and `Li6PS5Cl` the thing B.3.2 is
 * pointing at; drops the sentence punctuation that would inflate every length.
 */
function tokens(text: string): string[] {
  const matched = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’+._-]*/gu) ?? [];
  const cleaned: string[] = [];
  for (const token of matched) {
    const trimmed = token.replace(/[.'’_-]+$/u, '');
    if (trimmed !== '') cleaned.push(trimmed);
  }
  return cleaned;
}

function isJargonToken(token: string): boolean {
  if (token.length >= JARGON_TOKEN_MIN_CHARS) return true;
  return /\p{L}/u.test(token) && /\p{N}/u.test(token);
}

// ---------------------------------------------------------------------------
// B.5's date rule — shared with B.1 rule 4
// ---------------------------------------------------------------------------

/**
 * B.5: `max(publication_date, first_index_date)`.
 *
 * A journal's `publication_date` is often the issue date, months behind the day
 * the paper actually appeared; OpenAlex's `created_date` is when it first saw
 * the record. Taking the later of the two is what stops a genuinely new paper
 * being scored as three months stale.
 *
 * B.5 further asks for arXiv `v2+` revisions to count as the newer date. The
 * §10 candidate contract carries no version field — `arxivIdFromUrl` strips
 * `vN` precisely so that v1 and v3 dedup as one paper — so that refinement is
 * not representable here and is noted rather than approximated.
 */
export function effectiveDate(candidate: EnrichedCandidate): string | null {
  const published = isISODate(candidate.date) ? candidate.date : null;
  const indexed =
    candidate.indexedDate != null && isISODate(candidate.indexedDate) ? candidate.indexedDate : null;
  if (published === null) return indexed;
  if (indexed === null) return published;
  // ISO dates compare correctly as strings.
  return indexed > published ? indexed : published;
}

/**
 * Whole days between the candidate's effective date and the run date, never
 * negative (B.5 says "≥ 0"): a paper with an embargo date two days in the
 * future is as fresh as one published this morning, not fresher.
 *
 * `null` when no readable date exists. The caller treats that as stale — a
 * paper whose age cannot be established cannot be claimed to be from this week.
 */
export function ageInDays(candidate: EnrichedCandidate, today: string): number | null {
  const effective = effectiveDate(candidate);
  if (effective === null || !isISODate(today)) return null;
  return Math.max(0, daysBetween(effective, today));
}

// ---------------------------------------------------------------------------
// B.3 — explainability
// ---------------------------------------------------------------------------

export interface FactorResult {
  readonly value: number;
  readonly evidence: readonly string[];
}

export interface ExplainabilityResult extends FactorResult {
  readonly detail: ExplainDetail;
}

/**
 * B.3 — can this finding be stated in one plain sentence with a concrete
 * consequence? Answered lexically, with no model call: the pipeline must be
 * reproducible offline, and B.3.3 records that an LLM triage pass is the
 * highest-value future upgrade rather than something to fake with a lexicon.
 */
export function explainabilityOf(candidate: EnrichedCandidate): ExplainabilityResult {
  const text = sourceText(candidate);
  const evidence: string[] = [];

  const verbHits = matchTerms(OUTCOME_VERBS, text.title, text.body);
  const nounHits = matchTerms(SUBJECT_NOUNS, text.title, text.body);
  const theoryHits = matchTerms(THEORETICAL_MARKERS, text.title, text.body);

  const v = Math.min(weightedHitCount(verbHits), 4) / 4;
  const s = Math.min(weightedHitCount(nounHits), 4) / 4;

  // (q) B.3.1 — a quantified effect. Run against the abstract in its original
  // case: `OR = 1.8` and the word "or" are indistinguishable once lower-cased.
  const quantified = QUANTIFIED_EFFECT_PATTERNS.filter((p) => p.pattern.test(text.rawAbstract));
  const q = quantified.length > 0 ? 1 : 0;

  // (c) B.3.1 — title concreteness.
  const titleWords = text.rawTitle === '' ? 0 : text.rawTitle.split(/\s+/u).length;
  const longTitleTokens = tokens(text.rawTitle).filter(
    (t) => t.length >= TITLE_LONG_TOKEN_MIN_CHARS,
  );
  const titlePenalties: string[] = [];
  let c = 1;
  if (TITLE_METHOD_SUBTITLE.test(text.title)) {
    c -= 0.4;
    titlePenalties.push('−0.4 method-word subtitle');
  }
  if (!verbHits.some((h) => h.inTitle) && !nounHits.some((h) => h.inTitle)) {
    c -= 0.3;
    titlePenalties.push('−0.3 no outcome verb or recognisable subject in the title');
  }
  if (titleWords > TITLE_MAX_WORDS) {
    c -= 0.2;
    titlePenalties.push(`−0.2 title is ${String(titleWords)} words`);
  }
  if (longTitleTokens.length >= TITLE_LONG_TOKEN_MIN_COUNT) {
    c -= 0.2;
    titlePenalties.push(`−0.2 ${String(longTitleTokens.length)} technical strings in the title`);
  }
  c = clamp01(c);

  const p = 0.35 * v + 0.25 * s + 0.2 * q + 0.2 * c;

  // (t) B.3.2 — methods-about-methods markers.
  const t = Math.min(weightedHitCount(theoryHits), 3) / 3;

  // (j) B.3.2 — jargon density over the abstract's tokens.
  const abstractTokens = tokens(text.rawAbstract);
  const jargonTokens = abstractTokens.filter(isJargonToken);
  const jargonShare = abstractTokens.length === 0 ? 0 : jargonTokens.length / abstractTokens.length;
  const j = clamp01(jargonShare / JARGON_SATURATION_SHARE);

  const value = clamp01(p - 0.45 * t - 0.15 * j);

  evidence.push(
    `explainability ${value.toFixed(2)} = P ${p.toFixed(2)} − 0.45×t ${t.toFixed(2)} − 0.15×j ${j.toFixed(2)}`,
  );
  evidence.push(
    verbHits.length > 0
      ? `outcome verbs (v ${v.toFixed(2)}): ${describeHits(verbHits)}`
      : 'outcome verbs (v 0.00): none',
  );
  evidence.push(
    nounHits.length > 0
      ? `recognisable subjects (s ${s.toFixed(2)}): ${describeHits(nounHits)}`
      : 'recognisable subjects (s 0.00): none',
  );
  evidence.push(
    q === 1
      ? `quantified effect (q 1): ${quantified.map((entry) => entry.label).join(', ')}`
      : 'quantified effect (q 0): the abstract states no number',
  );
  evidence.push(
    titlePenalties.length > 0
      ? `title concreteness (c ${c.toFixed(2)}): ${titlePenalties.join('; ')}`
      : `title concreteness (c ${c.toFixed(2)}): no penalty`,
  );
  if (theoryHits.length > 0) {
    evidence.push(`theoretical markers (t ${t.toFixed(2)}): ${describeHits(theoryHits)}`);
  }
  if (j > 0) {
    evidence.push(
      `jargon density (j ${j.toFixed(2)}): ${String(jargonTokens.length)}/${String(abstractTokens.length)} abstract tokens are long or alphanumeric`,
    );
  }

  return {
    value,
    detail: { v: round(v, 4), s: round(s, 4), q, c: round(c, 4), t: round(t, 4), j: round(j, 4) },
    evidence,
  };
}

function describeHits(hits: readonly TermHit[]): string {
  return hits.map((h) => (h.inTitle ? `${h.term} (title, ×2)` : h.term)).join(', ');
}

/**
 * B.2's eligibility gate, as its own predicate rather than an inline `>=`.
 *
 * It is exported because it is a *rule*, not an implementation detail: §9's
 * shortfall path, the run log and the footer note all need to say "this paper
 * was ranked but not eligible", and they must all mean the same thing by it.
 */
export function passesExplainabilityGate(paper: { readonly score: ScoreBreakdown }): boolean {
  return paper.score.explainability >= EXPLAINABILITY_GATE;
}

// ---------------------------------------------------------------------------
// B.4 — everyday relevance
// ---------------------------------------------------------------------------

export interface EverydayResult extends FactorResult {
  readonly domains: string[];
}

/**
 * §6 factor 2 — "does it touch something the reader recognises".
 *
 * B.4 writes the corpus as "title (×2) + abstract + tldr". Both outputs — the
 * number of distinct domains and the number of distinct terms — are set
 * membership counts, so repeating the title cannot move either. The corpus is
 * built once and the ×2 is deliberately not implemented; see the module header.
 */
export function everydayRelevanceOf(candidate: EnrichedCandidate): EverydayResult {
  const text = sourceText(candidate);
  const domains: string[] = [];
  const terms: string[] = [];

  for (const domain of EVERYDAY_DOMAINS) {
    const hits = matchTerms(domain.terms, text.title, text.body);
    if (hits.length === 0) continue;
    // B.4: each domain counts at most once, however many of its terms hit —
    // otherwise one repeated word would dominate the factor.
    domains.push(domain.key);
    for (const hit of hits) terms.push(hit.term);
  }

  const d = Math.min(domains.length, EVERYDAY_DOMAIN_CAP) / EVERYDAY_DOMAIN_CAP;
  const h = Math.min(terms.length, EVERYDAY_TERM_CAP) / EVERYDAY_TERM_CAP;
  const value = clamp01(0.8 * d + 0.2 * h);

  const evidence =
    domains.length === 0
      ? ['everyday relevance 0.00: touches none of the 16 everyday domains']
      : [
          `everyday relevance ${value.toFixed(2)}: ${String(domains.length)} domain(s) — ${domains.join(', ')}`,
          `everyday terms (${String(terms.length)}): ${terms.slice(0, 12).join(', ')}${terms.length > 12 ? ', …' : ''}`,
        ];

  return { value, domains, evidence };
}

// ---------------------------------------------------------------------------
// B.5 — freshness
// ---------------------------------------------------------------------------

/**
 * `(window − ageDays) / window`, clamped. B.5 writes the window as a literal 7;
 * it is read from `config.windows.freshnessDays` instead, because §3 states the
 * seven-day window once and both the query and this factor must move together
 * if it is ever changed.
 */
export function freshnessOf(
  candidate: EnrichedCandidate,
  today: string,
  freshnessDays: number,
): FactorResult {
  const age = ageInDays(candidate, today);
  if (age === null) {
    return { value: 0, evidence: ['freshness 0.00: no readable publication or index date'] };
  }
  const value = clamp01((freshnessDays - age) / freshnessDays);
  const effective = effectiveDate(candidate);
  return {
    value,
    evidence: [
      `freshness ${value.toFixed(2)}: ${String(age)} day(s) old (effective date ${effective ?? 'unknown'})`,
    ],
  };
}

// ---------------------------------------------------------------------------
// B.6 — credibility
// ---------------------------------------------------------------------------

/** OpenAlex work types that are preprints wherever they are hosted (B.6 c1). */
const PREPRINT_TYPES = new Set(['preprint', 'submitted-version']);

/**
 * B.6 c1 — peer review.
 *
 * B.6 keys this on `type == "article" AND primary_location.source has an ISSN
 * AND source.type != "repository"`. The §10 contract carries no ISSN and no
 * source type, so the test becomes: not a preprint, and a named venue. That is
 * the same question asked with the fields we have — a work with a journal name
 * and no preprint flag is an article in a serial — and it degrades the right
 * way, to 0.6 ("conference proceedings, book chapter") rather than to 1.0, when
 * the venue is unknown.
 */
export function peerReviewScore(candidate: EnrichedCandidate): number {
  const type = candidate.sourceType?.toLowerCase() ?? null;
  if (candidate.isPreprint === true || (type !== null && PREPRINT_TYPES.has(type))) return 0.4;
  const hasVenue = (candidate.venue ?? '').trim() !== '';
  if (hasVenue && (type === null || type === 'article')) return 1;
  return 0.6;
}

/** B.6 c2's `n` extraction, in the two forms abstracts actually use. */
const SAMPLE_SIZE_PATTERNS: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])n\s?=\s?([\d ,]{2,9})/giu,
  /(?<![\p{L}\p{N}])(\d[\d ,]{1,8})\s+(?:participants|patients|subjects|respondents|individuals|adults|children|households|samples|animals|mice|records)(?!\p{L})/giu,
];

/**
 * The largest `n` stated anywhere in the abstract, or `null`.
 *
 * B.6 says "take the LARGEST match": abstracts quote sub-group sizes alongside
 * the total, and the total is the one that says how much the study can support.
 */
export function extractSampleSize(abstract: string): number | null {
  let largest: number | null = null;
  for (const pattern of SAMPLE_SIZE_PATTERNS) {
    for (const match of abstract.matchAll(pattern)) {
      const digits = (match[1] ?? '').replace(/[^\d]/gu, '');
      if (digits === '') continue;
      const value = Number.parseInt(digits, 10);
      if (!Number.isFinite(value) || value <= 0) continue;
      if (largest === null || value > largest) largest = value;
    }
  }
  return largest;
}

/**
 * B.6 c3 — open access, weighted heavily on purpose: §6.4 wants the reader to
 * be able to *follow the link and read the paper*, which is a reader-facing
 * property rather than a quality one.
 *
 * B.6 keys this on `open_access.oa_status`, which the §10 contract does not
 * carry. `isOpenAccess` + `licence` reconstruct the three bands it needs: a
 * Creative Commons licence is what gold, hybrid and diamond have in common;
 * open access without one is the green (repository) case, which is exactly what
 * an arXiv candidate is; no open access at all is closed or bronze.
 *
 * Exported because B.9's third tie-break is "open access (c3 higher)".
 */
export function openAccessScore(candidate: EnrichedCandidate): number {
  const licence = (candidate.licence ?? '').toLowerCase();
  const isOa = candidate.isOpenAccess === true;
  if (!isOa) return 0.3;
  return /^cc[-\s]?/u.test(licence) || licence.includes('public-domain') ? 1 : 0.8;
}

/**
 * B.6 c4 — venue signal, `2yr_mean_citedness / 5`.
 *
 * The §10 contract carries no venue citedness, so this is B.6's own
 * "field is missing" value for every candidate. It contributes a constant
 * 0.045 to every score and therefore changes no ordering; it is kept rather
 * than dropped so that adding the field later is a one-line change and so that
 * the credibility arithmetic in the archive still adds up to B.6's formula.
 */
const VENUE_SIGNAL_MISSING = 0.3;

export function credibilityOf(candidate: EnrichedCandidate): FactorResult {
  const c1 = peerReviewScore(candidate);
  const n = extractSampleSize(normaliseWhitespace(candidate.abstract ?? ''));
  const c2 = n === null ? 0.4 : clamp01(Math.log10(n) / 4);
  const c3 = openAccessScore(candidate);
  const c4 = VENUE_SIGNAL_MISSING;

  const value = clamp01(0.4 * c1 + 0.25 * c2 + 0.2 * c3 + 0.15 * c4);

  return {
    value,
    evidence: [
      `credibility ${value.toFixed(2)} = 0.40×c1 ${c1.toFixed(2)} + 0.25×c2 ${c2.toFixed(2)} + 0.20×c3 ${c3.toFixed(2)} + 0.15×c4 ${c4.toFixed(2)}`,
      `c1 ${c1.toFixed(2)}: ${describePeerReview(candidate, c1)}`,
      n === null
        ? 'c2 0.40: no sample size stated in the abstract'
        : `c2 ${c2.toFixed(2)}: n = ${String(n)}`,
      `c3 ${c3.toFixed(2)}: ${describeAccess(candidate, c3)}`,
      'c4 0.30: venue citedness is not part of the §10 candidate contract',
    ],
  };
}

function describePeerReview(candidate: EnrichedCandidate, c1: number): string {
  if (c1 === 0.4) return `preprint (${candidate.venue ?? 'unknown server'})`;
  if (c1 === 1) return `peer-reviewed article in ${candidate.venue ?? 'a named venue'}`;
  return 'neither a preprint nor an article in a named venue';
}

function describeAccess(candidate: EnrichedCandidate, c3: number): string {
  if (c3 === 1) return `open access under ${candidate.licence ?? 'an open licence'}`;
  if (c3 === 0.8) return 'open access without an open licence (repository copy)';
  return 'closed or bronze — the reader cannot follow the link and read it';
}

// ---------------------------------------------------------------------------
// B.2 — the weighted total
// ---------------------------------------------------------------------------

/**
 * The complete §6 score for one candidate.
 *
 * `evidence` is assembled here rather than in the caller because the run log
 * (D.7) and the JSON twin (B.11) both have to be able to answer "why was this
 * paper third?" without re-running the scorer.
 */
export function scoreCandidate(
  candidate: EnrichedCandidate,
  options: ScoreOptions,
): ScoreBreakdown {
  const explain = explainabilityOf(candidate);
  const everyday = everydayRelevanceOf(candidate);
  const fresh = freshnessOf(candidate, options.today, options.freshnessDays);
  const credible = credibilityOf(candidate);
  const w = options.weights;

  const total =
    w.explainability * explain.value +
    w.everydayRelevance * everyday.value +
    w.freshness * fresh.value +
    w.credibility * credible.value;

  const gate = explain.value >= EXPLAINABILITY_GATE;

  return {
    explainability: round(explain.value, 4),
    everydayRelevance: round(everyday.value, 4),
    freshness: round(fresh.value, 4),
    credibility: round(credible.value, 4),
    total: round(total, 4),
    explainDetail: explain.detail,
    everydayDomains: everyday.domains,
    subfieldKey: subfieldKey(candidate),
    evidence: [
      `total ${total.toFixed(4)} = ${w.explainability.toFixed(2)}×explainability + ${w.everydayRelevance.toFixed(2)}×everyday + ${w.freshness.toFixed(2)}×freshness + ${w.credibility.toFixed(2)}×credibility`,
      gate
        ? `passes the ${EXPLAINABILITY_GATE.toFixed(2)} explainability gate (B.2)`
        : `BELOW the ${EXPLAINABILITY_GATE.toFixed(2)} explainability gate (B.2) — not eligible for the top five`,
      ...explain.evidence,
      ...everyday.evidence,
      ...fresh.evidence,
      ...credible.evidence,
    ],
  };
}
