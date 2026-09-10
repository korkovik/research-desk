/**
 * The run ledger must gain a line on EVERY run, not only the good ones.
 *
 * GitHub switches off a public repo's schedule after 60 days without activity.
 * When the ledger only moved on success, a long outage made no commits and so
 * could disable the schedule meant to recover from it. These tests therefore
 * concentrate on the paths that are NOT success — a test of the happy path
 * alone would miss the whole point of the change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/record-run.mjs', import.meta.url).pathname;
const EARLIER = '{"ts":"2026-08-25T05:00:00.000Z","runId":"2026-08-25","outcome":"published"}\n';

interface LedgerLine {
  ts: string;
  runId: string;
  level?: string;
  outcome: string;
  summary?: string;
  recordedBy?: string;
  anthropic?: { estimatedCostUsd: number | null };
  workflow: { gate: string; build: string; keepalive: string };
}

function record(env: Record<string, string>, runLog?: string): { lines: LedgerLine[]; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'rd-ledger-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state', 'runs.jsonl'), EARLIER);
  if (runLog !== undefined) {
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'run.log'), runLog);
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DAY: '2026-09-10', RUN_STARTED_AT: '2026-09-10T04:17:00Z', ...env },
  });
  const lines = readFileSync(join(dir, 'state', 'runs.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as LedgerLine);
  return { lines, status: result.status };
}

const thisRunsLine = (outcome: string): string =>
  `${JSON.stringify({ ts: '2026-09-10T04:20:00.000Z', runId: '2026-09-10', outcome, anthropic: { estimatedCostUsd: 0.97 } })}\n`;

test('a FAILED run that crashed before writing run.log still gets a ledger line', () => {
  const { lines, status } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'failure' });
  assert.equal(status, 0);
  assert.equal(lines.length, 2, 'exactly one new line, and the history is kept');
  const last = lines[1]!;
  assert.equal(last.outcome, 'aborted');
  assert.equal(last.level, 'FATAL');
  assert.equal(last.recordedBy, 'workflow');
  assert.match(last.summary ?? '', /build step: failure/);
});

test('a run whose install failed (build never ran) is recorded as a failure, not a skip', () => {
  const { lines } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'skipped' });
  assert.equal(lines[1]!.outcome, 'aborted');
  assert.match(lines[1]!.summary ?? '', /build step: skipped/);
});

test('a firing SKIPPED at the gate still gets a ledger line', () => {
  const { lines, status } = record({ GATE_PROCEED: 'false', GATE_REASON: 'already-published' });
  assert.equal(status, 0);
  assert.equal(lines.length, 2);
  assert.equal(lines[1]!.outcome, 'skipped');
  assert.equal(lines[1]!.workflow.gate, 'already-published');
  assert.match(lines[1]!.summary ?? '', /already-published/);
});

test('a run.ts skip is recorded from its own run.log line', () => {
  const { lines } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'success' }, thisRunsLine('skipped'));
  assert.equal(lines[1]!.outcome, 'skipped');
  assert.equal(lines[1]!.recordedBy, undefined, 'recorded by run.ts, not synthesised');
});

test('a published run keeps its real cost', () => {
  const { lines } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'success' }, thisRunsLine('published'));
  assert.equal(lines[1]!.outcome, 'published');
  assert.equal(lines[1]!.anthropic?.estimatedCostUsd, 0.97);
});

test('a run.log line from an EARLIER run is not passed off as this run', () => {
  const stale = `${JSON.stringify({ ts: '2026-09-09T04:20:00.000Z', runId: '2026-09-09', outcome: 'published' })}\n`;
  const { lines } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'failure' }, stale);
  assert.equal(lines[1]!.outcome, 'aborted', 'yesterday’s success must not paper over today’s crash');
  assert.equal(lines[1]!.runId, '2026-09-10');
});

test('a torn run.log does not stop the ledger from recording the run', () => {
  const { lines, status } = record({ GATE_PROCEED: 'true', BUILD_OUTCOME: 'failure' }, '{"ts":"2026-09-10T04:2');
  assert.equal(status, 0);
  assert.equal(lines.length, 2);
  assert.equal(lines[1]!.outcome, 'aborted');
});

test('a failed keepalive is recorded but does not turn a published run into a failure', () => {
  const { lines } = record(
    { GATE_PROCEED: 'true', BUILD_OUTCOME: 'success', KEEPALIVE_STATUS: 'failed' },
    thisRunsLine('published'),
  );
  assert.equal(lines[1]!.outcome, 'published');
  assert.equal(lines[1]!.workflow.keepalive, 'failed');
});
