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
  | 'V7_MAGNITUDE_UNSUPPORTED'
  | 'V8_VENUE_CANNOT_SUPPORT_MECHANISM'
  | 'DECOMPOSITION_TOO_COARSE'
  | 'EXAMPLE_TOO_ELABORATE'
  | 'CHALLENGE_REJECTED'
  | 'MODEL_VETO'
  | 'V9_UNACCOUNTED_NUMBER';

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

/**
 * Content-word stems for the relevance rule (DESIGN-NOTES C.3.3).
 *
 * The design's version truncated to 5 characters, which turned out to fail on
 * exactly the material the negative-control fixtures exist to protect: `cell`
 * against `cells`, `tag` against `tags`, and the number `54` dropped for being
 * shorter than three characters. Numbers are the strongest relevance signal
 * there is, so they are always kept; English inflection is stripped before
 * truncation; and the prefix is 4 characters, because the point is a cheap
 * relatedness signal, not a stemmer.
 */
function contentStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw === '') continue;
    if (/^\p{N}/u.test(raw)) {
      stems.add(raw);
      continue;
    }
    if (raw.length < 3 || ENGLISH_STOPWORDS.has(raw)) continue;
    const base = raw
      .replace(/(ies)$/u, 'y')
      .replace(/(sses|shes|ches|xes)$/u, '')
      .replace(/(ing|ed|es|s)$/u, '');
    const stem = base.length >= 3 ? base : raw;
    stems.add(stem.slice(0, 4));
  }
  return stems;
}

const MAGNITUDE_WORDS =
  /\b(half|halved|third|quarter|twice|double|doubled|triple|tripled|times|percent|percentage)\b|\p{L}*fold\b/iu;

/**
 * A digit that is not part of a name.
 *
 * `\p{N}` alone matches the 2 in CO2, the 2.5 in PM2.5, the 19 in COVID-19 and
 * the 3 in omega-3 — every one of which is a word this project's subject matter
 * uses constantly, and none of which is a magnitude. Requiring the digit not to
 * follow a letter is what separates "12 %" from "CO2".
 */
const STANDALONE_DIGIT = /(?<!\p{L})\p{N}/u;

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

/**
 * Claim types where an unrelated quote is a fabrication signal rather than a
 * lay re-wording.
 *
 * `other` is in the set for a different reason than the rest: the claim type is
 * a field the MODEL chooses, so a rule keyed on it can be sidestepped by
 * relabelling — an invented setting typed `other` fell straight back into the
 * lenient path and passed. It appears zero times across the twelve recorded
 * calibration responses, so closing the hatch costs nothing.
 */
