import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The schedule lives in YAML that nothing else in this suite reads, and two of
 * its job conditions compare cron strings exactly. These pin the weekly shape:
 * an edition on Tuesday, the stall check on Wednesday, the keepalive daily.
 */
const daily = readFileSync(new URL('../.github/workflows/daily.yml', import.meta.url), 'utf8');
const keepalive = readFileSync(new URL('../.github/workflows/keepalive.yml', import.meta.url), 'utf8');
const crons = (yaml: string): string[] => [...yaml.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1] ?? '');
const isStallCheck = (cron: string): boolean => cron.startsWith('23 11 ');

test('the digest fires only on Tuesdays, and the stall check only on Wednesday', () => {
  const all = crons(daily);
  assert.deepEqual(all.filter(isStallCheck), ['23 11 * * 3']);
  const digest = all.filter((c) => !isStallCheck(c));
  assert.ok(digest.length > 0, 'the digest has a schedule');
  for (const cron of digest) assert.match(cron, /^\d+ \d+ \* \* 2$/, `${cron} is not Tuesday-only`);
});

test('both job conditions name the stall-check cron exactly as the schedule does', () => {
  // The digest job skips that firing and the watchdog runs on it, by comparing
  // strings. If the schedule moved and an `if:` did not, the stall check's
  // firing would start a paid digest run, and the watchdog would never run.
  const [stall] = crons(daily).filter(isStallCheck);
  assert.ok(daily.includes(`if: github.event.schedule != '${stall}'`), 'the digest job skips it');
  assert.ok(daily.includes(`if: github.event.schedule == '${stall}'`), 'the watchdog runs on it');
  assert.equal((daily.match(/github\.event\.schedule [!=]= '/g) ?? []).length, 2, 'no other cron comparison to keep in step');
});

test('the keepalive has its own daily schedule, and the digest no longer carries it', () => {
  // A week is the whole Supabase idle window, so the weekly digest cannot keep
  // the project awake; see the header of keepalive.yml.
  const schedule = crons(keepalive);
  assert.equal(schedule.length, 1);
  assert.match(schedule[0] ?? '', /^\d+ \d+ \* \* \*$/, 'daily');
  assert.match(keepalive, /run: bash scripts\/cpv-keepalive\.sh/);
  assert.doesNotMatch(daily, /cpv-keepalive\.sh/);
});
