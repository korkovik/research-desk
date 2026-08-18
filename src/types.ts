/**
 * The vocabulary of the pipeline. Everything else in `src/` speaks these types.
 *
 * The important one is `Candidate`. Spec §10 fixes its shape as
 * `{id, title, abstract, date, url, licence, source}` and requires that adding
 * a later source — the market/industry phase — is a new adapter rather than a
 * rewrite. So those seven fields are the whole required contract: a new adapter
 * that can fill only those seven is a valid adapter, and every consumer
 * downstream degrades rather than crashes when the optional fields are absent.
 */

/** Name of the adapter a candidate came from. Adding a source adds a member. */
export type SourceName = 'openalex' | 'arxiv';

/** The seven-field contract of §10, plus optional evidence for ranking. */
export interface Candidate {
  // ---- §10 contract. An adapter MUST supply all seven. ----
  /** Stable per-source identifier, prefixed by source: `openalex:W123`, `arxiv:2608.16889`. */
  id: string;
  title: string;
  /**
   * Plain-text abstract, or null when the source has none. Null is not the same
   * as absent: §6 excludes papers with no abstract *and* no TLDR, and that
   * decision is made in the selector, not in the adapter.
   */
  abstract: string | null;
  /** Publication or submission date, `YYYY-MM-DD`. */
  date: string;
  /** Where a human reads the paper. Landing page, not a PDF. */
  url: string;
  /** Licence string as the source reports it (`cc-by`, `arxiv-nonexclusive`, …), or null. */
  licence: string | null;
  source: SourceName;

  // ---- Beyond the contract. Optional: a minimal adapter omits these and the
  // ranker falls back to neutral values for whatever is missing. ----
  /** Bare DOI (`10.1234/foo`), no `https://doi.org/` prefix. Used for dedup and for the reference block. */
  doi?: string | null;
  /** OpenAlex work ID (`W123…`) when known — the other half of the dedup key. */
  openAlexId?: string | null;
  /** OpenAlex subfield. The diversity constraint of §6 is keyed on `subfield.id`. */
  subfield?: TopicRef | null;
  field?: TopicRef | null;
  topic?: TopicRef | null;
  citedByCount?: number;
  isOpenAccess?: boolean;
  /** Direct open-access PDF when one exists; §7.6 links it. */
  oaPdfUrl?: string | null;
  /** True for arXiv and for OpenAlex `type: preprint`. §4.3 requires saying so in plain words. */
  isPreprint?: boolean;
  isRetracted?: boolean;
  authors?: string[];
  /** Journal name, or the preprint server. */
  venue?: string | null;
  /** Date the source first indexed the work; used as a freshness fallback. */
  indexedDate?: string | null;
  /** How many works this one cites — a weak proxy for a full study over a note. */
  referencedWorksCount?: number;
}

/** An OpenAlex topic-hierarchy node (domain / field / subfield / topic). */
export interface TopicRef {
  id: string;
  name: string;
}

/**
 * A candidate after Semantic Scholar enrichment (§4.2). `tldr` is the
 * plain-language seed for the Czech explanation — never the final text.
 */
export interface EnrichedCandidate extends Candidate {
  tldr: string | null;
  /** Set when S2 supplied an abstract the discovery source lacked. */
  abstractSource: 'source' | 'semantic-scholar' | 'none';
  /** Why enrichment produced nothing, when it produced nothing. For the log. */
  enrichmentNote?: string;
}

/** Per-factor scores, kept separately so the run log can explain a ranking. */
export interface ScoreBreakdown {
  explainability: number;
  everydayRelevance: number;
  freshness: number;
  credibility: number;
  total: number;
  /** Human-readable evidence for why each factor scored as it did. */
  evidence: string[];
}

export interface ScoredCandidate extends EnrichedCandidate {
  score: ScoreBreakdown;
}

