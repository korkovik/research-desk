/**
 * Semantic Scholar enrichment — §4.2, §9, §11 step 5. Offline throughout.
 *
 * The throttle is proven in simulated time: §11 step 5 wants 20 sequential
 * lookups spaced 1.1 s apart, and a suite that really slept for 22 s would be
 * a suite nobody runs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrichWithTldr, lookupKey, paperUrl } from '../src/enrich/semanticScholar.js';
import type { EnrichDeps } from '../src/enrich/semanticScholar.js';
import type { Candidate } from '../src/types.js';
import { deps, jsonFixture, jsonResponse, stubFetch, testConfig, testLogger } from './helpers.js';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'openalex:W1',
    title: 'A study of something',
    abstract: 'The candidate’s own abstract.',
    date: '2026-08-17',
    url: 'https://doi.org/10.1234/abc',
    licence: 'cc-by',
    source: 'openalex',
    doi: '10.1234/abc',
    ...overrides,
  };
}

/**
 * Simulated time. The clock starts at a real epoch on purpose: `Throttle` treats
 * `last === 0` as "nothing has departed yet", so a clock starting at zero would
 * skip the first gap and hide a missing sleep.
 */
function virtualClock(start = 1_780_000_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  elapsed: () => number;
  sleeps: number[];
} {
  let time = start;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
    elapsed: () => time - start,
    sleeps,
  };
}

function enrichDeps(overrides: Partial<EnrichDeps> & Pick<EnrichDeps, 'fetchImpl'>): EnrichDeps {
  const base = deps(overrides);
  return { ...base, ...(overrides.clock ? { clock: overrides.clock } : {}) };
}

const withTldr = jsonFixture('s2-paper-with-tldr.json');
const noTldr = jsonFixture('s2-paper-not-found.json');

test('§11 step 5: 20 lookups are sequential and span ≥ 19 × 1100 ms of simulated time', async () => {
  const clock = virtualClock();
  let inFlight = 0;
  let maxInFlight = 0;
  const stub = stubFetch(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight--;
    return jsonResponse(withTldr);
  });

  const candidates = Array.from({ length: 20 }, (_, i) =>
    candidate({ id: `openalex:W${i}`, doi: `10.1234/paper-${i}` }),
  );
  const { enriched, degradation } = await enrichWithTldr(
    candidates,
    enrichDeps({ fetchImpl: stub.impl, clock }),
  );

  const throttleMs = testConfig().sources.semanticScholar.throttleMs;
  assert.equal(throttleMs, 1100, '§4.2 fixes the gap at 1.1 s');
  assert.equal(stub.calls.length, 20);
  assert.equal(enriched.length, 20);
  assert.equal(degradation, null);
  assert.equal(maxInFlight, 1, 'requests must never overlap (§4.2: sequential, never parallel)');
  assert.equal(clock.sleeps.length, 19, 'the first request departs immediately');
  assert.ok(clock.sleeps.every((ms) => ms >= throttleMs));
  assert.ok(
    clock.elapsed() >= 19 * throttleMs,
    `expected ≥ ${19 * throttleMs} ms of simulated time, got ${clock.elapsed()}`,
  );
});

test('the tldr lands on the candidate and its own abstract is kept (§4.2)', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  const { enriched } = await enrichWithTldr(
    [candidate()],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  const [paper] = enriched;
  assert.ok(paper);
  assert.match(paper.tldr ?? '', /AlphaDev/);
  assert.equal(paper.abstract, 'The candidate’s own abstract.');
  assert.equal(paper.abstractSource, 'source');
  assert.equal(paper.enrichmentNote, undefined);
});

test('a null tldr falls back to the abstract and never drops the paper (§4.2)', async () => {
  const stub = stubFetch(() => jsonResponse(noTldr));
  const clock = virtualClock();

  // (a) the candidate has its own abstract — that one wins.
  const own = await enrichWithTldr([candidate()], enrichDeps({ fetchImpl: stub.impl, clock }));
  const [fromSource] = own.enriched;
  assert.ok(fromSource);
  assert.equal(fromSource.tldr, null);
  assert.equal(fromSource.abstract, 'The candidate’s own abstract.');
  assert.equal(fromSource.abstractSource, 'source');
  assert.match(fromSource.enrichmentNote ?? '', /no tldr/);

  // (b) neither side has anything — still returned, marked 'none'.
  const bare = await enrichWithTldr(
    [candidate({ abstract: null })],
    enrichDeps({ fetchImpl: stub.impl, clock }),
  );
  const [empty] = bare.enriched;
  assert.ok(empty);
  assert.equal(empty.abstract, null);
  assert.equal(empty.abstractSource, 'none');
  assert.equal(bare.enriched.length, 1, 'a paper without a tldr is not dropped');
});

test('S2’s abstract fills the gap when the discovery source had none', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  const { enriched } = await enrichWithTldr(
    [candidate({ abstract: null })],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  const [paper] = enriched;
  assert.ok(paper);
  assert.equal(paper.abstractSource, 'semantic-scholar');
  assert.match(paper.abstract ?? '', /sorting/);
});