const HARD_RELEVANCE_TYPES = new Set<string>(['setting', 'application', 'mechanism', 'other']);

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
  let supportedClaims = 0;
  // One flag per character of the example, so overlapping spans cannot be
  // counted twice. Summing span lengths instead let three claims that all
  // decompose the SAME sentence report full coverage while a second,
  // fabricated sentence went unexamined — the precise omission V6 exists to
  // make visible.
  const covered = new Array<boolean>(normalisedExample.length).fill(false);
  const irrelevantQuotes: { id: string; detail: string }[] = [];

  for (const claim of claims) {
    // V5 — the span must really come from the example. A span the verifier
    // paraphrased means it was not reading the text in front of it.
    const normalisedSpan = normaliseForQuoteMatch(claim.exampleSpan);
    const at = normalisedSpan.length > 0 ? normalisedExample.indexOf(normalisedSpan) : -1;
    if (at >= 0) {
      // The first occurrence, deliberately: a span that appears twice is
      // evidence for one of them, and claiming both would be the same
      // double-count in another guise.
      for (let i = at; i < at + normalisedSpan.length; i++) covered[i] = true;
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

    // V7 — the quote should be about the claim.
    //
    // Split by claim type, because the two failure modes pull in opposite
    // directions. A lay re-wording legitimately shares no stem with its source
    // ("worker bees" for "honeybee foragers"), so judging every claim
    // individually would reject good writing for being good writing — those
    // are aggregated below.
    //
    // But WHERE a study happened, WHAT it is claimed to apply to, and WHY it
    // works are the three things a fabricated example invents, and all three
    // name something concrete that a genuine supporting sentence must also
    // name. For those, an unrelated quote is not paraphrase; it is a real
    // sentence borrowed to cover an invented claim, and V4 alone cannot see it.
    // So they are judged per claim. GT-06 (an invented intensive-care setting
    // backed by a real sentence about day shifts) is the case this catches.
    supportedClaims += 1;
    const claimHasNumber = STANDALONE_DIGIT.test(claim.claimText) || MAGNITUDE_WORDS.test(claim.claimText);
    const quoteHasNumber = STANDALONE_DIGIT.test(quote) || MAGNITUDE_WORDS.test(quote);
    if (!intersects(contentStems(claim.claimText), contentStems(quote))) {
      if (HARD_RELEVANCE_TYPES.has(claim.claimType)) {
        add('V7_QUOTE_IRRELEVANT', claim.id, `${claim.claimType} claim, unrelated quote: ${truncate(quote)}`);
      } else {
        irrelevantQuotes.push({ id: claim.id, detail: truncate(quote) });
      }
    }

    // A claim that states a magnitude, backed by a quote that states none, is
    // not a paraphrase — it is an invented number. That one IS per-claim, and
    // it is the rule that catches the commonest fabrication in the golden set.
    // The bar is deliberately low (the quote must contain *a* number, not the
    // same number) so that a lay restatement — "41 % fewer" as "59 of every
    // 100" — is not punished for doing exactly what §7.3 asks for.
    if (claimHasNumber && !quoteHasNumber) {
      add('V7_MAGNITUDE_UNSUPPORTED', claim.id, `no number in the quote: ${truncate(quote)}`);
    }

    // V9 — every number in the Czech text this claim points at must appear in
    // what the claim says about it, or in the quote supporting it.
    //
    // This is the one rule that connects the two halves of a claim. Everything
    // else checks the span against the example and the quote against the
    // source, so a verifier can decompose a fabricated example into claims
    // whose English text faithfully describes the abstract while their spans
    // point at invented Czech — and pass. Numbers are the part of an invented
    // sentence that survives translation, so they are where that split shows.
    for (const value of numbersIn(claim.exampleSpan)) {
      if (!numbersIn(`${claim.claimText} ${quote}`).has(value)) {
        add('V9_UNACCOUNTED_NUMBER', claim.id, `${value} appears in the Czech but in nothing supporting it`);
      }
    }

    // V8 — a venue string names a journal. It cannot explain a mechanism.
    if (claim.claimType === 'mechanism' && claim.quoteField === 'venue') {
      add('V8_VENUE_CANNOT_SUPPORT_MECHANISM', claim.id, truncate(quote));
    }
  }

  // V7, judged in aggregate. One re-worded claim is normal; a verifier whose
  // quotes are unrelated to most of what it is supporting is not verifying.
  if (irrelevantQuotes.length >= 2 && irrelevantQuotes.length * 2 > supportedClaims) {
    for (const miss of irrelevantQuotes) add('V7_QUOTE_IRRELEVANT', miss.id, miss.detail);
  }

  // V6 — the anti-omission rule. A lazy verifier decomposes only the true parts
  // of an example and silently skips the fabricated sentence; requiring the
  // spans to cover most of the text makes that skip mechanically visible.
  let exampleChars = 0;
  let coveredChars = 0;
  for (let i = 0; i < normalisedExample.length; i++) {
    if (/\s/u.test(normalisedExample[i] ?? '')) continue;
    exampleChars += 1;
    if (covered[i] === true) coveredChars += 1;
  }
  const coverage = exampleChars === 0 ? 0 : coveredChars / exampleChars;
  if (coverage < MIN_SPAN_COVERAGE) {
    add('V6_COVERAGE_TOO_LOW', null, `spans cover ${(coverage * 100).toFixed(0)}% of the example`);
  }

  // The model's overall verdict cannot make a failing example pass — that is
  // what "advisory" means, and the eight rules above are the reason. But it CAN
  // veto: the whole-example failures are exactly the ones that do not localise
  // to a single claim — a causality upgrade, an over-generalised scope, an
  // implied conclusion — and a verifier that says "unsupported" and explains
  // why, while marking each individual claim supported, is telling us something
  // no per-claim rule can see. Overruling that into publication was the
  // opposite of failing closed.
  const vetoed = payload.modelOverallVerdict === 'unsupported';
  if (vetoed && failures.length === 0) {
    add('MODEL_VETO', null, payload.unsupportedReasonsCs.join(' | ') || 'no reason given');
  }

  return {
    verdict: failures.length === 0 && !vetoed ? 'supported' : 'unsupported',
    modelVerdict: payload.modelOverallVerdict,
    failures,
    reasonsCs: payload.unsupportedReasonsCs,
    fabricatedQuote,
    claims,
    coverage,
  };
}

/**
 * Numbers, normalised so the same quantity compares equal across languages and
 * formats: `08:50` and `8:50` agree, and Czech's decimal comma matches English's
 * point. Without that, three of the sixty-six supported claims in the
 * calibration set would fail on punctuation alone.
 */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/gu)) {
    const token = match[0].replace(',', '.');
    if (token.includes('.')) {
      const [whole = '0', fraction = ''] = token.split('.');
      out.add(`${String(Number(whole))}.${fraction.replace(/0+$/u, '') || '0'}`);
    } else {
      out.add(String(Number(token)));
    }
  }
  return out;
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
