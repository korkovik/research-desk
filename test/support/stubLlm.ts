/**
 * A scripted `LlmClient`. The whole point of the client seam in
 * `src/summarise/client.ts` is that the §7.4 ladder can be driven offline —
 * made to accept, to reject, to fabricate a quote, or to fail outright — so
 * "the verification pass can genuinely reject" is a test, not a claim.
 */
import type { LlmClient, LlmRequest, LlmResult, LlmUsage } from '../../src/summarise/client.js';

export type Responder = (request: LlmRequest<unknown>) => unknown;

const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

export class StubLlm implements LlmClient {
  readonly calls: string[] = [];

  /** Keys are matched as prefixes of `request.label`. A responder may throw. */
  constructor(private readonly responders: Record<string, Responder>) {}

  complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push(request.label);
    const key = Object.keys(this.responders)
      .filter((k) => request.label.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) {
      return Promise.reject(new Error(`StubLlm has no responder for label "${request.label}"`));
    }
    const responder = this.responders[key];
    if (responder === undefined) {
      return Promise.reject(new Error(`StubLlm responder missing for "${key}"`));
    }
    try {
      return Promise.resolve({ value: responder(request) as T, usage: NO_USAGE });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  totalUsage(): LlmUsage {
    return NO_USAGE;
  }

  callCount(): number {
    return this.calls.length;
  }
}

/** Returns a different value on each successive call, last one repeating. */
export function sequence(...values: unknown[]): Responder {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value instanceof Error) throw value;
    return value;
  };
}
