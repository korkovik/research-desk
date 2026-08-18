/**
 * Reads `.env.local` at start-up.
 *
 * The run is a launchd job at 06:00 (§12 / assumption A3). A launchd job has no
 * shell, so it has no `export` and no profile — if the keys are not read from a
 * file, an unattended run has no credentials at all. That is the whole reason
 * this exists.
 *
 * THE REAL ENVIRONMENT WINS. A variable already set in `process.env` is never
 * overwritten, so `OPENALEX_API_KEY=… npm run run:daily` still works for a
 * one-off, and the start-up line names any file entry that was ignored.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface EnvLoadResult {
  /** Absolute path read, or null when no file was found. */
  file: string | null;
  /** Names only — a value is never logged. */
  applied: string[];
  /** Present in the file but already set in the real environment, so ignored. */
  shadowed: string[];
}

/**
 * Parse deliberately dumb: `NAME=value`, everything after the first `=` taken
 * verbatim. No expansion, no escapes, no comment stripping inside a value — an
 * API key containing a `#` survives intact. A line that is not blank, not a
 * comment and not `NAME=value` stops the process and names its line number: a
 * key with a missing `=` must never be silently dropped and then believed set.
 */
export function parseEnvFile(text: string, filenameForErrors: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) {
      throw new Error(
        `${filenameForErrors}:${index + 1}: expected NAME=value, got ${JSON.stringify(raw)}`,
      );
    }
    const name = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1);
    // Quote a value to make leading or trailing spaces deliberate. Nothing is
    // trimmed otherwise. A stray space after the closing quote means this is
    // not a quoted value — the quotes stay in, which is the one typo this
    // cannot catch for you.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out.set(name, value);
  }
  return out;
}

export function loadEnvFile(repoRoot: string, filename = '.env.local'): EnvLoadResult {
  const file = resolve(repoRoot, filename);
  if (!existsSync(file)) return { file: null, applied: [], shadowed: [] };
  const entries = parseEnvFile(readFileSync(file, 'utf8'), file);
  const applied: string[] = [];
  const shadowed: string[] = [];
  for (const [name, value] of entries) {
    if (process.env[name] !== undefined) {
      shadowed.push(name);
      continue;
    }
    process.env[name] = value;
    applied.push(name);
  }
  return { file, applied, shadowed };
}

/** The variables this project understands. Documented in `.env.example`. */
export interface Secrets {
  /** §4.1. Absent means the unkeyed 100/day allowance — enough to smoke-test, not to run daily. */
  openAlexApiKey: string | null;
  /** §4.2. Optional: the API works keyless at a lower rate. The 1.1 s throttle is kept either way. */
  semanticScholarApiKey: string | null;
  /** Required for §7 summarisation and §11-step-8 verification. */
  anthropicApiKey: string | null;
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const get = (name: string): string | null => {
    const value = env[name];
    return value === undefined || value.trim() === '' ? null : value;
  };
  return {
    openAlexApiKey: get('OPENALEX_API_KEY'),
    semanticScholarApiKey: get('SEMANTIC_SCHOLAR_API_KEY'),
    anthropicApiKey: get('ANTHROPIC_API_KEY'),
  };
}
