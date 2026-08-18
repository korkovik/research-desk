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

export interface RunLogLine {
  /** ISO instant. */
  timestamp: string;
  date: string;
  category: string;
  candidates: number;
  selected: number;
  published: boolean;
  errors: string[];
}

/** §9 — "Every run appends one line to logs/run.log". Failures included. */
export function appendRunLog(path: string, line: RunLogLine): void {
  mkdirSync(dirname(path), { recursive: true });
  const errors = line.errors.length === 0 ? 'none' : line.errors.map(oneLine).join(' | ');
  const record =
    `${line.timestamp}\t${line.date}\t${line.category}` +
    `\tcandidates=${line.candidates}\tselected=${line.selected}` +
    `\tpublished=${line.published ? 'yes' : 'no'}\terrors=${errors}\n`;
  appendFileSync(path, record, 'utf8');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