/** The six output blocks of §7, in the spec's order. */
export interface PaperSummary {
  /** §7.1 — plain-language headline, one line. */
  nadpis: string;
  /** §7.2 — 2–3 sentences, no numbers. */
  oCoJde: string;
  /** §7.3 — 150–250 words, numbers allowed but each anchored in plain language. */
  podrobneVysvetleni: string;
  /** §7.4 — the everyday example. Must be traceable to the source text. */
  prikladZeZivota: string;
  /** True when §7.4's fallback was used: the example is the authors' stated motivation. */
  prikladJeMotivace: boolean;
  /** §7.5 — 1–2 sentences. */
  procJeToDulezite: string;
  /** §7.6 — one honest line on limitations. The rest of the block is rendered from `Candidate`. */
  poznamkaKOmezenim: string;
}

/** Outcome of the §11-step-8 verification pass for one paper. */
export interface VerificationOutcome {
  verdict: 'supported' | 'unsupported';
  /** Attempts spent before this outcome: 1 = accepted first time. */
  attempts: number;
  /** Every rejection, in order, for the run log (§11 step 8: "Log every rejection"). */
  rejections: VerificationRejection[];
  /** Which remediation the pipeline ended on. */
  resolution: 'accepted' | 'regenerated' | 'motivation-fallback' | 'paper-dropped';
}

export interface VerificationRejection {
  attempt: number;
  unsupportedClaims: string[];
  /** Claims whose "supporting quote" was not actually present in the source text. */
  fabricatedQuotes: string[];
}

/** Result of the deterministic §2 language checks over one summary. */
export interface LanguageCheckResult {
  ok: boolean;
  hard: LanguageViolation[];
  soft: LanguageViolation[];
}

export interface LanguageViolation {
  /** Which of the six blocks. */
  block: keyof PaperSummary | 'all';
  rule:
    | 'hype'
    | 'untranslated-english'
    | 'sentence-length'
    | 'long-words'
    | 'unexplained-jargon'
    | 'unanchored-number'
    | 'block-length'
    | 'empty-block';
  detail: string;
}

/** One paper as it appears in the day's page and its JSON twin. */
export interface DigestEntry {
  candidate: ScoredCandidate;
  summary: PaperSummary;
  verification: VerificationOutcome;
  checks: LanguageCheckResult;
}

/** Everything one run produced. Serialised verbatim as `archive/YYYY-MM-DD.json`. */
export interface DayDigest {
  /** `YYYY-MM-DD` in the configured timezone. */
  date: string;
  categoryKey: string;
  categoryLabel: string;
  language: string;
  entries: DigestEntry[];
  /** §3: a run short of five publishes anyway and says so. */
  shortfall: Shortfall | null;
  /** §9: sources that failed or degraded, rendered into the page footer. */
  degradations: Degradation[];
  generatedAt: string;
  /** Schema version, so a later recap/translation pass can read old files safely. */
  schemaVersion: 1;
}

export interface Shortfall {
  expected: number;
  produced: number;
  reason: string;
}

export interface Degradation {
  source: SourceName | 'semantic-scholar' | 'anthropic';
  /** One plain-Czech sentence for the page footer. */
  messageCs: string;
  /** The technical detail. Log only — never rendered. */
  detail: string;
}

/** §10 — the adapter contract. A new source implements exactly this. */
export interface SourceAdapter {
  readonly name: SourceName;
  /**
   * @param category the day's category, as configured
   * @param since    inclusive lower bound, `YYYY-MM-DD`
   */
  fetch(category: CategoryConfig, since: string): Promise<Candidate[]>;
}

// ---------------------------------------------------------------------------
// Config. The shapes here mirror config.json; `src/config.ts` validates it.
// ---------------------------------------------------------------------------

export interface CategoryConfig {
  /** 1 = Monday … 7 = Sunday. Explicit, because JS `getDay()` puts Sunday at 0. */
  weekday: number;
  key: string;
  labelCs: string;
  openalex: {
    fieldIds: string[];
    fieldNames: string[];
  };
  arxiv?: {
    categories: string[];
  };
}
