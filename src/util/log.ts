/**
 * Two outputs, deliberately different.
 *
 * stdout is for whoever is watching a manual run. `logs/run.log` is §9's
 * record: one line per run, appended, read only when the page looks wrong. It
 * is append-only and single-line-per-run so `tail` is enough to answer "what
 * happened this morning" without a parser.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * Kept apart on purpose. A run reports "no key set" and "the site name is
   * still a TODO" as warnings every morning; folding those in with real errors
   * would put `errors: 2` on every healthy day's log line, and a number that is
   * never zero is a number nobody reads.
   */
  warnings(): string[];
  errors(): string[];
}

export function createLogger(sink: (level: LogLevel, message: string) => void = consoleSink): Logger {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    info: (m) => sink('info', m),
    warn: (m) => {
      warnings.push(m);
      sink('warn', m);
    },
    error: (m) => {
      errors.push(m);
      sink('error', m);
    },
    warnings: () => [...warnings],
    errors: () => [...errors],
  };
}

function consoleSink(level: LogLevel, message: string): void {
  const line = `[${level}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * §9's run record. One JSON object per line — still "one line per run" as the
 * spec requires, but greppable with `jq` and readable by a future weekly recap
 * without a parser being written for it. The `summary` field is first so that
 * eyeballing a `tail` still works: it is the human sentence, and everything
 * after it is the detail behind it.
 */
export interface RunLogLine {
  /** ISO instant. */
  ts: string;
  /** The archive date this run was for, `YYYY-MM-DD`. */
  runId: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  outcome: 'published' | 'published_degraded' | 'aborted';
  summary: string;
  category: string;
  categoryLabelCs: string;
  durationMs: number;
  candidates: {
    fetched: Record<string, number>;
    afterExclusions: number;
    exclusionReasons: Record<string, number>;
    selected: number;
    verified: number;
    dropped: { id: string; reason: string; attempts: number }[];
  };
  degradations: string[];
  warnings: string[];
  errors: string[];
  anthropic?: {
    callsTotal: number;
    /**
     * How many times the verifier's own verdict was what rejected an example.
     * Counted apart from everything else because it is the one rejection route
     * a third party controls: the day the model starts saying "unsupported" to
     * everything would otherwise look exactly like a quiet week for research.
     */
    modelVetoes: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number | null;
  };
}

/** §9 — "Every run appends one line to logs/run.log". Failed runs included. */
export function appendRunLog(path: string, line: RunLogLine): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8');
}

/** The human sentence that goes in `summary`, built from the same numbers. */
export function summarise(line: Omit<RunLogLine, 'summary'>): string {
  const parts = [
    `${line.outcome} ${line.candidates.verified}/${line.candidates.selected} papers`,
    `(${line.categoryLabelCs})`,
    `from ${line.candidates.afterExclusions} candidates`,
  ];
  if (line.degradations.length > 0) parts.push(`degraded: ${line.degradations.join(',')}`);
  if (line.errors.length > 0) parts.push(`errors: ${line.errors.length}`);
  else if (line.warnings.length > 0) parts.push(`warnings: ${line.warnings.length}`);
  return parts.join(' ');
}
