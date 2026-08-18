/**
 * §11 step 10 — "two consecutive real runs produce two pages, no repeated
 * papers between them, log lines written for both" — as far as it can be
 * proven without live APIs. Everything except the three HTTP endpoints and the
 * two Claude calls is the real production code path.
 *
 * What this does NOT prove is in docs/HANDOVER.md: the sources are fixtures, so
 * a change in a real API's shape would not be caught here, and the model is a
 * stub, so nothing about the quality of the real Czech is tested.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/util/log.js';
import { runDay } from '../src/run.js';
import type { DayDigest } from '../src/types.js';
import { HonestLlm, makeFetchImpl, makeWorkspace, type FetchLog } from './support/pipelineHarness.js';
import type { LlmClient, LlmRequest, LlmResult } from '../src/summarise/client.js';

const NO_SECRETS = { openAlexApiKey: null, semanticScholarApiKey: null, anthropicApiKey: null };
const quiet = () => createLogger(() => {});

/**
 * §4.2's throttle really waits 1.1 s between Semantic Scholar requests, which is
 * 22 seconds for a shortlist of twenty. Simulated time here; the gap itself is
 * asserted for real in test/semanticScholar.test.ts.
 */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function runOn(root: string, date: string, workCount = 25) {
  const log: FetchLog = { urls: [] };
  return {
    log,
    promise: runDay({
      repoRoot: root,
      config: loadConfig(root),
      secrets: NO_SECRETS,
      logger: quiet(),
      dryRun: false,
      date,
      llm: new HonestLlm(),
      fetchImpl: makeFetchImpl(date, log, workCount),
      clock: fakeClock(),
    }),
  };
}

test('S11-10-OFF: two consecutive runs publish two pages with no paper repeated', async () => {
  const root = makeWorkspace();
  const config = loadConfig(root);

  const first = await runOn(root, '2026-08-19').promise;
  const second = await runOn(root, '2026-08-20').promise;

  assert.equal(first.outcome === 'aborted', false, 'first run aborted');
  assert.equal(second.outcome === 'aborted', false, 'second run aborted');

  for (const date of ['2026-08-19', '2026-08-20']) {
    assert.ok(existsSync(join(root, 'archive', `${date}.html`)), `${date}.html missing`);
    assert.ok(existsSync(join(root, 'archive', `${date}.json`)), `${date}.json missing`);
  }
  assert.ok(existsSync(join(root, 'index.html')));

  // §8 dedup: a paper never appears twice. Both runs are served the same pool,
  // so any leak would show up immediately.
  const idsOf = (digest: DayDigest | null): string[] =>
    (digest?.entries ?? []).map((e) => e.candidate.id);
  const firstIds = idsOf(first.digest);
  const secondIds = idsOf(second.digest);
  assert.ok(firstIds.length >= config.output.minPapersToPublish, `day 1 had ${firstIds.length} papers`);
  assert.ok(secondIds.length >= config.output.minPapersToPublish, `day 2 had ${secondIds.length} papers`);
  const overlap = firstIds.filter((id) => secondIds.includes(id));
  assert.deepEqual(overlap, [], `the same paper appeared on both days: ${overlap.join(', ')}`);

  // §9: one line per run, both of them.
  const runLog = readFileSync(join(root, 'logs', 'run.log'), 'utf8').trim().split('\n');
  assert.equal(runLog.length, 2);
  const parsed = runLog.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    parsed.map((l) => l.runId),
    ['2026-08-19', '2026-08-20'],
  );
  for (const line of parsed) {
    assert.ok(typeof line.summary === 'string' && line.summary.length > 0);
    assert.ok(['published', 'published_degraded'].includes(line.outcome as string));
  }
});

test('S11-10-OFF: the index lists both days, newest first', async () => {
  const root = makeWorkspace();
  await runOn(root, '2026-08-19').promise;
  await runOn(root, '2026-08-20').promise;
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(index.includes('2026-08-19'), 'index is missing day 1');
  assert.ok(index.includes('2026-08-20'), 'index is missing day 2');
  assert.ok(
    index.indexOf('2026-08-20') < index.indexOf('2026-08-19'),
    'the index is not reverse-chronological',
  );
});

