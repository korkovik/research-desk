/**
 * Adapter registry — §10 (pluggable sources) and §9 (a dead source degrades).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdapterRegistration } from '../src/adapters/deps.js';
import {
  DEFAULT_SOURCES,
  adaptersForCategory,
  fetchCandidates,
  mergeCandidates,
  normaliseTitle,
} from '../src/adapters/registry.js';
import type { Candidate, CategoryConfig } from '../src/types.js';
import { HttpError } from '../src/util/http.js';
import { deps, jsonResponse, stubFetch, testConfig, testLogger } from './helpers.js';

const SINCE = '2026-08-12';

function category(key: string): CategoryConfig {
  const found = testConfig().categories.find((c) => c.key === key);
  assert.ok(found, `${key} must exist in config.json`);
  return found;
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'openalex:W1',
    title: 'Sleep and school start times',
    abstract: 'An abstract.',
    date: '2026-08-17',
    url: 'https://example.org/1',
    licence: 'cc-by',
    source: 'openalex',
    ...overrides,
  };
}

/**
 * A source this project does not have — the §10 test.
 *
 * It borrows the `arxiv` name because `SourceName` is a closed union in the
 * shared contract (types.ts: "Adding a source adds a member"). Adding a real
 * third source adds that member; nothing else changes, which is exactly what
 * this test asserts — the registration list is data, and no consumer of
 * `adaptersForCategory` / `fetchCandidates` knows how long it is.
 */
function hypotheticalSource(candidates: Candidate[], calls: string[] = []): AdapterRegistration {
  return {
    name: 'arxiv',
    appliesTo: () => true,
    create: () => ({
      name: 'arxiv',
      fetch: (cat, since) => {
        calls.push(`${cat.key}:${since}`);
        return Promise.resolve(candidates);
      },
    }),
  };
}

test('§5: OpenAlex runs every day, arXiv only on a category configured for it', () => {
  const stub = stubFetch(() => jsonResponse({ results: [] }));
  const d = deps({ fetchImpl: stub.impl });

  assert.deepEqual(
    adaptersForCategory(category('psychology-behaviour'), d).map((a) => a.name),
    ['openalex'],
  );
  assert.deepEqual(
    adaptersForCategory(category('ai-computing'), d).map((a) => a.name),
    ['openalex', 'arxiv'],
  );
  assert.equal(DEFAULT_SOURCES.length, 2, 'adding a source is one line here');
});

test('§10: a third source is one registration and flows through untouched', async () => {
  const calls: string[] = [];
  const extra = hypotheticalSource(
    [candidate({ id: 'hypo:1', title: 'A brand new source', source: 'arxiv' })],
    calls,
  );
  const stub = stubFetch(() => jsonResponse({ results: [] }));
  const d = deps({ fetchImpl: stub.impl });
  const psychology = category('psychology-behaviour');

  // The only difference from production is the registration list. No consumer
  // signature changes, no pipeline code changes.
  const adapters = adaptersForCategory(psychology, d, [...DEFAULT_SOURCES, extra]);
  assert.equal(adapters.length, 2, 'OpenAlex plus the newcomer; arXiv opts out of this category');

  const result = await fetchCandidates(psychology, SINCE, d, [...DEFAULT_SOURCES, extra]);
  assert.deepEqual(calls, [`psychology-behaviour:${SINCE}`], 'the newcomer got the day and window');
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ['hypo:1'],
  );
  assert.deepEqual(result.degradations, []);
});

test('§9: a failing source degrades the run, the others still produce candidates', async () => {
  const logger = testLogger();
  const stub = stubFetch(() => jsonResponse({ error: 'nope' }, 500));
  const good = hypotheticalSource([candidate({ id: 'hypo:1', source: 'arxiv' })]);

  const result = await fetchCandidates(category('psychology-behaviour'), SINCE, deps({ fetchImpl: stub.impl, logger }), [
    ...DEFAULT_SOURCES,
    good,
  ]);

  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ['hypo:1'],
  );
  assert.equal(result.degradations.length, 1);
  assert.equal(result.degradations[0]?.source, 'openalex');
  // The footer sentence names what the reader lost, not the API (DESIGN-NOTES D.4).
  assert.match(result.degradations[0]?.messageCs ?? '', /nebyla dostupná/);
  assert.ok(!(result.degradations[0]?.messageCs ?? '').includes('OpenAlex'));
  assert.notEqual(result.degradations[0]?.detail, '');
  assert.ok(logger.lines.some((l) => l.startsWith('error')));
});

