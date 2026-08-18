/**
 * DESIGN-NOTES B.7 — the pure identity helpers §8's dedup state is built on.
 * Scenarios: RISK-SELECT-04 (ID and DOI independently), RISK-SELECT-05 (the
 * 180-day boundary).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  candidateIdentity,
  isWithinDedupWindow,
  normaliseArxivId,
  normaliseDoi,
  normaliseOpenAlexId,
  TITLE_SIMILARITY_THRESHOLD,
  titleKey,
  titlesAreSamePaper,
  trigramJaccard,
  trigrams,
} from '../src/select/identity.js';
import { makeCandidate, TEST_TODAY } from './support/candidates.js';

describe('RISK-SELECT-04 — DOI normalisation collapses every spelling of one DOI', () => {
  test('resolver prefixes, casing and trailing punctuation all normalise away', () => {
    const canonical = '10.1038/s41586-026-01234-5';
    for (const variant of [
      '10.1038/s41586-026-01234-5',
      '10.1038/S41586-026-01234-5',
      'https://doi.org/10.1038/s41586-026-01234-5',
      'http://dx.doi.org/10.1038/S41586-026-01234-5',
      'doi:10.1038/s41586-026-01234-5',
      '  10.1038/s41586-026-01234-5.  ',
      '10.1038/s41586-026-01234-5),',
    ]) {
      assert.equal(normaliseDoi(variant), canonical, `variant: ${variant}`);
    }
  });

  test('two different DOIs stay different, and absence stays absent', () => {
    assert.notEqual(normaliseDoi('10.1038/a'), normaliseDoi('10.1038/b'));
    assert.equal(normaliseDoi(null), null);
    assert.equal(normaliseDoi('   '), null);
  });

  test('OpenAlex IDs normalise to the bare W-form', () => {
    for (const variant of [
      'W4401234567',
      'w4401234567',
      'https://openalex.org/W4401234567',
      'https://api.openalex.org/works/W4401234567',
      'openalex:W4401234567',
    ]) {
      assert.equal(normaliseOpenAlexId(variant), 'W4401234567', `variant: ${variant}`);
    }
  });

  test('arXiv IDs lose their prefix and their version suffix', () => {
    for (const variant of [
      '2608.01234',
      'arXiv:2608.01234',
      'arxiv:2608.01234v3',
      'https://arxiv.org/abs/2608.01234v1',
      '2608.01234v12',
    ]) {
      assert.equal(normaliseArxivId(variant), '2608.01234', `variant: ${variant}`);
    }
  });

  test('candidateIdentity reads the arXiv id off the prefixed candidate id', () => {
    const preprint = makeCandidate({
      id: 'arxiv:2608.16889',
      source: 'arxiv',
      openAlexId: null,
      doi: null,
    });
    const identity = candidateIdentity(preprint);
    assert.equal(identity.arxivId, '2608.16889');
    assert.equal(identity.openAlexId, null);
    assert.equal(identity.doi, null);

    // An OpenAlex candidate must not have its id read as an arXiv id.
    assert.equal(candidateIdentity(makeCandidate({})).arxivId, null);
  });
});

describe('B.7 titleKey and trigram-Jaccard title similarity', () => {
  test('titleKey strips case, diacritics and every non-alphanumeric character', () => {
    assert.equal(titleKey('Delaying School Start Times: A Two-Year Study'), 'delayingschoolstarttimesatwoyearstudy');
    // NFD-decomposed input must key the same as precomposed input.
    assert.equal(titleKey('Poincaré recurrence'), titleKey('Poincaré recurrence'));
    assert.equal(titleKey('Poincaré recurrence'), 'poincarerecurrence');
  });

  test('an arXiv preprint and its lightly reworded journal version match at ≥ 0.90', () => {
    const preprint =
      'Delaying school start times increases adolescent sleep: a two-year cohort study in 21 schools';
    const journal =
      'Delaying school start times increases adolescent sleep: two-year cohort study in 21 schools';
    const similarity = trigramJaccard(titleKey(preprint), titleKey(journal));
    assert.ok(
      similarity >= TITLE_SIMILARITY_THRESHOLD,
      `expected ≥ ${String(TITLE_SIMILARITY_THRESHOLD)}, got ${String(similarity)}`,
    );
    assert.ok(titlesAreSamePaper(preprint, journal));
  });

  test('two genuinely different papers do not match', () => {
    const a = 'Delaying school start times increases adolescent sleep in 21 schools';
    const b = 'Ocean acidification reduces shell growth in juvenile oysters';
    assert.ok(trigramJaccard(titleKey(a), titleKey(b)) < TITLE_SIMILARITY_THRESHOLD);
    assert.equal(titlesAreSamePaper(a, b), false);
  });

  test('papers on the same subject with different findings do not match either', () => {
    // The dangerous near-miss: same field, same vocabulary, different result.
    const a = 'Delaying school start times increases adolescent sleep in 21 schools';
    const b = 'Delaying school start times has no effect on adolescent grades in 30 schools';
    const similarity = trigramJaccard(titleKey(a), titleKey(b));
    assert.ok(
      similarity < TITLE_SIMILARITY_THRESHOLD,
      `these must NOT dedup, got ${String(similarity)}`,
    );
  });

  test('identical titles score 1, and short keys cannot produce a false 1', () => {
    assert.equal(trigramJaccard('abcdef', 'abcdef'), 1);
    assert.equal(trigramJaccard('', ''), 0);
    assert.equal(trigrams('ab').size, 0);
    assert.deepEqual([...trigrams('abcd')], ['abc', 'bcd']);
  });
});

describe('RISK-SELECT-05 — the dedup window is inclusive at 180 days', () => {
  const cases: readonly [number, boolean][] = [
    [0, true],
    [179, true],
    // "within 180 days" includes the 180th (§8, resolved defect X-2).
    [180, true],
    [181, false],
    [400, false],
  ];

  for (const [ageDays, expected] of cases) {
    test(`an entry ${String(ageDays)} days old is ${expected ? 'still' : 'no longer'} in the window`, () => {
      const published = shift(TEST_TODAY, -ageDays);
      assert.equal(isWithinDedupWindow(published, TEST_TODAY, 180), expected);
    });
  }

  test('an unreadable date counts as inside the window, never as a licence to republish', () => {
    assert.equal(isWithinDedupWindow('not-a-date', TEST_TODAY, 180), true);
  });
});

function shift(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