test('a 404 is normal: the candidate comes back unenriched with a note, no throw', async () => {
  const stub = stubFetch(() => jsonResponse({ error: 'Paper not found' }, 404));
  const { enriched, degradation } = await enrichWithTldr(
    [candidate(), candidate({ id: 'openalex:W2', doi: '10.1234/def' })],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  assert.equal(enriched.length, 2, 'both papers survive a 404');
  assert.equal(degradation, null, 'a 404 is not a degradation');
  assert.equal(enriched[0]?.tldr, null);
  assert.match(enriched[0]?.enrichmentNote ?? '', /not known to Semantic Scholar/);
  assert.equal(enriched[0]?.abstract, 'The candidate’s own abstract.');
  assert.equal(stub.calls.length, 2, 'a 404 stops nothing');
});

test('§9: a 429 degrades the run instead of failing it, and stops further lookups', async () => {
  const stub = stubFetch((_url, call) =>
    call <= 1 ? jsonResponse(withTldr) : jsonResponse({ message: 'Too Many Requests' }, 429),
  );
  const logger = testLogger();
  const candidates = Array.from({ length: 6 }, (_, i) =>
    candidate({ id: `openalex:W${i}`, doi: `10.1234/paper-${i}` }),
  );

  const { enriched, degradation } = await enrichWithTldr(
    candidates,
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock(), logger }),
  );

  assert.equal(enriched.length, 6, 'every candidate is returned (§9)');
  assert.ok(degradation, 'the caller must be told');
  assert.equal(degradation.source, 'semantic-scholar');
  assert.notEqual(degradation.message.trim(), '');
  assert.match(degradation.detail, /429/);
  assert.match(enriched[0]?.tldr ?? '', /AlphaDev/, 'the lookup before the limit is kept');
  assert.ok(enriched.slice(2).every((c) => c.tldr === null));
  assert.ok(enriched.slice(2).every((c) => (c.enrichmentNote ?? '').includes('stopped earlier')));
  assert.ok(enriched.every((c) => c.abstract === 'The candidate’s own abstract.'));

  const retries = testConfig().http.retries;
  // 1 success + one attempt budget spent on the 429, then no further lookups.
  assert.equal(stub.calls.length, 1 + retries + 1);
  assert.ok(logger.lines.some((l) => l.startsWith('warn') && l.includes('stopping enrichment')));
});

test('§4.2: only the shortlist is enriched, however many candidates arrive', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  const config = testConfig();
  const candidates = Array.from({ length: 200 }, (_, i) =>
    candidate({ id: `openalex:W${i}`, doi: `10.1234/paper-${i}` }),
  );

  const { enriched } = await enrichWithTldr(
    candidates,
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock(), config }),
  );

  assert.equal(config.shortlist.size, 20);
  assert.equal(stub.calls.length, config.shortlist.size, 'the full candidate set is never enriched');
  assert.equal(enriched.length, 200, 'the others are returned untouched, not dropped');
  assert.match(enriched[199]?.enrichmentNote ?? '', /beyond the shortlist/);
});

test('arXiv candidates are looked up by arXiv id, DOI candidates by DOI', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  await enrichWithTldr(
    [
      candidate(),
      candidate({ id: 'arxiv:2608.16889', doi: null, source: 'arxiv' }),
      candidate({ id: 'openalex:W9', doi: null }),
    ],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  assert.equal(stub.calls.length, 2, 'a candidate with neither key is not looked up');
  assert.ok(stub.calls[0]?.url.includes('/paper/DOI:10.1234/abc?'));
  assert.ok(stub.calls[1]?.url.includes('/paper/arXiv:2608.16889?'));
  assert.ok(stub.calls[0]?.url.includes('fields=paperId,title,abstract,tldr'));
});

test('a candidate with no DOI and no arXiv id is returned with a note, not silently', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  const { enriched } = await enrichWithTldr(
    [candidate({ id: 'openalex:W9', doi: null })],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  assert.equal(enriched.length, 1);
  assert.match(enriched[0]?.enrichmentNote ?? '', /no DOI and no arXiv id/);
});

test('the S2 key travels in a header, never in the URL', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  await enrichWithTldr(
    [candidate()],
    enrichDeps({
      fetchImpl: stub.impl,
      clock: virtualClock(),
      secrets: { openAlexApiKey: null, semanticScholarApiKey: 's2-secret', anthropicApiKey: null },
    }),
  );

  assert.equal(stub.calls[0]?.headers['x-api-key'], 's2-secret');
  assert.ok(!(stub.calls[0]?.url ?? '').includes('s2-secret'));
});

test('S2 only fills gaps: a DOI, a PDF link or a venue the discovery source lacked', async () => {
  const stub = stubFetch(() => jsonResponse(withTldr));
  const { enriched } = await enrichWithTldr(
    [candidate({ id: 'arxiv:2608.16889', doi: null, source: 'arxiv', venue: null, oaPdfUrl: null })],
    enrichDeps({ fetchImpl: stub.impl, clock: virtualClock() }),
  );

  const [paper] = enriched;
  assert.ok(paper);
  assert.equal(paper.doi, '10.1038/s41586-023-06004-9');
  assert.equal(paper.venue, 'Nature');
  assert.match(paper.oaPdfUrl ?? '', /^https:\/\/www\.nature\.com\//);
  assert.equal(paper.isOpenAccess, true);
});

test('lookup keys and URLs are built safely', () => {
  assert.equal(lookupKey(candidate()), 'DOI:10.1234/abc');
  assert.equal(lookupKey(candidate({ doi: null, id: 'arxiv:2608.1' })), 'arXiv:2608.1');
  assert.equal(lookupKey(candidate({ doi: '  ', id: 'openalex:W1' })), null);

  const url = paperUrl('https://api.semanticscholar.org/graph/v1/', 'DOI:10.1234/a b#c');
  assert.ok(url.startsWith('https://api.semanticscholar.org/graph/v1/paper/DOI:10.1234/a'));
  assert.ok(!url.includes(' '), 'a space in a DOI must not break the path');
  assert.ok(!url.includes('#'), 'a # in a DOI must not truncate the request');
});