test('the published page is self-contained: nothing it loads comes off the machine', async () => {
  const root = makeWorkspace();
  await runOn(root, '2026-08-19').promise;
  const html = readFileSync(join(root, 'archive', '2026-08-19.html'), 'utf8');

  // A link the reader may CLICK is required by §7.6; a sub-resource the page
  // LOADS is forbidden by §8. Strip the anchors, then nothing remote may remain.
  const withoutAnchors = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<a\b[^>]*>/gi, '');
  assert.equal(/https?:\/\//.test(withoutAnchors), false, 'a remote URL survives outside an anchor');
  for (const forbidden of [/<link\b/i, /<script\b[^>]*\bsrc=/i, /<img\b/i, /@import/i, /url\(/i, /localStorage/]) {
    assert.equal(forbidden.test(html), false, `page contains ${String(forbidden)}`);
  }
  assert.ok(html.includes('name="viewport"'), 'no viewport meta — the page must read on a phone');
});

test('§9: below the minimum, nothing is written and yesterday\'s index is untouched', async () => {
  const root = makeWorkspace();
  await runOn(root, '2026-08-19').promise;
  const indexBefore = readFileSync(join(root, 'index.html'), 'utf8');
  const mtimeBefore = statSync(join(root, 'index.html')).mtimeMs;

  // Two candidates in the pool is below `minPapersToPublish`.
  const starved = await runOn(root, '2026-08-21', 2).promise;

  assert.equal(starved.outcome, 'aborted');
  assert.equal(starved.exitCode, 1, 'a quiet day is an expected abort, not a broken one');
  assert.equal(existsSync(join(root, 'archive', '2026-08-21.html')), false, 'wrote a page anyway');
  assert.equal(existsSync(join(root, 'archive', '2026-08-21.json')), false, 'wrote a twin anyway');
  assert.equal(readFileSync(join(root, 'index.html'), 'utf8'), indexBefore, 'index content changed');
  assert.equal(statSync(join(root, 'index.html')).mtimeMs, mtimeBefore, 'index was rewritten');

  // §9 still wants the failure recorded.
  const lines = readFileSync(join(root, 'logs', 'run.log'), 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
  assert.equal(last.outcome, 'aborted');
  assert.equal(last.level, 'FATAL');
});

test('§9: a failed run does not burn its candidates', async () => {
  const root = makeWorkspace();
  const starved = await runOn(root, '2026-08-19', 2).promise;
  assert.equal(starved.outcome, 'aborted');
  // seen.json must still be absent or empty: papers a run never published stay
  // available tomorrow (D.3's commit ordering).
  const seenPath = join(root, 'state', 'seen.json');
  if (existsSync(seenPath)) {
    const seen = JSON.parse(readFileSync(seenPath, 'utf8')) as { entries: unknown[] };
    assert.deepEqual(seen.entries, []);
  }
  // And the same pool publishes fine the next day.
  const recovered = await runOn(root, '2026-08-20').promise;
  assert.notEqual(recovered.outcome, 'aborted');
});

test('a dry run reads everything and writes nothing', async () => {
  const root = makeWorkspace();
  const result = await runDay({
    repoRoot: root,
    config: loadConfig(root),
    secrets: NO_SECRETS,
    logger: quiet(),
    dryRun: true,
    date: '2026-08-19',
    llm: new HonestLlm(),
    fetchImpl: makeFetchImpl('2026-08-19', { urls: [] }),
    clock: fakeClock(),
  });
  assert.notEqual(result.outcome, 'aborted');
  assert.ok((result.digest?.entries.length ?? 0) >= 3);
  assert.equal(existsSync(join(root, 'archive', '2026-08-19.html')), false);
  assert.equal(existsSync(join(root, 'index.html')), false);
  assert.equal(existsSync(join(root, 'logs', 'run.log')), false);
  assert.equal(existsSync(join(root, 'state', 'seen.json')), false);
});

test('the JSON twin carries everything a later pass would need', async () => {
  const root = makeWorkspace();
  await runOn(root, '2026-08-19').promise;
  const twin = JSON.parse(readFileSync(join(root, 'archive', '2026-08-19.json'), 'utf8')) as DayDigest;

  assert.equal(twin.schemaVersion, 1);
  assert.equal(twin.language, 'cs');
  assert.ok(twin.categoryLabel.length > 0);
  for (const entry of twin.entries) {
    assert.ok(entry.candidate.id.length > 0);
    assert.ok(entry.candidate.date.length > 0);
    assert.ok(entry.candidate.score.total > 0, 'no score recorded');
    for (const block of [
      entry.summary.nadpis,
      entry.summary.oCoJde,
      entry.summary.podrobneVysvetleni,
      entry.summary.prikladZeZivota,
      entry.summary.procJeToDulezite,
      entry.summary.poznamkaKOmezenim,
    ]) {
      assert.ok(block.trim().length > 0, 'an empty §7 block reached the archive');
    }
    // §11 step 8: every rejection is on the record, and so is the verdict.
    assert.equal(entry.verification.verdict, 'supported');
    assert.ok(Array.isArray(entry.verification.rejections));
  }
});

test('§6: the day\'s five are not all from one subfield', async () => {
  const root = makeWorkspace();
  const result = await runOn(root, '2026-08-19').promise;
  const config = loadConfig(root);
  const counts = new Map<string, number>();
  for (const entry of result.digest?.entries ?? []) {
    const key = entry.candidate.score.subfieldKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    assert.ok(
      count <= config.ranking.maxPerSubfield,
      `${count} papers from ${key}, cap is ${config.ranking.maxPerSubfield}`,
    );
  }
});

test('§6: a top-up after a dropped paper still respects the diversity cap', async () => {
  const root = makeWorkspace();
  const config = loadConfig(root);

  // A model that refuses to verify the first few papers it is asked about, so
  // the run has to reach into the ranked remainder for replacements. Composed
  // around HonestLlm rather than subclassing it — the generic signature of
  // `complete` does not survive an override.
  const honest = new HonestLlm();
  let verifications = 0;
  const refuseFirstFew: LlmClient = {
    complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      if (request.label.startsWith('verify-example')) {
        verifications += 1;
        if (verifications <= 6) {
          return Promise.resolve({
            value: {
              claims: [
                {
                  id: 'c1',
                  claimText: 'Nothing here is in the source',
                  claimType: 'other',
                  exampleSpan: 'Představte si běžný týden ve škole.',
                  verdict: 'unsupported',
                  sourceQuote: null,
                  quoteField: null,
                },
              ],
              modelOverallVerdict: 'unsupported',
              unsupportedReasonsCs: ['Ve zdroji to není.'],
            } as T,
            usage: honest.totalUsage(),
          });
        }
      }
      return honest.complete(request);
    },
    totalUsage: () => honest.totalUsage(),
  };

  const result = await runDay({
    repoRoot: root,
    config,
    secrets: NO_SECRETS,
    logger: quiet(),
    dryRun: true,
    date: '2026-08-19',
    llm: refuseFirstFew,
    fetchImpl: makeFetchImpl('2026-08-19', { urls: [] }),
    clock: fakeClock(),
  });

  const counts = new Map<string, number>();
  for (const entry of result.digest?.entries ?? []) {
    const key = entry.candidate.score.subfieldKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    assert.ok(
      count <= config.ranking.maxPerSubfield,
      `a top-up pushed ${key} to ${count}, over the cap of ${config.ranking.maxPerSubfield}`,
    );
  }
});

test('a run with no Anthropic key stops before it spends anything', async () => {
  const root = makeWorkspace();
  const log: FetchLog = { urls: [] };
  await assert.rejects(
    runDay({
      repoRoot: root,
      config: loadConfig(root),
      secrets: NO_SECRETS,
      logger: quiet(),
      dryRun: true,
      date: '2026-08-19',
      // No `llm` injected: the real client is built, and there is no key.
      fetchImpl: makeFetchImpl('2026-08-19', log),
      clock: fakeClock(),
    }),
    /ANTHROPIC_API_KEY is not set/,
  );
  // The point of failing early: no OpenAlex credit and no Semantic Scholar
  // pacing was spent finding out.
  assert.deepEqual(log.urls, []);
});
