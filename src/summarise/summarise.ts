/**
 * §7 and §11 steps 7–8: turn one paper into six Czech blocks, and refuse to
 * publish it if the example cannot be traced back to the paper.
 *
 * The two loops in here are deliberately asymmetric, and the asymmetry is the
 * point (DESIGN-NOTES A.6):
 *
 *   A STYLE failure never drops a paper. A clumsy sentence is a blemish; after
 *   the regeneration budget is spent we publish the best attempt and log it.
 *
 *   An unverifiable EXAMPLE does drop the paper. §7.4 says a fabricated example
 *   is worse than publishing four papers instead of five, so the ladder ends at
 *   removal, not at "publish it anyway with a caveat".
 */
import type { LanguageCheckResult, PaperSummary, VerificationOutcome, VerificationRejection } from '../types.js';
import type { LlmClient } from './client.js';
import { LlmError } from './client.js';
import { ExampleSchema, MotivationSchema, SummarySchema } from './schema.js';
import { promptPackFor, type SummaryContext } from './prompt.js';
import { verifyExample, type SourceText, type VerifyOptions, type VerifyReport } from './verify.js';

export interface SummariseOptions {
  language: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** §2 style regeneration budget. 0 means "generate once, publish whatever comes back". */
  maxRegenerationAttempts: number;
  /** §7.4 free-form example attempts before the motivation fallback. */
  maxExampleAttempts: number;
  verification: VerifyOptions;
  /** Runs the deterministic §2 checks. Injected so this module stays testable offline. */
  checkStyle: (summary: PaperSummary) => LanguageCheckResult;
  log?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export type SummariseResult =
  | { status: 'ok'; summary: PaperSummary; verification: VerificationOutcome; checks: LanguageCheckResult }
  | { status: 'dropped'; reason: DropReason; verification: VerificationOutcome | null; detail: string };

export type DropReason = 'example_unverifiable' | 'summarisation_failed';

export async function summariseAndVerify(
  llm: LlmClient,
  source: SourceText,
  context: SummaryContext,
  options: SummariseOptions,
): Promise<SummariseResult> {
  const prompts = promptPackFor(options.language);
  const log = options.log;

  // ---- 1. Generate the six blocks, with the §2 style regeneration loop. ----
  let summary: PaperSummary | null = null;
  let checks: LanguageCheckResult | null = null;
  let best: { summary: PaperSummary; checks: LanguageCheckResult } | null = null;

  for (let attempt = 1; attempt <= options.maxRegenerationAttempts + 1; attempt++) {
    let payload;
    try {
      const corrections =
        attempt === 1 || checks === null
          ? ''
          : `\n\n${prompts.renderCorrections(checks.hard.map(describeViolation), [])}`;
      const result = await llm.complete({
        system: prompts.summariserSystem,
        user: prompts.renderSummariserUser(source, context) + corrections,
        schema: SummarySchema,
        model: options.model,
        maxTokens: options.maxTokens,
        effort: options.effort,
        cacheSystem: true,
        label: `summarise-attempt-${attempt}`,
      });
      payload = result.value;
    } catch (error) {
      log?.error(`summarisation failed on attempt ${attempt}: ${describeError(error)}`);
      // A call that fails while trying to IMPROVE an attempt we already have is
      // not a reason to lose the paper. §2's rules never drop a paper (A.6), so
      // a bad night at the API must not turn a style blemish into a shortfall —
      // stop regenerating and publish what we have.
      if (best !== null) {
        log?.warn('regeneration unavailable — publishing the best attempt so far');
        break;
      }
      // Nothing usable yet. DESIGN-NOTES C.6: drop the paper rather than
      // publish five blocks and an empty sixth.
      if (attempt > options.maxRegenerationAttempts) {
        return {
          status: 'dropped',
          reason: 'summarisation_failed',
          verification: null,
          detail: describeError(error),
        };
      }
      continue;
    }

    summary = { ...payload, prikladJeMotivace: false };
    checks = options.checkStyle(summary);
    if (best === null || checks.hard.length < best.checks.hard.length) {
      best = { summary, checks };
    }
    if (checks.hard.length === 0) break;
    log?.warn(
      `style check attempt ${attempt}: ${checks.hard.length} hard finding(s) — ` +
        checks.hard.map((v) => `${v.block}/${v.rule}`).join(', '),
    );
  }

  if (best === null) {
    return {
      status: 'dropped',
      reason: 'summarisation_failed',
      verification: null,
      detail: 'no summarisation attempt produced a parseable result',
    };
  }
  if (best.checks.hard.length > 0) {
    // §2 rules are enforced, but not at the cost of the day's page. Logged loudly
    // so a persistent style failure is visible in `logs/run.log`.
    log?.error(
      `style regeneration exhausted: ${best.checks.hard.length} hard finding(s) remain after ` +
        `${options.maxRegenerationAttempts + 1} attempts`,
    );
  }
  summary = best.summary;

  // ---- 2. The §7.4 verification ladder. ----
  const rejections: VerificationRejection[] = [];
  let attempts = 0;

  const runVerification = async (example: string): Promise<VerifyReport | null> => {
    try {
      return await verifyExample(llm, example, source, options.verification);
    } catch (error) {
      // Fail closed. "The verifier was unreachable" must never read as "the
      // example is fine" — that would turn an outage into a published
      // fabrication, which is the exact failure §7.4 exists to prevent.
      log?.error(`verification unavailable: ${describeError(error)}`);
      return null;
    }
  };

  const recordRejection = (report: VerifyReport | null, detail: string): void => {
    attempts += 1;
    rejections.push({
      attempt: attempts,
      unsupportedClaims:
        report === null
          ? [detail]
          : report.failures.map((f) => `${f.code}${f.claimId ? ` (${f.claimId})` : ''}: ${f.detail}`),
      fabricatedQuotes:
        report === null
          ? []
          : report.failures.filter((f) => f.code === 'V4_FABRICATED_QUOTE').map((f) => f.detail),
    });
    if (report?.fabricatedQuote === true) {
      log?.error('verifier cited a quote that is not in the source text — treating as a rejection');
    }
  };

  // Free-form example attempts.
  for (let attempt = 1; attempt <= options.maxExampleAttempts; attempt++) {
    const report = await runVerification(summary.prikladZeZivota);
    if (report !== null && report.verdict === 'supported') {
      attempts += 1;
      return {
        status: 'ok',
        summary,
        checks: finalChecks(summary, options, log),
        verification: {
          verdict: 'supported',
          attempts,
          rejections,
          resolution: attempt === 1 ? 'accepted' : 'regenerated',
        },
      };
    }
    recordRejection(report, 'verification call failed');
    if (attempt === options.maxExampleAttempts) break;

    const regenerated = await regenerateExample(llm, source, prompts, report, options, attempt);
    if (regenerated === null) break;
    summary = { ...summary, prikladZeZivota: regenerated };
  }

  // §7.4's labelled fallback: the authors' stated motivation. It gets the same
  // verification, because "we said it was a motivation" is not a licence to
  // invent one. The visible label itself is added by the renderer, not here — it
  // is our wording, not a claim, and must not be sent to the verifier.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let motivation: string;
    try {
      const result = await llm.complete({
        system: prompts.motivationSystem,
        user: prompts.renderMotivationUser(source),
        schema: MotivationSchema,
        model: options.model,
        maxTokens: options.maxTokens,
        effort: options.effort,
        cacheSystem: true,
        label: `motivation-fallback-${attempt}`,
      });
      motivation = result.value.motivace;
    } catch (error) {
      log?.error(`motivation fallback generation failed: ${describeError(error)}`);
      break;
    }

    const report = await runVerification(motivation);
    if (report !== null && report.verdict === 'supported') {
      attempts += 1;
      const withFallback: PaperSummary = {
        ...summary,
        prikladZeZivota: motivation,
        prikladJeMotivace: true,
      };
      return {
        status: 'ok',
        summary: withFallback,
        checks: finalChecks(withFallback, options, log),
        verification: {
          verdict: 'supported',
          attempts,
          rejections,
          resolution: 'motivation-fallback',
        },
      };
    }
    recordRejection(report, 'motivation fallback verification failed');
  }

