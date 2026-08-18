/**
 * §8 dedup state — `state/seen.json`.
 *
 * The two things that can go wrong here are invisible until a reader notices
 * them: a normalisation gap re-publishes a paper the archive already carried,
 * and an off-by-one at the window boundary blocks one that is fair game again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptySeenState,
  isSeen,
  loadSeen,
  normaliseDoi,
  normaliseOpenAlexId,
  recordPublished,
  saveSeen,
  type SeenState,
} from '../src/state/seen.js';
import { shiftISODate } from '../src/util/dates.js';
import { makeEntry } from './support/digestFixture.js';
import { makeTempDir } from './support/htmlAssertions.js';

const TODAY = '2026-08-19';
const DEDUP_DAYS = 180;

function stateWith(entry: { doi?: string | null; openAlexId?: string | null; id?: string; date: string }): SeenState {
  return {
    schemaVersion: 1,
    entries: [
      {
        id: entry.id ?? 'openalex:W1001',
        openAlexId: entry.openAlexId === undefined ? 'W1001' : entry.openAlexId,
        doi: entry.doi === undefined ? '10.1234/example.1' : entry.doi,
        date: entry.date,
        lastPublished: entry.date,
      },
    ],
  };
}

test('DOIs compare equal however the source spelled them', () => {
  const forms = [
    '10.1234/abc-def',
    '10.1234/ABC-DEF',
    'https://doi.org/10.1234/abc-def',
    'http://dx.doi.org/10.1234/ABC-def',
    'doi:10.1234/abc-def',
    '  10.1234/abc-def  ',
  ];
  for (const form of forms) {
    assert.equal(normaliseDoi(form), '10.1234/abc-def', `failed to normalise ${form}`);
  }

  // Anything that is not recognisably a DOI must not become a matching key.
  for (const junk of ['', '   ', 'n/a', 'https://example.org/paper/1', '10.1234', null, undefined]) {
    assert.equal(normaliseDoi(junk), null, `${String(junk)} should not be treated as a DOI`);
  }
});

test('a paper is blocked whichever spelling of its DOI arrives', () => {
  const state = stateWith({ openAlexId: null, doi: '10.1234/abc-def', date: TODAY });
  for (const form of ['10.1234/ABC-DEF', 'https://doi.org/10.1234/abc-def', 'doi:10.1234/abc-def']) {
    assert.equal(
      isSeen(state, { id: 'openalex:W9999', doi: form }, TODAY, DEDUP_DAYS),
      true,
      `${form} slipped past the dedup check`,
    );
  }
});

test('OpenAlex ids compare equal bare, prefixed or lower-cased', () => {
  assert.equal(normaliseOpenAlexId('https://openalex.org/w2741809807'), 'W2741809807');
  assert.equal(normaliseOpenAlexId('https://api.openalex.org/works/W2741809807'), 'W2741809807');
  assert.equal(normaliseOpenAlexId('w2741809807'), 'W2741809807');
  assert.equal(normaliseOpenAlexId('not-an-id'), null);

  const state = stateWith({ openAlexId: 'W2741809807', doi: null, date: TODAY });
  assert.equal(
    isSeen(state, { id: 'openalex:other', openAlexId: 'https://openalex.org/w2741809807' }, TODAY, DEDUP_DAYS),
    true,
  );
});

test('the OpenAlex id and the DOI each block on their own', () => {
  const byIdOnly = stateWith({ openAlexId: 'W1001', doi: null, date: TODAY });
  const byDoiOnly = stateWith({ openAlexId: null, doi: '10.1234/example.1', date: TODAY });

  assert.equal(isSeen(byIdOnly, { id: 'x', openAlexId: 'W1001' }, TODAY, DEDUP_DAYS), true);
  assert.equal(isSeen(byIdOnly, { id: 'x', doi: '10.1234/example.1' }, TODAY, DEDUP_DAYS), false);
  assert.equal(isSeen(byDoiOnly, { id: 'x', doi: '10.1234/example.1' }, TODAY, DEDUP_DAYS), true);
  assert.equal(isSeen(byDoiOnly, { id: 'x', openAlexId: 'W1001' }, TODAY, DEDUP_DAYS), false);
});

test('a candidate with no usable key is never reported as seen', () => {
  const state = stateWith({ date: TODAY });
  assert.equal(isSeen(state, { doi: null, openAlexId: null }, TODAY, DEDUP_DAYS), false);
});

test('an arXiv preprint with neither DOI nor OpenAlex id still blocks on its own id', () => {
  const state = stateWith({ id: 'arxiv:2608.16889', openAlexId: null, doi: null, date: TODAY });
  assert.equal(isSeen(state, { id: 'arxiv:2608.16889' }, TODAY, DEDUP_DAYS), true);
  assert.equal(isSeen(state, { id: 'arxiv:2608.99999' }, TODAY, DEDUP_DAYS), false);
});

test('the 180-day window: 179 days still blocks, 181 days does not', () => {
  const at = (age: number): SeenState => stateWith({ date: shiftISODate(TODAY, -age) });
  const candidate = { id: 'openalex:W1001', openAlexId: 'W1001', doi: '10.1234/example.1' };

  assert.equal(isSeen(at(179), candidate, TODAY, DEDUP_DAYS), true, '179 days must still block');
  // The boundary is inclusive: "never twice within 180 days" covers day 180.
  assert.equal(isSeen(at(180), candidate, TODAY, DEDUP_DAYS), true, '180 days is inside the window');
  assert.equal(isSeen(at(181), candidate, TODAY, DEDUP_DAYS), false, '181 days must be eligible again');
});

test('entries outside the window stay in the file — they stop matching, they are not pruned', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  const old = stateWith({ date: shiftISODate(TODAY, -400) });
  saveSeen(path, old);

  const loaded = loadSeen(path);
  assert.equal(loaded.entries.length, 1, 'history must survive a load');
  assert.equal(isSeen(loaded, { id: 'openalex:W1001', openAlexId: 'W1001' }, TODAY, DEDUP_DAYS), false);

  // Recording today's run keeps the old row and only moves its window.
  const next = recordPublished(loaded, [makeEntry({ candidate: { index: 1 } })], TODAY);
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0]?.date, shiftISODate(TODAY, -400), 'the first appearance is history');
  assert.equal(next.entries[0]?.lastPublished, TODAY);
  assert.equal(isSeen(next, { id: 'openalex:W1001', openAlexId: 'W1001' }, TODAY, DEDUP_DAYS), true);
});

test('recording a day adds one row per paper and survives a save/load round trip', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  const entries = [1, 2, 3, 4, 5].map((index) => makeEntry({ candidate: { index } }));

  const state = recordPublished(emptySeenState(), entries, TODAY);
  assert.equal(state.entries.length, 5);
  saveSeen(path, state);

  const loaded = loadSeen(path);
  assert.deepEqual(loaded, state);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 1);
  for (const entry of loaded.entries) {
    assert.equal(entry.date, TODAY, '§8 — every row records the date it appeared');
    assert.match(entry.doi ?? '', /^10\./);
    assert.match(entry.openAlexId ?? '', /^W\d+$/);
  }
});

test('a hundred runs of the same paper store it once', () => {
  const entries = [makeEntry({ candidate: { index: 1 } })];
  let state = emptySeenState();
  for (let day = 0; day < 100; day += 1) {
    state = recordPublished(state, entries, shiftISODate(TODAY, day));
  }
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]?.date, TODAY);
  assert.equal(state.entries[0]?.lastPublished, shiftISODate(TODAY, 99));
});

test('recordPublished does not mutate the state it was given', () => {
  const before = emptySeenState();
  const after = recordPublished(before, [makeEntry()], TODAY);
  assert.equal(before.entries.length, 0);
  assert.equal(after.entries.length, 1);
});

test('a missing state file is an empty first run; a corrupt one stops the run', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  assert.deepEqual(loadSeen(join(dir, 'nothing-here.json')), emptySeenState());

  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  assert.throws(() => loadSeen(broken), /not valid JSON/);

  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify({ entries: [{ id: 'x', date: 'yesterday' }] }));
  assert.throws(() => loadSeen(wrongShape), /YYYY-MM-DD/);
});

test('a file written before lastPublished existed still loads and still blocks', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      entries: [{ id: 'openalex:W1001', openAlexId: 'W1001', doi: '10.1234/example.1', date: TODAY }],
    }),
  );

  const loaded = loadSeen(path);
  assert.equal(loaded.entries[0]?.lastPublished, TODAY);
  assert.equal(isSeen(loaded, { id: 'openalex:W1001', doi: '10.1234/EXAMPLE.1' }, TODAY, DEDUP_DAYS), true);
});
