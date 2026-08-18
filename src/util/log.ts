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
  /** Everything warn-or-worse said this run, for the run-log line. */
  problems(): string[];
}

export function createLogger(sink: (level: LogLevel, message: string) => void = consoleSink): Logger {
  const problems: string[] = [];
  return {
    info: (m) => sink('info', m),
    warn: (m) => {
      problems.push(m);
      sink('warn', m);
    },
    error: (m) => {
      problems.push(m);
      sink('error', m);
    },
    problems: () => [...problems],
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
  errors: string[];
  anthropic?: {
    callsTotal: number;
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
  return parts.join(' ');
}
