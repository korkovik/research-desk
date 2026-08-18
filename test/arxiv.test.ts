/**
 * arXiv adapter — §4.3, §11 step 4. Offline, against a real captured Atom feed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arxivIdFromUrl, buildQueryUrl, createArxivAdapter, entryToCandidate, parseFeed } from '../src/adapters/arxiv.js';
import type { CategoryConfig } from '../src/types.js';
import { isISODate } from '../src/util/dates.js';
import { HttpError } from '../src/util/http.js';
import { deps, fixture, stubFetch, testConfig, textResponse } from './helpers.js';

const FEED = 'arxiv-cs-ai.xml';
const SINCE = '2026-08-11';
/** The instant the fixture was captured, so the generated window is assertable. */
const CAPTURED_AT = new Date('2026-08-18T22:54:00Z');

function aiCategory(): CategoryConfig {
  const category = testConfig().categories.find((c) => c.key === 'ai-computing');
  assert.ok(category, 'ai-computing must exist in config.json');
  return category;
}

function adapterOverFixture(): ReturnType<typeof createArxivAdapter> {
  const stub = stubFetch(() => textResponse(fixture(FEED)));
  return createArxivAdapter(deps({ fetchImpl: stub.impl, now: () => CAPTURED_AT }));
}

test('§11 step 4: the captured cs.AI feed yields ≥10 candidates on the §10 contract', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  assert.ok(candidates.length >= 10, `expected ≥10 candidates, got ${candidates.length}`);
  assert.equal(candidates.length, 25, 'the fixture has 25 entries and none should be dropped');
  for (const candidate of candidates) {
    assert.notEqual(candidate.title.trim(), '');
    assert.ok(candidate.abstract !== null && candidate.abstract.trim() !== '');
    assert.ok(isISODate(candidate.date), `bad date ${candidate.date}`);
    assert.match(candidate.url, /^https:\/\/arxiv\.org\/abs\//);
    assert.equal(candidate.source, 'arxiv');
    assert.ok(candidate.id.startsWith('arxiv:'));
    // §4.3 — never `undefined`: the renderer must be able to state the licence.
    assert.equal(typeof candidate.licence, 'string');
  }
});

test('§4.3: every arXiv candidate is a preprint and an open-access one', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  assert.ok(candidates.every((c) => c.isPreprint === true), 'isPreprint must be true for all');
  assert.ok(candidates.every((c) => c.isOpenAccess === true));
  assert.ok(candidates.every((c) => c.licence === 'arxiv-nonexclusive'));
  assert.ok(candidates.every((c) => c.venue === 'arXiv'));
  assert.ok(candidates.every((c) => (c.oaPdfUrl ?? '').includes('/pdf/')), 'the PDF link is captured');
});

test('one author and many authors both parse (the feed uses one or many <author> elements)', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  const single = candidates.filter((c) => (c.authors?.length ?? 0) === 1);
  const many = candidates.filter((c) => (c.authors?.length ?? 0) > 1);
  assert.ok(single.length >= 1, 'the fixture contains single-author entries');
  assert.ok(many.length >= 1, 'the fixture contains multi-author entries');
  assert.ok(candidates.every((c) => (c.authors?.length ?? 0) >= 1), 'no entry loses its authors');
  // An author element carrying an affiliation is an object, not a string.
  const withAffiliation = candidates.find((c) => c.id === 'arxiv:2608.16804');
  assert.deepEqual(withAffiliation?.authors, [
    'Keren Artiaga',
    'Yang Li',
    'Ercan Engin Kuruoglu',
    'Wai Kin',
    'Chan',
  ]);
});

test('§6 diversity has a key: subfield comes from the arXiv primary category', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  assert.ok(candidates.every((c) => c.subfield !== null && c.subfield !== undefined));
  for (const candidate of candidates) {
    assert.match(candidate.subfield?.id ?? '', /^arxiv:[a-z-]+\.[A-Z]{2}$/);
    assert.equal(candidate.subfield?.id, `arxiv:${candidate.subfield?.name ?? ''}`);
  }
  // A cross-listed entry keeps its own primary category, not the queried one.
  const crossListed = candidates.find((c) => c.id === 'arxiv:2608.16834');
  assert.equal(crossListed?.subfield?.id, 'arxiv:cs.CL');
});

