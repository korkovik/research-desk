/**
 * §7.4 / §11 step 8 — the example verification pass.
 *
 * The spec calls a fabricated "Příklad ze života" the single worst failure this
 * project can produce, worse than publishing four papers instead of five. So
 * this module is built around one question: can it genuinely say no?
 *
 * Three things make that more than a hope:
 *
 *  1. The verifier is a SEPARATE call that sees only the source text and the
 *     candidate example (DESIGN-NOTES C.1). It never sees the rest of the
 *     generated summary. A confident 200-word explanation asserting a study
 *     setting would be read as background truth — and that text is exactly what
 *     is on trial, so it cannot be context.
 *
 *  2. The model's own overall verdict is ADVISORY. The verdict that counts is
 *     computed here, from rules V1–V8 (DESIGN-NOTES C.2.3), over the claims it
 *     returned. A model that says "supported" while failing V4 is overruled.
 *
 *  3. Every claim marked supported must carry a verbatim quote from the source,
 *     and this code checks that the quote actually occurs there. A verifier that
 *     invents its supporting quote fails the check — which is the difference
 *     between a verification pass and a second opinion.
 */
import type { LlmClient } from './client.js';
import { VerificationSchema, type ClaimPayload, type VerificationPayload } from './schema.js';
import { VERIFIER_SYSTEM_PROMPT, renderVerifierUserMessage, CHALLENGE_SYSTEM_PROMPT } from './prompt.js';

