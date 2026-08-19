/**
 * §7 — turn one paper into the blocks the page shows.
 *
 * This used to also run §7.4's example-verification ladder, which dominated
 * both the cost and the wall-clock of a run: every paper cost a generation, a
 * verification and often an adversarial challenge, three or four rungs deep.
 * That block is gone from the product, so the ladder is gone from the run.
 *
 * `src/summarise/verify.ts` is deliberately still here, still tested, and no
 * longer called. It is the piece worth having back if the example block ever
 * returns, and rebuilding it from the spec would cost far more than keeping it.
 *
 * What remains is the §2 style loop, and its rule is unchanged: a style failure
 * never drops a paper. After the regeneration budget the best attempt is
 * published and the finding is logged, because a clumsy sentence is a blemish
 * rather than a falsehood.
 */
import type { LanguageCheckResult, PaperSummary } from '../types.js';
import type { LlmClient } from './client.js';
import { LlmError } from './client.js';
import { SummarySchema } from './schema.js';
import { promptPackFor, type SummaryContext } from './prompt.js';
import type { SourceText } from './verify.js';

export interface SummariseOptions {
  language: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** §2 style regeneration budget. 0 means "generate once and publish it". */
  maxRegenerationAttempts: number;
  /** Runs the deterministic §2 checks. Injected so this module stays testable offline. */
  checkStyle: (summary: PaperSummary) => LanguageCheckResult;
  log?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export type SummariseResult =
  | { status: 'ok'; summary: PaperSummary; checks: LanguageCheckResult }
  | { status: 'dropped'; reason: DropReason; detail: string };

export type DropReason = 'summarisation_failed';

export async function summarise(
  llm: LlmClient,
  source: SourceText,
  context: SummaryContext,
  options: SummariseOptions,
): Promise<SummariseResult> {
  const prompts = promptPackFor(options.language);
  const log = options.log;

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
      // not a reason to lose the paper: §2 never drops one.
      if (best !== null) {
        log?.warn('regeneration unavailable — publishing the best attempt so far');
        break;
      }
      if (attempt > options.maxRegenerationAttempts) {
        return { status: 'dropped', reason: 'summarisation_failed', detail: describeError(error) };
      }
      continue;
    }

    const summary: PaperSummary = { ...payload };
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
      detail: 'no summarisation attempt produced a parseable result',
    };
  }
  if (best.checks.hard.length > 0) {
    log?.error(
      `published with ${best.checks.hard.length} unresolved style finding(s): ` +
        best.checks.hard.map((v) => `${v.block}/${v.rule}`).join(', '),
    );
  }
  return { status: 'ok', summary: best.summary, checks: best.checks };
}

function describeViolation(violation: { block: string; rule: string; detail: string }): string {
  return `[${violation.block}] ${violation.rule}: ${violation.detail}`;
}

function describeError(error: unknown): string {
  return error instanceof LlmError ? error.message : (error as Error).message;
}