  // The codes matter more than the count: "the verifier could not reach the API"
  // and "the verifier found an invented setting" both end here, and the run log
  // is where that difference has to be visible.
  const codes = [...new Set(rejections.flatMap((r) => r.unsupportedClaims.map(firstToken)))];
  log?.error(
    `example could not be verified at any rung — dropping the paper (§7.4). ` +
      `${rejections.length} rejection(s): ${codes.join(', ')}`,
  );
  return {
    status: 'dropped',
    reason: 'example_unverifiable',
    verification: { verdict: 'unsupported', attempts, rejections, resolution: 'paper-dropped' },
    detail: `${rejections.length} rejection(s)`,
  };
}

/**
 * The style check that actually describes what is being published.
 *
 * The regeneration loop above checks the summary it generated; by the time we
 * return, the example may have been replaced once or twice, or swapped for the
 * motivation fallback, and none of those went through that loop. A hard finding
 * introduced by a replacement would otherwise reach the page recorded but never
 * mentioned — §2's rules are enforced, so a surviving violation has to be
 * visible in `logs/run.log`, not only in the archive's JSON twin.
 */
function finalChecks(
  summary: PaperSummary,
  options: SummariseOptions,
  log: SummariseOptions['log'],
): LanguageCheckResult {
  const result = options.checkStyle(summary);
  if (result.hard.length > 0) {
    log?.error(
      `published with ${result.hard.length} unresolved style finding(s): ` +
        result.hard.map((v) => `${v.block}/${v.rule}`).join(', '),
    );
  }
  return result;
}

async function regenerateExample(
  llm: LlmClient,
  source: SourceText,
  prompts: ReturnType<typeof promptPackFor>,
  report: VerifyReport | null,
  options: SummariseOptions,
  attempt: number,
): Promise<string | null> {
  // The generator, unlike the verifier, IS told why it was rejected — that is
  // the whole point of a regeneration. The verifier stays stateless so it cannot
  // negotiate with itself across attempts (DESIGN-NOTES C.1.2).
  const rejectedSpans =
    report === null
      ? []
      : report.claims.filter((c) => c.verdict === 'unsupported').map((c) => c.exampleSpan);
  const corrections = prompts.renderCorrections(report?.reasonsCs ?? [], rejectedSpans);
  try {
    const result = await llm.complete({
      system: prompts.summariserSystem,
      user: prompts.renderExampleRetryUser(source, corrections),
      schema: ExampleSchema,
      model: options.model,
      maxTokens: options.maxTokens,
      effort: options.effort,
      cacheSystem: true,
      label: `regenerate-example-${attempt}`,
    });
    return result.value.prikladZeZivota;
  } catch (error) {
    options.log?.error(`example regeneration failed: ${describeError(error)}`);
    return null;
  }
}

function describeViolation(violation: { block: string; rule: string; detail: string }): string {
  return `[${violation.block}] ${violation.rule}: ${violation.detail}`;
}

/** `V4_FABRICATED_QUOTE (c2): …` → `V4_FABRICATED_QUOTE`. */
function firstToken(detail: string): string {
  return detail.split(/[\s(:]/u)[0] ?? detail;
}

function describeError(error: unknown): string {
  return error instanceof LlmError ? error.message : (error as Error).message;
}