/** The only text a claim may be checked against (DESIGN-NOTES C.1.1). */
export interface SourceText {
  title: string;
  /**
   * Verbatim apart from whitespace normalisation. NEVER truncate it: a truncated
   * abstract turns supported claims into unsupported ones, and the pipeline
   * would then reject good examples for a reason no log would explain.
   */
  abstract: string;
  tldr: string | null;
  venue: string;
  /** `article`, `preprint`, … — lets a "not peer reviewed" claim be checked. */
  type: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

export interface VerifyOptions {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** DESIGN-NOTES C.3.4 — a second, adversarial pass over anything that passed. */
  challengePass: boolean;
  /** Called when the challenge pass could not run. See the note in `verifyExample`. */
  onWarn?: (message: string) => void;
}

/** Why a verification failed, in machine-readable form. */
export type FailureCode =
  | 'V1_CLAIM_COUNT'
  | 'V2_UNSUPPORTED_CLAIM'
  | 'V3_QUOTE_TOO_WEAK'
  | 'V4_FABRICATED_QUOTE'
  | 'V5_SPAN_NOT_IN_EXAMPLE'
  | 'V6_COVERAGE_TOO_LOW'
  | 'V7_QUOTE_IRRELEVANT'
  | 'V8_VENUE_CANNOT_SUPPORT_MECHANISM'
  | 'DECOMPOSITION_TOO_COARSE'
  | 'EXAMPLE_TOO_ELABORATE'
  | 'CHALLENGE_REJECTED';

export interface VerifyReport {
  verdict: 'supported' | 'unsupported';
  /** Advisory only — recorded so drift between it and `verdict` can be tracked. */
  modelVerdict: 'supported' | 'unsupported';
  failures: { code: FailureCode; claimId: string | null; detail: string }[];
  /** Czech, straight from the verifier, fed back into regeneration. */
  reasonsCs: string[];
  /** True when a "supporting" quote was not present in the source. */
  fabricatedQuote: boolean;
  claims: ClaimPayload[];
  /** Share of the example's non-whitespace characters covered by claim spans (V6). */
  coverage: number;
  challengeRan: boolean;
}

// ---------------------------------------------------------------------------
// Text normalisation (DESIGN-NOTES C.3.2). Applied identically to haystack and
// needle before comparison, so a curly quote or a non-breaking space in the
// model's copy of a quote is not mistaken for a fabrication.
// ---------------------------------------------------------------------------

export function normaliseForQuoteMatch(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[“”„‟″«»]/gu, '"')
    .replace(/[‘’‚‛′´`]/gu, "'")
    .replace(/[–—‑−‐]/gu, '-')
    .replace(/…/gu, '...')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'from', 'as', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'has', 'have', 'had',
  'not', 'no', 'can', 'could', 'may', 'might', 'will', 'would', 'should', 'must',
  'more', 'most', 'also', 'than', 'then', 'there', 'here', 'which', 'who', 'when',
  'while', 'study', 'studies', 'paper', 'results', 'result',
]);

/** Content-word stems, truncated to 5 characters (DESIGN-NOTES C.3.3). */
function contentStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3) continue;
    if (ENGLISH_STOPWORDS.has(raw)) continue;
    stems.add(raw.slice(0, 5));
  }
  return stems;
}

const MAGNITUDE_WORDS = /\b(half|third|quarter|twice|double|doubled|triple|tripled|fold|times|percent|percentage)\b/iu;

// ---------------------------------------------------------------------------
// The rules the code enforces regardless of what the model concluded.
// ---------------------------------------------------------------------------

const MIN_QUOTE_CHARS = 15;
const MIN_QUOTE_TOKENS = 3;
const MIN_QUOTE_CONTENT_TOKENS = 2;
const MIN_CLAIMS = 2;
const MAX_CLAIMS = 12;
const SHORT_EXAMPLE_WORDS = 15;
const MIN_SPAN_COVERAGE = 0.7;

export function adjudicate(
  payload: VerificationPayload,
  example: string,
  source: SourceText,
): Omit<VerifyReport, 'challengeRan'> {
  const failures: VerifyReport['failures'] = [];
  const add = (code: FailureCode, claimId: string | null, detail: string): void => {
    failures.push({ code, claimId, detail });
  };

  const exampleWords = example.trim().split(/\s+/u).filter(Boolean).length;
  const claims = payload.claims;

  // V1 — decomposition sanity. Both directions are rubber-stamp signals: too few
  // claims means the example was waved through as one lump; too many means the
  // example has grown detail a two-sentence lay illustration should not contain.
  if (claims.length > MAX_CLAIMS) {
    add('EXAMPLE_TOO_ELABORATE', null, `${claims.length} claims for a lay example`);
  }
  if (claims.length < MIN_CLAIMS && exampleWords > SHORT_EXAMPLE_WORDS) {
    add('DECOMPOSITION_TOO_COARSE', null, `${claims.length} claim(s) for ${exampleWords} words`);
  }

  const normalisedExample = normaliseForQuoteMatch(example);
  const sourceFields: Record<string, string> = {
    title: normaliseForQuoteMatch(source.title),
    abstract: normaliseForQuoteMatch(source.abstract),
    tldr: source.tldr === null ? '' : normaliseForQuoteMatch(source.tldr),
    venue: normaliseForQuoteMatch(`${source.venue} ${source.type} ${source.date}`),
  };

  let fabricatedQuote = false;
  let coveredChars = 0;

  for (const claim of claims) {
    // V5 — the span must really come from the example. A span the verifier
    // paraphrased means it was not reading the text in front of it.
    const normalisedSpan = normaliseForQuoteMatch(claim.exampleSpan);
    if (normalisedSpan.length > 0 && normalisedExample.includes(normalisedSpan)) {
      coveredChars += normalisedSpan.replace(/\s/gu, '').length;
    } else {
      add('V5_SPAN_NOT_IN_EXAMPLE', claim.id, truncate(claim.exampleSpan));
    }

    if (claim.verdict === 'unsupported') {
      // V2 — one unsupported claim sinks the example. There is no partial credit:
      // §7.4 is about the example as a whole being traceable to the paper.
      add('V2_UNSUPPORTED_CLAIM', claim.id, truncate(claim.claimText));
      continue;
    }

    const quote = claim.sourceQuote;
    if (quote === null || claim.quoteField === null) {
      add('V3_QUOTE_TOO_WEAK', claim.id, 'marked supported with no quote');
      continue;
    }

    // V3 — a quote must actually assert something. This kills the "quote the
    // word `study` to support everything" strategy.
    const tokens = quote.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
    const contentTokens = tokens.filter((t) => !ENGLISH_STOPWORDS.has(t.toLowerCase()));
    if (
      quote.length < MIN_QUOTE_CHARS ||
      tokens.length < MIN_QUOTE_TOKENS ||
      contentTokens.length < MIN_QUOTE_CONTENT_TOKENS
    ) {
      add('V3_QUOTE_TOO_WEAK', claim.id, truncate(quote));
      continue;
    }

    // V4 — THE rule. The quote must occur verbatim in the field it claims to be
    // from. A quote that does not is the verifier fabricating its own evidence,
    // which is a worse failure than an honest "unsupported" and is treated as
    // such: it rejects the example outright and is logged for a human.
    const haystack = sourceFields[claim.quoteField] ?? '';
    if (!haystack.includes(normaliseForQuoteMatch(quote))) {
      fabricatedQuote = true;
      add('V4_FABRICATED_QUOTE', claim.id, `not in ${claim.quoteField}: ${truncate(quote)}`);
      continue;
    }

    // V7 — the quote must be about the claim. Cheap stem overlap, but it catches
    // a verifier pasting a real but unrelated sentence from the abstract.
    const shared = intersects(contentStems(claim.claimText), contentStems(quote));
    if (!shared) {
      add('V7_QUOTE_IRRELEVANT', claim.id, truncate(quote));
      continue;
    }
    if (claim.claimType === 'quantity' && !/\p{N}/u.test(quote) && !MAGNITUDE_WORDS.test(quote)) {
      add('V7_QUOTE_IRRELEVANT', claim.id, `quantity claim quoted without a number: ${truncate(quote)}`);
      continue;
    }

    // V8 — a venue string names a journal. It cannot explain a mechanism.
    if (claim.claimType === 'mechanism' && claim.quoteField === 'venue') {
      add('V8_VENUE_CANNOT_SUPPORT_MECHANISM', claim.id, truncate(quote));
    }
  }

  // V6 — the anti-omission rule. A lazy verifier decomposes only the true parts
  // of an example and silently skips the fabricated sentence; requiring the
  // spans to cover most of the text makes that skip mechanically visible.
  const exampleChars = normalisedExample.replace(/\s/gu, '').length;
  const coverage = exampleChars === 0 ? 0 : Math.min(1, coveredChars / exampleChars);
  if (coverage < MIN_SPAN_COVERAGE) {
    add('V6_COVERAGE_TOO_LOW', null, `spans cover ${(coverage * 100).toFixed(0)}% of the example`);
  }

  return {
    verdict: failures.length === 0 ? 'supported' : 'unsupported',
    modelVerdict: payload.modelOverallVerdict,
    failures,
    reasonsCs: payload.unsupportedReasonsCs,
    fabricatedQuote,
    claims,
    coverage,
  };
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * One full verification of one example: the verifier call, the code-side
 * adjudication, and — when the example survives — the adversarial challenge
 * pass (DESIGN-NOTES C.3.4).
 *
 * The challenge pass exists because a single verifier optimises for "does this
 * look consistent" while an explicitly adversarial one optimises for "what is
 * missing", and those catch different things. It costs one extra call per
 * passing example; §7.4 says the risk it addresses is worse than shipping fewer
 * papers, which settles the trade.
 */
export async function verifyExample(
  llm: LlmClient,
  example: string,
  source: SourceText,
  options: VerifyOptions,
): Promise<VerifyReport> {
  const first = await llm.complete({
    system: VERIFIER_SYSTEM_PROMPT,
    user: renderVerifierUserMessage(source, example),
    schema: VerificationSchema,
    model: options.model,
    maxTokens: options.maxTokens,
    effort: options.effort,
    cacheSystem: true,
    label: 'verify-example',
  });

  const report = adjudicate(first.value, example, source);
  if (report.verdict === 'unsupported' || !options.challengePass) {
    return { ...report, challengeRan: false };
  }

  // Fresh context. The challenger is not told that anything passed beyond the
  // one sentence in its own prompt, and it never sees the first verifier's
  // claims — otherwise it would be reviewing that analysis rather than the text.
  //
  // A challenge call that FAILS is the one infrastructure failure this pipeline
  // is allowed to shrug off (DESIGN-NOTES C.6). Everything mandatory already
  // ran: the primary verifier returned `supported` and this code confirmed every
  // quote occurs verbatim in the source. Failing closed here would drop papers
  // because an optional hardening step was unreachable. It is logged, so a
  // sustained outage is visible rather than silently lowering the bar.
  let challengeReport: Omit<VerifyReport, 'challengeRan'>;
  try {
    const challenge = await llm.complete({
      system: CHALLENGE_SYSTEM_PROMPT,
      user: renderVerifierUserMessage(source, example),
      schema: VerificationSchema,
      model: options.model,
      maxTokens: options.maxTokens,
      effort: options.effort,
      cacheSystem: true,
      label: 'verify-example-challenge',
    });
    challengeReport = adjudicate(challenge.value, example, source);
  } catch (error) {
    options.onWarn?.(
      `challenge pass unavailable, accepting the primary verdict: ${(error as Error).message}`,
    );
    return { ...report, challengeRan: false };
  }
  if (challengeReport.verdict === 'unsupported') {
    return {
      ...challengeReport,
      failures: [
        { code: 'CHALLENGE_REJECTED', claimId: null, detail: 'passed first pass, rejected on challenge' },
        ...challengeReport.failures,
      ],
      challengeRan: true,
    };
  }
  return { ...report, challengeRan: true };
}
