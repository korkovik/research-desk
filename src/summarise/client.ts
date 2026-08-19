/**
 * The seam between the pipeline and the Anthropic API.
 *
 * Everything downstream of here — the summariser and, more importantly, the
 * §7.4 verifier — depends on being testable without a network or a key. So the
 * pipeline never sees the SDK: it sees `LlmClient`, a two-method interface that
 * a test can implement in ten lines to make the verifier reject, accept, or
 * fabricate a quote on demand. That is what makes "the verification pass can
 * genuinely reject" something we can prove offline rather than assert.
 *
 * Structured output is used for both calls. A free-text response would have to
 * be parsed with a regex, and a parse that half-succeeds on a malformed answer
 * is precisely how a fabricated example would slip through.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmRequest<T> {
  /** Stable across calls of the same kind, so the cached prefix survives (see `cacheSystem`). */
  system: string;
  user: string;
  schema: z.ZodType<T>;
  model: string;
  maxTokens: number;
  effort: Effort;
  /**
   * Cache the system prompt. A run makes five summarisation calls back to back
   * with an identical system prompt; caching it turns four of those prefixes
   * into cache reads. Only worth it above ~1024 tokens, which both of this
   * project's system prompts clear.
   */
  cacheSystem?: boolean;
  /** For the run log, so a rejection can be traced to the call that produced it. */
  label: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface LlmResult<T> {
  value: T;
  usage: LlmUsage;
}

export interface LlmClient {
  complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
  /** Everything spent this run, for the cost line in the run log. */
  totalUsage(): LlmUsage;
  /** How many calls this run made, including retries and regenerations. */
  callCount(): number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly label: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const ZERO: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

/**
 * Priced in USD per million tokens. Kept here rather than in config because it
 * is a fact about the vendor, not a project setting — and because a wrong
 * number in a cost line is worse than no cost line.
 */
export const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCostUsd(usage: LlmUsage, model: string): number | null {
  const price = PRICING_USD_PER_MTOK[model];
  if (!price) return null;
  // Cache reads bill at ~0.1x input, cache writes at ~1.25x. Close enough for a
  // log line; the invoice is the authority.
  const inputCost =
    (usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheCreationTokens * 1.25) *
    (price.input / 1_000_000);
  const outputCost = usage.outputTokens * (price.output / 1_000_000);
  return inputCost + outputCost;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly sdk: Anthropic;
  private spent: LlmUsage = ZERO;
  private calls = 0;

  constructor(apiKey: string, sdk?: Anthropic) {
    this.sdk = sdk ?? new Anthropic({ apiKey });
  }

  async complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls += 1;
    try {
      const response = await this.sdk.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        output_config: {
          effort: request.effort,
          format: zodOutputFormat(request.schema),
        },
        system: request.cacheSystem
          ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }]
          : request.system,
        messages: [{ role: 'user', content: request.user }],
      });

      // A refusal arrives as HTTP 200 with stop_reason "refusal" and no usable
      // content. Reading .parsed_output without checking would hand the
      // pipeline `null` and look like a parse failure three layers away.
      if (response.stop_reason === 'refusal') {
        throw new LlmError(
          `model refused the ${request.label} request (${response.stop_details?.category ?? 'no category'})`,
          request.label,
        );
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError(
          `${request.label} response hit max_tokens (${request.maxTokens}) and is incomplete`,
          request.label,
        );
      }

      const usage: LlmUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      this.spent = addUsage(this.spent, usage);

      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new LlmError(`${request.label} produced no parseable structured output`, request.label);
      }
      return { value: parsed, usage };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(
        `${request.label} call failed: ${(error as Error).message}`,
        request.label,
        error,
      );
    }
  }

  totalUsage(): LlmUsage {
    return this.spent;
  }

  callCount(): number {
    return this.calls;
  }
}
