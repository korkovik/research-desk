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
import { assertNoRemoteResources } from '../src/render/archive.js';
import { passesExplainabilityGate } from '../src/select/score.js';
import type { DayDigest } from '../src/types.js';
import {
  HonestLlm,
  makeFetchImpl,
  makeWorkspace,
  type FetchLog,
  type FixtureName,
} from './support/pipelineHarness.js';
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

function runOn(root: string, date: string, workCount = 25, fixture: FixtureName = 'psychology') {
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
      fetchImpl: makeFetchImpl(date, log, workCount, fixture),
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
    callCount: () => honest.callCount(),
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
    // The other half of the same rule: the ranked remainder contains the papers
    // the explainability gate turned away, and a slot coming free is not a
    // reason to admit one.
    assert.ok(
      passesExplainabilityGate(entry.candidate, config.ranking.explainabilityGate),
      `${entry.candidate.id} was published below the explainability gate`,
    );
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

test('§9: the per-run call budget stops the day rather than spending on', async () => {
  const root = makeWorkspace();
  const config = loadConfig(root);
  const tight = { ...config, anthropic: { maxCallsPerRun: 4 } };

  const result = await runDay({
    repoRoot: root,
    config: tight,
    secrets: NO_SECRETS,
    logger: quiet(),
    dryRun: true,
    date: '2026-08-19',
    llm: new HonestLlm(),
    fetchImpl: makeFetchImpl('2026-08-19', { urls: [] }),
    clock: fakeClock(),
  });

  // Three calls per paper, so a budget of four buys one paper and stops. That
  // is below the minimum, so the day publishes nothing — and says why.
  assert.equal(result.outcome, 'aborted');
  assert.ok((result.digest?.entries.length ?? 0) < config.output.papersPerDay);
});

test('a page that would load something off the machine is refused at write time', () => {
  // §11 step 9 is an acceptance check, so it is enforced where the file is
  // written, not only in the test suite.
  assert.throws(
    () => assertNoRemoteResources('<p>ok</p><link rel="stylesheet" href="/x.css">', 'page.html'),
    /forbids/,
  );
  assert.throws(
    () => assertNoRemoteResources('<style>body{background:url(https://x/y.png)}</style>', 'page.html'),
    /forbids/,
  );
  assert.throws(
    () => assertNoRemoteResources('<div style="background-image:url(https://x/y.png)"></div>', 'p.html'),
    /forbids/,
  );
  // A URL in running text is not a resource — see the prose test below.
  assert.doesNotThrow(() => assertNoRemoteResources('<p>see https://example.org/paper</p>', 'p.html'));
  // …and a link the reader clicks is required by §7.6 and must pass.
  assert.doesNotThrow(() =>
    assertNoRemoteResources('<a href="https://doi.org/10.1/2">10.1/2</a>', 'page.html'),
  );
});

test('a URL in prose does not abort the day — it loads nothing (§8 vs §7.6)', () => {
  // Abstracts carry data-availability statements and summaries restate them.
  // The scan looks at markup and at the stylesheet, never at running text.
  const page =
    '<style>body{color:#111}</style>' +
    '<p>Data jsou veřejně dostupná na https://osf.io/ab12c a autoři je zpřístupnili všem.</p>';
  assert.doesNotThrow(() => assertNoRemoteResources(page, 'page.html'));

  // …while a real sub-resource in an attribute still stops the write.
  assert.throws(
    () => assertNoRemoteResources('<div style="background:url(https://x/y.png)"></div>', 'p.html'),
    /forbids/,
  );
});

test('§8: a second run for a day already published is refused, not silently replaced', async () => {
  const root = makeWorkspace();
  const first = await runOn(root, '2026-08-19').promise;
  assert.notEqual(first.outcome, 'aborted');
  const pageBefore = readFileSync(join(root, 'archive', '2026-08-19.html'), 'utf8');
  const seenBefore = readFileSync(join(root, 'state', 'seen.json'), 'utf8');

  // The first run recorded its papers, so a second would exclude them, pick
  // different ones, and overwrite a good edition with a thinner one.
  const second = await runOn(root, '2026-08-19').promise;
  assert.equal(second.outcome, 'aborted');
  assert.equal(second.exitCode, 1);
  assert.equal(readFileSync(join(root, 'archive', '2026-08-19.html'), 'utf8'), pageBefore);
  assert.equal(readFileSync(join(root, 'state', 'seen.json'), 'utf8'), seenBefore);

  // …and the refusal is still a run, so it leaves a line in the log §9 requires.
  const lines = readFileSync(join(root, 'logs', 'run.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
});

test('a healthy day publishes the full five with no shortfall and no degradation', async () => {
  // The psychology fixture contains two real duplicate pairs, so once they are
  // collapsed it cannot fill five slots — which means no test on it can guard
  // the ordinary, everything-worked path. This one runs on the climate capture:
  // 40 records, 40 distinct titles, 14 subfields.
  const root = makeWorkspace();
  const config = loadConfig(root);
  const result = await runOn(root, '2026-08-19', 40, 'climate').promise;

  assert.equal(result.outcome, 'published', 'a healthy day should not be degraded');
  assert.equal(result.digest?.entries.length, config.output.papersPerDay);
  assert.equal(result.digest?.shortfall, null);
  assert.deepEqual(result.digest?.degradations, []);

  // …and §6's constraint still holds on a real, varied pool.
  const counts = new Map<string, number>();
  for (const entry of result.digest?.entries ?? []) {
    const key = entry.candidate.score.subfieldKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    assert.ok(count <= config.ranking.maxPerSubfield, `${count} papers from ${key}`);
  }
});

test('--discover-only stops after selection, writes nothing, needs no Anthropic key', async () => {
  const root = makeWorkspace();
  const log: FetchLog = { urls: [] };
  const result = await runDay({
    repoRoot: root,
    config: loadConfig(root),
    secrets: NO_SECRETS, // no Anthropic key at all
    logger: quiet(),
    dryRun: false,
    date: '2026-08-19',
    discoverOnly: true,
    fetchImpl: makeFetchImpl('2026-08-19', log, 40, 'climate'),
    clock: fakeClock(),
  });

  // It reached the sources, so selection really ran…
  assert.ok(log.urls.some((u) => u.includes('api.openalex.org')));
  // …and it stopped before anything that costs Claude tokens or writes a file.
  assert.equal(result.outcome, 'aborted');
  assert.equal(result.exitCode, 0, 'discover-only is not a failure');
  assert.equal(result.digest, null);
  assert.equal(existsSync(join(root, 'archive', '2026-08-19.html')), false);
  assert.equal(existsSync(join(root, 'state', 'seen.json')), false);
  // The run is still on the record.
  assert.ok(readFileSync(join(root, 'logs', 'run.log'), 'utf8').includes('discover-only'));
});
