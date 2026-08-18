/**
 * §8 dedup state — `state/seen.json`, in the shape DESIGN-NOTES B.7 fixes.
 *
 * The two things that can go wrong here are invisible until a reader notices
 * them: a normalisation gap re-publishes a paper the archive already carried,
 * and an off-by-one at the window boundary blocks one that is fair game again.
 * Matching itself lives in `src/select/identity.ts`; these tests prove that the
 * file, the window and the recording behave, and that the two halves are wired
 * together.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSeenLookup,
  emptySeenState,
  isSeen,
  loadSeen,
  recordPublished,
  saveSeen,
  seenMatch,
  type SeenEntry,
  type SeenState,
} from '../src/state/seen.js';
import { shiftISODate } from '../src/util/dates.js';
import { makeCandidate, makeEntry } from './support/digestFixture.js';
import { makeTempDir } from './support/htmlAssertions.js';

const TODAY = '2026-08-19';
const DEDUP_DAYS = 180;

function entry(overrides: Partial<SeenEntry> = {}): SeenEntry {
  return {
    openalexId: 'W1001',
    doi: '10.1234/example.1',
    arxivId: null,
    titleKey: 'sleeprestrictionandreactiontimestudy1',
    publishedOn: TODAY,
    category: 'psychology-behaviour',
    ...overrides,
  };
}

function stateWith(...entries: SeenEntry[]): SeenState {
  return { version: 1, entries };
}

test('a paper is blocked whichever spelling of its DOI arrives', () => {
  const state = stateWith(entry({ openalexId: null, doi: '10.1234/abc-def', titleKey: '' }));
  for (const form of ['10.1234/ABC-DEF', 'https://doi.org/10.1234/abc-def', 'doi:10.1234/abc-def']) {
    const candidate = makeCandidate({ index: 9, openAlexId: null, doi: form, title: 'Something else entirely' });
    assert.equal(seenMatch(state, candidate, TODAY, DEDUP_DAYS), 'doi', `${form} slipped past the dedup check`);
  }
});

test('a paper is blocked whichever spelling of its OpenAlex id arrives', () => {
  const state = stateWith(entry({ openalexId: 'W2741809807', doi: null, titleKey: '' }));
  for (const form of ['W2741809807', 'w2741809807', 'https://openalex.org/w2741809807']) {
    const candidate = makeCandidate({ index: 9, doi: null, openAlexId: form, title: 'Something else entirely' });
    assert.equal(seenMatch(state, candidate, TODAY, DEDUP_DAYS), 'openalex-id', `${form} slipped past`);
  }
});

test('the OpenAlex id and the DOI each block on their own', () => {
  const byIdOnly = stateWith(entry({ doi: null, titleKey: '' }));
  const byDoiOnly = stateWith(entry({ openalexId: null, titleKey: '' }));
  const other = { title: 'Something else entirely' };

  assert.equal(isSeen(byIdOnly, makeCandidate({ ...other, openAlexId: 'W1001', doi: null }), TODAY, DEDUP_DAYS), true);
  assert.equal(isSeen(byIdOnly, makeCandidate({ ...other, openAlexId: 'W9999', doi: '10.1234/example.1' }), TODAY, DEDUP_DAYS), false);
  assert.equal(isSeen(byDoiOnly, makeCandidate({ ...other, openAlexId: null, doi: '10.1234/example.1' }), TODAY, DEDUP_DAYS), true);
  assert.equal(isSeen(byDoiOnly, makeCandidate({ ...other, openAlexId: 'W1001', doi: null }), TODAY, DEDUP_DAYS), false);
});

test('an arXiv preprint with neither DOI nor OpenAlex id still blocks on its arXiv id', () => {
  const state = stateWith(entry({ openalexId: null, doi: null, arxivId: '2608.16889', titleKey: '' }));
  const same = makeCandidate({
    source: 'arxiv',
    id: 'arxiv:2608.16889v2',
    doi: null,
    openAlexId: null,
    title: 'Something else entirely',
  });
  const different = makeCandidate({
    source: 'arxiv',
    id: 'arxiv:2608.99999',
    doi: null,
    openAlexId: null,
    title: 'Something else entirely',
  });
  assert.equal(seenMatch(state, same, TODAY, DEDUP_DAYS), 'arxiv-id');
  assert.equal(isSeen(state, different, TODAY, DEDUP_DAYS), false);
});

test('the journal version of an already-published preprint is caught by title', () => {
  const state = stateWith(
    entry({ openalexId: null, doi: null, titleKey: 'delayingschoolstarttimesandadolescentsleep' }),
  );
  const journalVersion = makeCandidate({
    index: 42,
    openAlexId: 'W7777',
    doi: '10.1000/brand-new',
    title: 'Delaying school start times and adolescent sleep',
  });
  assert.equal(seenMatch(state, journalVersion, TODAY, DEDUP_DAYS), 'title');
});

test('an identifier match is reported ahead of a title match', () => {
  const state = stateWith(entry({ titleKey: 'delayingschoolstarttimesandadolescentsleep' }));
  const candidate = makeCandidate({
    index: 1,
    openAlexId: 'W1001',
    title: 'Delaying school start times and adolescent sleep',
  });
  assert.equal(seenMatch(state, candidate, TODAY, DEDUP_DAYS), 'openalex-id');
});

test('two papers with no usable title never collide on an empty title key', () => {
  const state = stateWith(entry({ openalexId: null, doi: null, titleKey: '' }));
  const candidate = makeCandidate({ index: 9, openAlexId: null, doi: null, title: '   ' });
  assert.equal(isSeen(state, candidate, TODAY, DEDUP_DAYS), false);
});

test('the 180-day window: 179 days still blocks, 181 days does not', () => {
  const at = (age: number): SeenState => stateWith(entry({ publishedOn: shiftISODate(TODAY, -age) }));
  const candidate = makeCandidate({ index: 1 });

  assert.equal(isSeen(at(179), candidate, TODAY, DEDUP_DAYS), true, '179 days must still block');
  // The boundary is inclusive: "never twice within 180 days" covers day 180.
  assert.equal(isSeen(at(180), candidate, TODAY, DEDUP_DAYS), true, '180 days is inside the window');
  assert.equal(isSeen(at(181), candidate, TODAY, DEDUP_DAYS), false, '181 days must be eligible again');
});

test('entries outside the window stay in the file — they stop matching, they are not pruned', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  saveSeen(path, stateWith(entry({ publishedOn: shiftISODate(TODAY, -400) })));

  const loaded = loadSeen(path);
  assert.equal(loaded.entries.length, 1, 'history must survive a load');
  assert.equal(isSeen(loaded, makeCandidate({ index: 1 }), TODAY, DEDUP_DAYS), false);

  // Recording today's run keeps the same row and only moves its window forward.
  const next = recordPublished(loaded, [makeEntry({ candidate: { index: 1 } })], TODAY, 'psychology-behaviour');
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0]?.publishedOn, TODAY);
  assert.equal(isSeen(next, makeCandidate({ index: 1 }), TODAY, DEDUP_DAYS), true);
});

test('recording a day adds one row per paper and survives a save/load round trip', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  const entries = [1, 2, 3, 4, 5].map((index) =>
    makeEntry({ candidate: { index, title: `Distinct paper number ${index} about sleep` } }),
  );

  const state = recordPublished(emptySeenState(), entries, TODAY, 'psychology-behaviour');
  assert.equal(state.entries.length, 5);
  saveSeen(path, state);

  const loaded = loadSeen(path);
  assert.deepEqual(loaded, state);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1);
  for (const row of loaded.entries) {
    assert.equal(row.publishedOn, TODAY, '§8 — every row records the date it appeared');
    assert.match(row.doi ?? '', /^10\./);
    assert.match(row.openalexId ?? '', /^W\d+$/);
    assert.equal(row.category, 'psychology-behaviour');
    assert.notEqual(row.titleKey, '');
  }
});

test('a hundred runs of the same paper store it once', () => {
  const entries = [makeEntry({ candidate: { index: 1 } })];
  let state = emptySeenState();
  for (let day = 0; day < 100; day += 1) {
    state = recordPublished(state, entries, shiftISODate(TODAY, day));
  }
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]?.publishedOn, shiftISODate(TODAY, 99));
});

test('recordPublished does not mutate the state it was given', () => {
  const before = emptySeenState();
  const after = recordPublished(before, [makeEntry()], TODAY);
  assert.equal(before.entries.length, 0);
  assert.equal(after.entries.length, 1);
});

test('recordPublished refuses a date that is not a plain ISO day', () => {
  assert.throws(() => recordPublished(emptySeenState(), [makeEntry()], '19.8.2026'), /YYYY-MM-DD/);
});

test('the selector gets a lookup with the state, the run date and the window bound in', () => {
  const lookup = createSeenLookup(stateWith(entry({ titleKey: '' })), TODAY, DEDUP_DAYS);
  assert.equal(lookup(makeCandidate({ index: 1 })), 'openalex-id');
  assert.equal(
    lookup(makeCandidate({ index: 9, openAlexId: 'W9', doi: null, title: 'Nothing like it' })),
    null,
  );
});

test('a missing state file is an empty first run; a corrupt one stops the run', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  assert.deepEqual(loadSeen(join(dir, 'nothing-here.json')), emptySeenState());

  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  assert.throws(() => loadSeen(broken), /not valid JSON/);

  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify({ entries: [{ publishedOn: 'yesterday' }] }));
  assert.throws(() => loadSeen(wrongShape), /YYYY-MM-DD/);
});

test('a sparse hand-written row loads, is re-normalised, and still blocks', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const path = join(dir, 'seen.json');
  writeFileSync(
    path,
    JSON.stringify({ entries: [{ doi: 'https://doi.org/10.1234/EXAMPLE.1', publishedOn: TODAY }] }),
  );

  const loaded = loadSeen(path);
  assert.deepEqual(loaded.entries[0], {
    openalexId: null,
    doi: '10.1234/example.1',
    arxivId: null,
    titleKey: '',
    publishedOn: TODAY,
    category: null,
  });
  assert.equal(isSeen(loaded, makeCandidate({ index: 1 }), TODAY, DEDUP_DAYS), true);
});
