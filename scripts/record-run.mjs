#!/usr/bin/env node
/**
 * Appends exactly one line to state/runs.jsonl for this workflow run, whatever
 * happened in it — published, skipped at the gate, skipped by run.ts, or failed.
 *
 * Why every run and not only the good ones: GitHub disables a public repo's
 * scheduled workflows after 60 days without repository activity. When the
 * ledger was only committed on success, a long outage (the August spend-cap
 * one, say) produced no commits at all, so the outage itself would eventually
 * switch off the schedule that was meant to recover from it. A line per run
 * means a commit per run, which keeps the schedule alive through exactly the
 * stretches when nothing else would.
 *
 * Deliberately dependency-free and run with the runner's own `node`, because on
 * a gate-skipped firing `npm ci` never ran. And deliberately unable to throw
 * past its own catch: a ledger writer that crashes on a bad day produces the
 * very silence it exists to prevent.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const env = process.env;
const ledgerPath = env.LEDGER_PATH || 'state/runs.jsonl';
const runLogPath = env.RUN_LOG_PATH || 'logs/run.log';
const day = env.DAY || new Date().toISOString().slice(0, 10);
const startedAt = Date.parse(env.RUN_STARTED_AT || '') || 0;
const proceeded = env.GATE_PROCEED === 'true';
const gate = proceeded ? 'proceed' : env.GATE_REASON || 'skipped';
const build = env.BUILD_OUTCOME || 'not-run';
const keepalive = env.KEEPALIVE_STATUS || 'not-run';

/**
 * The newest run.log line, but only if THIS run wrote it. A line older than
 * the job must not be passed off as today's outcome — that is how a crashed
 * run would end up recorded as yesterday's success.
 */
function lineFromThisRun() {
  let text;
  try {
    text = readFileSync(runLogPath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue; // a torn last line is skipped, not fatal
    }
    return Date.parse(parsed.ts) >= startedAt ? parsed : null;
  }
  return null;
}

let line;
try {
  line = lineFromThisRun();
  if (line === null) {
    const base = { ts: new Date().toISOString(), runId: day, recordedBy: 'workflow' };
    line = proceeded
      ? {
          ...base,
          level: 'FATAL',
          outcome: 'aborted',
          summary: `failed before it could record itself (build step: ${build})`,
        }
      : { ...base, level: 'INFO', outcome: 'skipped', summary: `skipped at the gate: ${gate}` };
  }
} catch (error) {
  line = {
    ts: new Date().toISOString(),
    runId: day,
    level: 'FATAL',
    outcome: 'aborted',
    summary: `the ledger could not read this run: ${error && error.message}`,
    recordedBy: 'workflow',
  };
}

line.workflow = {
  runId: env.GITHUB_RUN_ID || null,
  attempt: env.GITHUB_RUN_ATTEMPT || null,
  event: env.GITHUB_EVENT_NAME || null,
  schedule: env.SCHEDULE || null,
  gate,
  build,
  keepalive,
};

mkdirSync(dirname(ledgerPath), { recursive: true });
appendFileSync(ledgerPath, `${JSON.stringify(line)}\n`);

const a = line.anthropic || {};
const usd = a.estimatedCostUsd;
// A run that never reached Claude has no anthropic block. Its cost is zero, not
// unknown — "unknown" reads as data that got lost.
const money =
  typeof usd === 'number' ? `$${usd.toFixed(3)}` : a.callsTotal ? 'unknown' : '$0.000 (no Claude calls)';
const md = [
  `### ${String(line.ts).slice(0, 10)} — ${line.outcome}`,
  '',
  '| | |',
  '|---|---|',
  `| Summary | ${line.summary || '-'} |`,
  `| Gate | ${gate} |`,
  `| Build step | ${build} |`,
  `| Claude calls | ${a.callsTotal || 0} |`,
  `| Tokens in / out | ${a.inputTokens || 0} / ${a.outputTokens || 0} |`,
  `| **Estimated cost** | **${money}** |`,
  `| Warnings / errors | ${(line.warnings || []).length} / ${(line.errors || []).length} |`,
  `| czech-product-verifier keepalive | ${keepalive} |`,
].join('\n');
console.log(md);
if (env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
  } catch {
    // The summary is a convenience; the ledger line above is the record.
  }
}
if (env.GITHUB_OUTPUT) {
  try {
    appendFileSync(env.GITHUB_OUTPUT, `outcome=${line.outcome}\n`);
  } catch {
    // Only feeds the commit message.
  }
}
