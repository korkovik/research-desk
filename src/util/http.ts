/**
 * The one place an outbound HTTP request is made.
 *
 * §9 fixes the policy: retry twice with backoff, then continue without that
 * source and note the degradation on the page. "Continue without" is the part
 * that matters — a source that fails must never take the run down, and must
 * never be quietly replaced by stale data. So `fetchJson` throws a typed error
 * and the caller decides; nothing here retries forever or returns a fallback.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpPolicy {
  retries: number;
  backoffMs: number[];
  timeoutMs: number;
  userAgent: string;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Called before each sleep, so a run log can show that a retry happened. */
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
  /** Injected in tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected in tests, so retry tests do not actually sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Awaited before EVERY attempt, including retries. Semantic Scholar's one
   * request per second (§4.2) is a limit on requests, not on logical lookups —
   * pacing the caller instead let a lookup's own retry land a few hundred
   * milliseconds after the previous request, which is exactly the wrong thing
   * to do to an endpoint that is already rate-limiting.
   */
  beforeAttempt?: () => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A 4xx other than 429 is not retried: a malformed filter or a bad API key will
 * fail identically on the second and third try, and burning the OpenAlex
 * allowance on a request that cannot succeed is the opposite of §4.1's advice.
 */
function isRetryable(status: number | null): boolean {
  if (status === null) return true; // network-level failure
  if (status === 429) return true;
  return status >= 500;
}

export async function fetchText(
  url: string,
  policy: HttpPolicy,
  options: RequestOptions = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;
  const attempts = policy.retries + 1;
  let lastError: HttpError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.beforeAttempt) await options.beforeAttempt();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await doFetch(url, {
        headers: { 'User-Agent': policy.userAgent, Accept: '*/*', ...options.headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = new HttpError(
          `HTTP ${response.status} from ${redact(url)}`,
          response.status,
          url,
          body.slice(0, 500),
        );
        if (!isRetryable(response.status)) throw lastError;
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof HttpError) {
        if (!isRetryable(error.status)) throw error;
        lastError = error;
      } else {
        lastError = new HttpError(
          `${(error as Error).message} while fetching ${redact(url)}`,
          null,
          url,
        );
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      const waitMs = policy.backoffMs[attempt - 1] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 1000;
      options.onRetry?.(attempt, waitMs, lastError?.message ?? 'unknown');
      await sleep(waitMs);
    }
  }
  throw lastError ?? new HttpError(`exhausted retries for ${redact(url)}`, null, url);
}

export async function fetchJson<T>(
  url: string,
  policy: HttpPolicy,
  options: RequestOptions = {},
): Promise<T> {
  const text = await fetchText(url, policy, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`response from ${redact(url)} was not JSON`, null, url, text.slice(0, 300));
  }
}

/**
 * Keys never appear in this project's URLs — OpenAlex is authenticated with a
 * bearer header for exactly that reason — but a query string can still carry a
 * `mailto`, and log lines get read by people. Strip anything key-shaped anyway.
 */
export function redact(url: string): string {
  return url.replace(/([?&](api_?key|token|key)=)[^&]*/gi, '$1<redacted>');
}