test('titles and abstracts are collapsed to one line for the HTML', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  for (const candidate of candidates) {
    assert.ok(!/\n/.test(candidate.title), `newline left in title of ${candidate.id}`);
    assert.ok(!/\s{2}/.test(candidate.title));
    assert.ok(!/\n/.test(candidate.abstract ?? ''), `newline left in abstract of ${candidate.id}`);
  }
});

test('a DOI is captured when the preprint has already been published', async () => {
  const candidates = await adapterOverFixture().fetch(aiCategory(), SINCE);

  const published = candidates.find((c) => c.id === 'arxiv:2608.16804');
  assert.equal(published?.doi, '10.1007/s11042-023-16703-0');
  // Everything else in the fixture legitimately has no DOI — never `undefined`.
  assert.ok(candidates.every((c) => c.doi === null || typeof c.doi === 'string'));
});

test('the query asks for the configured categories and the §3 date window', () => {
  const url = buildQueryUrl(
    deps({ fetchImpl: stubFetch(() => textResponse('')).impl, now: () => CAPTURED_AT }),
    aiCategory(),
    SINCE,
  );
  const decoded = decodeURIComponent(url.replace(/\+/g, ' '));

  assert.ok(decoded.includes('cat:cs.AI OR cat:cs.LG'));
  assert.ok(decoded.includes('submittedDate:[202608110000 TO 202608182254]'));
  assert.ok(decoded.includes('sortBy=submittedDate'));
  assert.ok(decoded.includes('sortOrder=descending'));
  assert.ok(decoded.includes(`max_results=${testConfig().sources.arxiv.maxResults}`));
});

test('one query per run — arXiv is asked once, not paginated', async () => {
  const stub = stubFetch(() => textResponse(fixture(FEED)));
  await createArxivAdapter(deps({ fetchImpl: stub.impl, now: () => CAPTURED_AT })).fetch(aiCategory(), SINCE);
  assert.equal(stub.calls.length, 1);
});

test('a category with no arXiv block is never queried (§5)', async () => {
  const stub = stubFetch(() => textResponse(fixture(FEED)));
  const psychology = testConfig().categories.find((c) => c.key === 'psychology-behaviour');
  assert.ok(psychology);

  const candidates = await createArxivAdapter(deps({ fetchImpl: stub.impl })).fetch(psychology, SINCE);
  assert.deepEqual(candidates, []);
  assert.equal(stub.calls.length, 0);
});

test('truncated XML raises a typed error rather than crashing', async () => {
  const truncated = fixture(FEED).slice(0, 4000);
  const stub = stubFetch(() => textResponse(truncated));
  const adapter = createArxivAdapter(deps({ fetchImpl: stub.impl, now: () => CAPTURED_AT }));

  await assert.rejects(
    () => adapter.fetch(aiCategory(), SINCE),
    (error: unknown) => error instanceof HttpError,
  );
  assert.throws(() => parseFeed('not xml at all <<<', 'test://feed'), HttpError);
});

test('an empty feed is not an error — it is a day with nothing new', () => {
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query</title></feed>`;
  assert.deepEqual(parseFeed(empty, 'test://feed'), []);
});

test('entries that cannot meet the §10 contract are dropped, not half-built', () => {
  assert.equal(entryToCandidate({ id: 'http://arxiv.org/abs/1', title: 'x' }), null);
  assert.equal(entryToCandidate({ title: 'no id', published: '2026-08-17T00:00:00Z' }), null);
  assert.equal(entryToCandidate('nonsense'), null);
});

test('arXiv ids drop the version so v1 and v2 dedup to one paper (§8)', () => {
  assert.equal(arxivIdFromUrl('http://arxiv.org/abs/2608.16889v1'), '2608.16889');
  assert.equal(arxivIdFromUrl('https://arxiv.org/abs/2608.16889v12'), '2608.16889');
  assert.equal(arxivIdFromUrl('http://arxiv.org/abs/cs/0701001v1'), 'cs/0701001');
  assert.equal(arxivIdFromUrl(null), null);
});