test('§4.1: a rejected API key aborts the run instead of degrading it', async () => {
  const stub = stubFetch(() => jsonResponse({ error: 'Invalid or missing API key' }, 401));
  const d = deps({
    fetchImpl: stub.impl,
    secrets: { openAlexApiKey: 'wrong', semanticScholarApiKey: null, anthropicApiKey: null },
  });

  await assert.rejects(
    () => fetchCandidates(category('psychology-behaviour'), SINCE, d),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
});

test('the same paper from two sources is merged on DOI, richest record leading', () => {
  const preprint = candidate({
    id: 'arxiv:2608.1',
    source: 'arxiv',
    title: 'Faster sorting algorithms',
    abstract: null,
    doi: '10.1234/abc',
    isPreprint: true,
    oaPdfUrl: 'https://arxiv.org/pdf/2608.1',
    subfield: { id: 'arxiv:cs.LG', name: 'cs.LG' },
  });
  const published = candidate({
    id: 'openalex:W1',
    source: 'openalex',
    title: 'Faster sorting algorithms.',
    abstract: 'The published abstract.',
    doi: '10.1234/abc',
    openAlexId: 'W1',
    venue: 'Nature',
    citedByCount: 12,
    isPreprint: false,
    subfield: { id: 'subfields/1702', name: 'Artificial Intelligence' },
  });

  const merged = mergeCandidates([[preprint], [published]]);

  assert.equal(merged.length, 1, 'one paper, not two');
  const [paper] = merged;
  assert.ok(paper);
  assert.equal(paper.id, 'openalex:W1', 'the record with more metadata leads');
  assert.equal(paper.abstract, 'The published abstract.');
  assert.equal(paper.venue, 'Nature');
  assert.equal(paper.citedByCount, 12);
  assert.equal(paper.oaPdfUrl, 'https://arxiv.org/pdf/2608.1', 'gaps are filled from the other record');
  // §4.3 — if either source says preprint, the page must say "not peer reviewed".
  assert.equal(paper.isPreprint, true);
});

test('with no DOI to compare, a normalised title merges the duplicate', () => {
  const a = candidate({ id: 'arxiv:2608.2', source: 'arxiv', title: 'Don’t Drop the BATON: A Study', doi: null, isPreprint: true });
  const b = candidate({ id: 'openalex:W2', title: 'Dont drop the baton   a study!', doi: null, venue: 'ICML' });

  const merged = mergeCandidates([[a], [b]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.venue, 'ICML');
  assert.equal(merged[0]?.isPreprint, true);

  assert.equal(normaliseTitle('Don’t Drop the BATON: A Study'), 'dontdropthebatonastudy');
  assert.equal(normaliseTitle('Éléments — a survey'), 'elementsasurvey');
});

test('two different DOIs are two papers, however alike the titles', () => {
  const a = candidate({ id: 'openalex:W1', doi: '10.1234/abc' });
  const b = candidate({ id: 'openalex:W2', doi: '10.1234/xyz' });

  const merged = mergeCandidates([[a], [b]]);
  assert.equal(merged.length, 2);
});

test('merging keeps source order and is deterministic', () => {
  const openalex = [candidate({ id: 'openalex:W1', title: 'One' }), candidate({ id: 'openalex:W2', title: 'Two' })];
  const arxiv = [
    candidate({ id: 'arxiv:1', source: 'arxiv', title: 'Two', isPreprint: true }),
    candidate({ id: 'arxiv:2', source: 'arxiv', title: 'Three', isPreprint: true }),
  ];

  const first = mergeCandidates([openalex, arxiv]);
  const second = mergeCandidates([openalex, arxiv]);

  assert.deepEqual(first.map((c) => c.id), ['openalex:W1', 'openalex:W2', 'arxiv:2']);
  assert.deepEqual(first.map((c) => c.id), second.map((c) => c.id));
  assert.equal(first[1]?.isPreprint, true, 'the duplicate merged into its first position');
});

test('a retraction reported by either source survives the merge (§6)', () => {
  const clean = candidate({ id: 'openalex:W1', doi: '10.1/x', isRetracted: false, venue: 'Nature' });
  const flagged = candidate({ id: 'arxiv:1', source: 'arxiv', doi: '10.1/x', isRetracted: true });

  const [merged] = mergeCandidates([[clean], [flagged]]);
  assert.equal(merged?.isRetracted, true);
});

test('an empty list of sources produces an empty, well-formed result', async () => {
  const stub = stubFetch(() => jsonResponse({ results: [] }));
  const result = await fetchCandidates(category('psychology-behaviour'), SINCE, deps({ fetchImpl: stub.impl }), []);

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.degradations, []);
  assert.deepEqual(mergeCandidates([]), []);
});
