/**
 * What every adapter needs from the outside world, in one shape.
 *
 * §10 requires that adding a source is a new file plus one line in the registry.
 * That only holds if the registry can build an adapter without knowing what that
 * adapter needs, so the dependency bundle is shared rather than per-source: a new
 * adapter accepts this object and ignores the parts it has no use for.
 */
import type { Config } from '../config.js';
import type { Secrets } from '../env.js';
import type { CategoryConfig, SourceAdapter, SourceName } from '../types.js';
import type { HttpPolicy, RequestOptions } from '../util/http.js';
import type { Logger } from '../util/log.js';

/**
 * How a source announces itself to the registry (§10). Each adapter file
 * exports exactly one of these; `registry.ts` lists them. Nothing else in the
 * pipeline knows how many sources exist or what any of them is called.
 */
export interface AdapterRegistration {
  readonly name: SourceName;
  /** §5 — some sources only apply to some days, e.g. arXiv on the AI day. */
  readonly appliesTo: (category: CategoryConfig) => boolean;
  readonly create: (deps: AdapterDeps) => SourceAdapter;
}

export interface AdapterDeps {
  readonly config: Config;
  readonly secrets: Secrets;
  readonly logger: Logger;
  /**
   * Injected by tests so no adapter test touches the network. The `| undefined`
   * is spelled out on purpose: under `exactOptionalPropertyTypes` an optional
   * property may not receive an explicit `undefined`, and every caller that
   * builds these deps generically would otherwise need a conditional spread.
   */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Injected by tests so retry backoff does not really sleep. */
  readonly sleepImpl?: ((ms: number) => Promise<void>) | undefined;
  /** Frozen by tests, so a generated date-window query string is assertable. */
  readonly now?: (() => Date) | undefined;
}

export function httpPolicy(config: Config): HttpPolicy {
  return {
    retries: config.http.retries,
    backoffMs: config.http.backoffMs,
    timeoutMs: config.http.timeoutMs,
    userAgent: config.http.userAgent,
  };
}

/**
 * Builds `RequestOptions` from the deps. The conditional spreads exist because
 * of `exactOptionalPropertyTypes`: passing `fetchImpl: undefined` is not the
 * same as omitting it, and `fetchText` defaults only on omission.
 */
export function requestOptions(
  deps: AdapterDeps,
  headers: Record<string, string> = {},
): RequestOptions {
  return {
    headers,
    onRetry: (attempt, waitMs, reason) =>
      deps.logger.warn(`retry ${attempt} in ${waitMs}ms: ${reason}`),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.sleepImpl ? { sleepImpl: deps.sleepImpl } : {}),
  };
}

/** `now()` if the caller injected a clock, otherwise the real one. */
export function nowOf(deps: AdapterDeps): Date {
  return deps.now ? deps.now() : new Date();
}
