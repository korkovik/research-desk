/**
 * OpenAlex adapter — §4.1, §11 step 2.
 *
 * Offline throughout. The fixture is a real captured `/works` response, so
 * "parses the fixture" means "parses what OpenAlex actually sent".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bareDoi,
  buildWorksUrl,
  createOpenAlexAdapter,
  reconstructAbstract,
  workToCandidate,
} from '../src/adapters/openalex.js';
import type { CategoryConfig } from '../src/types.js';
import { HttpError } from '../src/util/http.js';
import { isISODate } from '../src/util/dates.js';
import { deps, jsonFixture, jsonResponse, stubFetch, testConfig, testLogger } from './helpers.js';

const FIXTURE = 'openalex-works-psychology.json';
const SINCE = '2026-08-12';

function psychology(): CategoryConfig {
  const category = testConfig().categories.find((c) => c.key === 'psychology-behaviour');
  assert.ok(category, 'psychology-behaviour must exist in config.json');
  return category;
}

function fixturePage(): { results: unknown[] } {
  const body = jsonFixture(FIXTURE);
  assert.ok(typeof body === 'object' && body !== null && 'results' in body);
  const results = (body as { results: unknown[] }).results;
  return { results };
}

test('§11 step 2: the captured response yields ≥10 candidates with title, DOI and date', async () => {
  const stub = stubFetch(() => jsonResponse(fixturePage()));
  const adapter = createOpenAlexAdapter(deps({ fetchImpl: stub.impl }));

  const candidates = await adapter.fetch(psychology(), SINCE);

  assert.ok(candidates.length >= 10, `expected ≥10 candidates, got ${candidates.length}`);
  for (const candidate of candidates) {
    assert.notEqual(candidate.title.trim(), '', `empty title on ${candidate.id}`);
    assert.ok(isISODate(candidate.date), `bad date ${candidate.date} on ${candidate.id}`);
    assert.equal(candidate.source, 'openalex');
    assert.ok(candidate.id.startsWith('openalex:W'));
    assert.ok(candidate.url.startsWith('http'));
  }
  const withDoi = candidates.filter((c) => c.doi !== null && /^10\.\d{4,9}\//.test(c.doi ?? ''));
  assert.ok(withDoi.length >= 10, `expected ≥10 candidates with a bare DOI, got ${withDoi.length}`);
});

test('normalises the §10 contract fields off a real record', async () => {
  const stub = stubFetch(() => jsonResponse(fixturePage()));
  const adapter = createOpenAlexAdapter(deps({ fetchImpl: stub.impl }));

  const candidates = await adapter.fetch(psychology(), SINCE);
  const thesis = candidates.find((c) => c.id === 'openalex:W7148641158');
  assert.ok(thesis, 'expected the embargoed-thesis record from the fixture');

  assert.equal(thesis.doi, '10.14288/1.0451736');
  assert.equal(thesis.openAlexId, 'W7148641158');
  assert.equal(thesis.date, '2027-01-01');
  assert.equal(thesis.isPreprint, false);
  assert.equal(thesis.sourceType, 'article', 'the selector needs the work type verbatim');
  assert.equal(thesis.isRetracted, false);
  // Hand-checked against the fixture's inverted index.
  assert.equal(
    thesis.abstract,
    'The full abstract for this thesis is available in the body of the thesis, and will be available when the embargo expires.',
  );
});

test('subfield, field and topic are bare OpenAlex ids so §6 can key diversity on them', async () => {
  const stub = stubFetch(() => jsonResponse(fixturePage()));
  const adapter = createOpenAlexAdapter(deps({ fetchImpl: stub.impl }));

  const candidates = await adapter.fetch(psychology(), SINCE);
  const withSubfield = candidates.filter((c) => c.subfield);
  assert.ok(withSubfield.length >= 10);
  for (const candidate of withSubfield) {
    assert.match(candidate.subfield?.id ?? '', /^subfields\/\d+$/);
    assert.notEqual(candidate.subfield?.name, '');
  }
});

test('reconstructs an inverted abstract, including gaps and duplicate positions', () => {
  assert.equal(reconstructAbstract({ we: [0], tested: [1], it: [2] }), 'we tested it');

  // A gap: position 2 was withheld. The words either side must still join with a
  // single space rather than leaving a hole or an empty token.
  assert.equal(reconstructAbstract({ a: [0], b: [1], d: [3] }), 'a b d');

  // The same word in several places, and two words claiming one position — the
  // first writer wins so the output cannot depend on key iteration luck.
  assert.equal(reconstructAbstract({ the: [0, 2], cat: [1], hat: [3], top: [3] }), 'the cat the hat');

  // Junk positions are ignored rather than allocating or throwing.
  assert.equal(reconstructAbstract({ x: [-1], y: [1.5], z: [0] }), 'z');
  assert.equal(reconstructAbstract({}), null);
  assert.equal(reconstructAbstract(null), null);
  assert.equal(reconstructAbstract(undefined), null);
});

test('a retracted or abstract-less work is flagged, not silently dropped (§6 is the selector’s job)', () => {
  const [first] = fixturePage().results;
  assert.ok(first && typeof first === 'object');
  const base = first as Record<string, unknown>;

  const retracted = workToCandidate({ ...base, is_retracted: true });
  assert.ok(retracted);
  assert.equal(retracted.isRetracted, true);

  const noAbstract = workToCandidate({ ...base, abstract_inverted_index: null });
  assert.ok(noAbstract);
  assert.equal(noAbstract.abstract, null);

  // What is dropped: a record that cannot satisfy the seven-field contract.
  assert.equal(workToCandidate({ ...base, title: '', display_name: null }), null);
  assert.equal(workToCandidate({ ...base, publication_date: 'not-a-date' }), null);
  assert.equal(workToCandidate({ ...base, id: null }), null);
  assert.equal(workToCandidate('nonsense'), null);
});

test('the bearer header is sent when a key is configured, and no auth header when it is not', async () => {
  const keyed = stubFetch(() => jsonResponse({ results: [] }));
  await createOpenAlexAdapter(
    deps({
      fetchImpl: keyed.impl,
      secrets: { openAlexApiKey: 'oa-secret-key', semanticScholarApiKey: null, anthropicApiKey: null },
    }),
  ).fetch(psychology(), SINCE);
  assert.equal(keyed.calls[0]?.headers['Authorization'], 'Bearer oa-secret-key');

  const unkeyed = stubFetch(() => jsonResponse({ results: [] }));
  const logger = testLogger();
  await createOpenAlexAdapter(deps({ fetchImpl: unkeyed.impl, logger })).fetch(psychology(), SINCE);
  assert.equal(unkeyed.calls[0]?.headers['Authorization'], undefined);
  assert.ok(
    logger.lines.some((l) => l.startsWith('warn') && l.includes('unkeyed')),
    'an unkeyed run must warn (§4.1)',
  );
});

test('the API key never appears in the URL', async () => {
  const stub = stubFetch(() => jsonResponse({ results: [] }));
  await createOpenAlexAdapter(
    deps({
      fetchImpl: stub.impl,
      secrets: { openAlexApiKey: 'oa-secret-key', semanticScholarApiKey: null, anthropicApiKey: null },
    }),
  ).fetch(psychology(), SINCE);

  for (const call of stub.calls) {
    assert.ok(!call.url.includes('oa-secret-key'), `key leaked into ${call.url}`);
    assert.ok(!/api_?key=/i.test(call.url));
  }
});

test('requireApiKey turns a missing key into a hard failure (§4.1)', async () => {
  const stub = stubFetch(() => jsonResponse({ results: [] }));
  const config = testConfig((c) => {
    c.sources.openalex.requireApiKey = true;
  });
  const adapter = createOpenAlexAdapter(deps({ fetchImpl: stub.impl, config }));

  await assert.rejects(() => adapter.fetch(psychology(), SINCE), /requireApiKey/);
  assert.equal(stub.calls.length, 0, 'must not spend a credit on a run it will not finish');
});

test('the query carries the category fields, the date window and §6’s hard exclusions', () => {
  const url = buildWorksUrl(deps({ fetchImpl: stubFetch(() => jsonResponse({})).impl }), psychology(), SINCE, 1);
  const decoded = decodeURIComponent(url);

  assert.ok(decoded.includes('primary_topic.field.id:fields/32'));
  assert.ok(decoded.includes(`from_publication_date:${SINCE}`));
  assert.ok(decoded.includes('has_abstract:true'));
  assert.ok(decoded.includes('is_retracted:false'));
  assert.ok(decoded.includes('language:en'));
  assert.ok(decoded.includes('type:article'));
  assert.ok(decoded.includes('sort=publication_date:desc'));
  assert.ok(decoded.includes('abstract_inverted_index'));

  // §4.1: `|` is OR within a term. Two fields must produce one OR-ed term.
  const health = testConfig().categories.find((c) => c.key === 'health-medicine');
  assert.ok(health);
  const multi = decodeURIComponent(
    buildWorksUrl(deps({ fetchImpl: stubFetch(() => jsonResponse({})).impl }), health, SINCE, 1),
  );
  assert.ok(multi.includes('primary_topic.field.id:fields/27|fields/36|fields/29'));
});

test('paginates to maxPages and stops early on a short page', async () => {
  const full = fixturePage();
  const config = testConfig((c) => {
    c.sources.openalex.perPage = 25;
    c.sources.openalex.maxPages = 3;
  });

  const paged = stubFetch(() => jsonResponse(full));
  const many = await createOpenAlexAdapter(deps({ fetchImpl: paged.impl, config })).fetch(psychology(), SINCE);
  assert.equal(paged.calls.length, 3, 'a full page means there may be another one');
  assert.equal(many.length, 75);
  assert.ok(decodeURIComponent(paged.calls[2]?.url ?? '').includes('page=3'));

  const short = stubFetch((_url, call) =>
    jsonResponse(call === 1 ? { results: full.results.slice(0, 5) } : full),
  );
  await createOpenAlexAdapter(deps({ fetchImpl: short.impl, config })).fetch(psychology(), SINCE);
  assert.equal(short.calls.length, 1, 'a short page is the last page');
});

test('a 401 is not retried — a bad key fails identically every time', async () => {
  const stub = stubFetch(() => jsonResponse({ error: 'Invalid or missing API key' }, 401));
  const adapter = createOpenAlexAdapter(
    deps({
      fetchImpl: stub.impl,
      secrets: { openAlexApiKey: 'wrong', semanticScholarApiKey: null, anthropicApiKey: null },
    }),
  );

  await assert.rejects(
    () => adapter.fetch(psychology(), SINCE),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
  assert.equal(stub.calls.length, 1, `401 must not be retried, saw ${stub.calls.length} calls`);
});

test('a 5xx is retried up to the configured budget', async () => {
  const stub = stubFetch(() => jsonResponse({ error: 'boom' }, 503));
  const config = testConfig();
  const adapter = createOpenAlexAdapter(deps({ fetchImpl: stub.impl, config }));

  await assert.rejects(() => adapter.fetch(psychology(), SINCE));
  assert.equal(stub.calls.length, config.http.retries + 1);
});

test('DOIs are normalised to the bare, lower-cased form', () => {
  assert.equal(bareDoi('https://doi.org/10.1234/AbC'), '10.1234/abc');
  assert.equal(bareDoi('10.1234/abc'), '10.1234/abc');
  assert.equal(bareDoi(''), null);
  assert.equal(bareDoi(null), null);
});
