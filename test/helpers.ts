/**
 * Shared test scaffolding for the source layer.
 *
 * Every adapter test is offline (TEST-SCENARIOS `OFFLINE`): the real config is
 * loaded so a test cannot pass against settings the daily run does not use, but
 * `fetch` is always injected, so nothing here can reach the network even if the
 * machine has one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AdapterDeps } from '../src/adapters/deps.js';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import type { Secrets } from '../src/env.js';
import type { Logger } from '../src/util/log.js';

export const repoRoot = resolve(import.meta.dirname, '..');

export function fixture(name: string): string {
  return readFileSync(resolve(repoRoot, 'test/fixtures', name), 'utf8');
}

export function jsonFixture(name: string): unknown {
  return JSON.parse(fixture(name));
}

/** The shipped config, deep-copied so a test can adjust it without leaking. */
export function testConfig(patch: (config: Config) => void = () => undefined): Config {
  const config: Config = structuredClone(loadConfig(repoRoot));
  patch(config);
  return config;
}

export interface RecordingLogger extends Logger {
  readonly lines: string[];
}

export function testLogger(): RecordingLogger {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
    warnings: () => lines.filter((l) => l.startsWith('warn ')),
    errors: () => lines.filter((l) => l.startsWith('error ')),
  };
}

export const noSecrets: Secrets = {
  openAlexApiKey: null,
  semanticScholarApiKey: null,
  anthropicApiKey: null,
};

export interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

export interface FetchStub {
  impl: typeof fetch;
  calls: FetchCall[];
}

/**
 * Records every request and answers from `handler`. Headers are flattened so a
 * test can assert on `Authorization` without knowing how they were passed.
 */
export function stubFetch(
  handler: (url: string, call: number) => Response | Promise<Response>,
): FetchStub {
  const calls: FetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      if (typeof value === 'string') headers[key] = value;
    }
    calls.push({ url, headers });
    return await handler(url, calls.length);
  };
  return { impl, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/xml' } });
}

/** Deps with the network stubbed and retry backoff instant. */
export function deps(overrides: Partial<AdapterDeps> & Pick<AdapterDeps, 'fetchImpl'>): AdapterDeps {
  return {
    config: overrides.config ?? testConfig(),
    secrets: overrides.secrets ?? noSecrets,
    logger: overrides.logger ?? testLogger(),
    sleepImpl: overrides.sleepImpl ?? (() => Promise.resolve()),
    ...(overrides.now ? { now: overrides.now } : {}),
    fetchImpl: overrides.fetchImpl,
  };
}
