/**
 * DESIGN-NOTES B.1 — §6's hard exclusions, one describe block per rule, each
 * with the candidate that must fire it and the control that must not.
 *
 * Scenarios: RISK-SELECT-01, -02, -03, -04, -05, -11.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  applyExclusions,
  formatExclusionCounts,
  looksLikeInvertedIndex,
  type ExclusionOptions,
  type ExclusionReason,
} from '../src/select/exclude.js';
import type { EnrichedCandidate } from '../src/types.js';
import { shiftISODate } from '../src/util/dates.js';
import {
  DEFAULT_ABSTRACT,
  makeCandidate,
  neverSeen,
  resetCandidateSequence,
  stubSeenLookup,
  TEST_TODAY,
  testConfig,
} from './support/candidates.js';

const config = testConfig();

function options(overrides: Partial<ExclusionOptions> = {}): ExclusionOptions {
  return {
    today: TEST_TODAY,
    freshnessDays: config.windows.freshnessDays,
    minAbstractChars: config.ranking.minAbstractChars,
    isSeen: neverSeen,
    ...overrides,
  };
}

/** The reason one candidate was dropped, or `null` if it survived. */
function reasonFor(
  candidate: EnrichedCandidate,
  overrides: Partial<ExclusionOptions> = {},
): ExclusionReason | null {
  const outcome = applyExclusions([candidate], options(overrides));
  return outcome.excluded[0]?.reason ?? null;
}

beforeEach(resetCandidateSequence);

describe('B.1 control — an ordinary candidate survives every rule', () => {
  test('the neutral fixture is not excluded', () => {
    assert.equal(reasonFor(makeCandidate()), null);
  });
});

describe('RISK-SELECT-01 — B.1 rule 1: retracted works are excluded', () => {
  test('fires on the is_retracted flag', () => {
    assert.equal(reasonFor(makeCandidate({ isRetracted: true })), 'EXCL_RETRACTED');
  });

  test('fires on an OpenAlex type of "retraction"', () => {
    assert.equal(reasonFor(makeCandidate({ sourceType: 'retraction' })), 'EXCL_RETRACTED');
  });

  test('fires on a title that starts with RETRACTED', () => {
    assert.equal(
      reasonFor(makeCandidate({ title: 'RETRACTED: Free school breakfasts increased attendance' })),
      'EXCL_RETRACTED',
    );
  });

  test('does NOT fire on a paper that merely discusses retraction', () => {
    // The rule is anchored to the start of the title for exactly this reason.
    assert.equal(
      reasonFor(makeCandidate({ title: 'How often are retracted papers still cited by students?' })),
      null,
    );
  });

  test('retraction is reported ahead of every other defect (B.1 order)', () => {
    const both = makeCandidate({ isRetracted: true, abstract: null, tldr: null, ageDays: 40 });
    assert.equal(reasonFor(both), 'EXCL_RETRACTED');
  });
});

describe('RISK-SELECT-02 — B.1 rule 2: no abstract and no TLDR', () => {
  for (const [label, abstract] of [
    ['null', null],
    ['empty', ''],
    ['whitespace only', '   \n\t '],
  ] as const) {
    test(`fires when the abstract is ${label} and there is no TLDR`, () => {
      assert.equal(reasonFor(makeCandidate({ abstract, tldr: null })), 'EXCL_NO_ABSTRACT');
    });
  }

  test('does NOT fire when a real abstract is present', () => {
    assert.equal(reasonFor(makeCandidate({ abstract: DEFAULT_ABSTRACT })), null);
  });
});

describe('RISK-SELECT-02/-03 — B.1 rule 3: an abstract too thin to explain', () => {
  const threeWords = 'Sleep improves memory.';

  test('fires on a three-word abstract with no TLDR', () => {
    assert.equal(
      reasonFor(makeCandidate({ abstract: threeWords, tldr: null })),
      'EXCL_ABSTRACT_TOO_THIN',
    );
  });

  test('fires just under the configured minimum and not at it', () => {
    const min = config.ranking.minAbstractChars;
    assert.equal(reasonFor(makeCandidate({ abstract: 'a'.repeat(min - 1), tldr: null })), 'EXCL_ABSTRACT_TOO_THIN');
    assert.equal(reasonFor(makeCandidate({ abstract: 'a'.repeat(min), tldr: null })), null);
  });

  test('RISK-SELECT-03(b): the same paper is RETAINED once S2 supplies a TLDR', () => {
    // Ordering matters: the exclusion decision happens after enrichment, or a
    // paywalled abstract with a perfectly good TLDR is dropped for no reason.
    const withTldr = makeCandidate({
      abstract: threeWords,
      tldr: 'Free school breakfasts raised attendance by about a tenth in the schools that offered them.',
    });
    assert.equal(reasonFor(withTldr), null);
  });

  test('RISK-SELECT-03(a): paywalled abstract and no TLDR is excluded', () => {
    assert.equal(reasonFor(makeCandidate({ abstract: null, tldr: null })), 'EXCL_NO_ABSTRACT');
  });
});

describe('RISK-SELECT-11 — B.1 rule 4: the seven-day freshness window', () => {
  const cases: readonly [number, ExclusionReason | null][] = [
    [0, null],
    [6, null],
    // "last 7 days" is inclusive of D−7 (resolved defect X-3).
    [7, null],
    [8, 'EXCL_STALE'],
    [30, 'EXCL_STALE'],
  ];

  for (const [ageDays, expected] of cases) {
    test(`D−${String(ageDays)} → ${expected ?? 'kept'}`, () => {
      assert.equal(reasonFor(makeCandidate({ ageDays })), expected);
    });
  }

  test('a future publication date is kept, not crashed on', () => {
    const embargoed = makeCandidate({
      date: shiftISODate(TEST_TODAY, 2),
      indexedDate: shiftISODate(TEST_TODAY, 2),
    });
    assert.equal(reasonFor(embargoed), null);
  });

  test('B.5: a stale issue date is rescued by a fresh index date', () => {
    // The journal issue is dated three months back; OpenAlex first saw it
    // yesterday. Taking the later of the two is what keeps it in the day.
    const backdated = makeCandidate({
      date: shiftISODate(TEST_TODAY, -90),
      indexedDate: shiftISODate(TEST_TODAY, -1),
    });
    assert.equal(reasonFor(backdated), null);
  });

  test('a candidate with no readable date at all is stale, not admitted', () => {
    assert.equal(reasonFor(makeCandidate({ date: '', indexedDate: null })), 'EXCL_STALE');
  });
});

describe('RISK-SELECT-04 — B.1 rules 5 and 6: the dedup state', () => {
  test('fires on an OpenAlex ID match alone', () => {
    const candidate = makeCandidate({ openAlexId: 'W900001', doi: null });
    const isSeen = stubSeenLookup([{ openalexId: 'W900001', publishedOn: shiftISODate(TEST_TODAY, -10) }]);
    assert.equal(reasonFor(candidate, { isSeen }), 'EXCL_SEEN');
  });

  test('fires on a DOI match alone, in any spelling', () => {
    const candidate = makeCandidate({ openAlexId: 'W900002', doi: '10.1038/s41586-026-01234-5' });
    const isSeen = stubSeenLookup([
      { doi: 'https://doi.org/10.1038/S41586-026-01234-5', publishedOn: shiftISODate(TEST_TODAY, -10) },
    ]);
    assert.equal(reasonFor(candidate, { isSeen }), 'EXCL_SEEN');
  });

  test('fires on an arXiv ID match ignoring the version suffix', () => {
    const candidate = makeCandidate({
      id: 'arxiv:2608.01234',
      source: 'arxiv',
      openAlexId: null,
      doi: null,
      isPreprint: true,
      venue: 'arXiv',
      sourceType: null,
    });
    const isSeen = stubSeenLookup([
      { arxivId: 'arXiv:2608.01234v2', publishedOn: shiftISODate(TEST_TODAY, -10) },
    ]);
    assert.equal(reasonFor(candidate, { isSeen }), 'EXCL_SEEN');
  });

  test('B.1 rule 6: a reworded title of a seen paper is EXCL_SEEN_TITLE, not EXCL_SEEN', () => {
    const candidate = makeCandidate({
      title: 'Delaying school start times increases adolescent sleep: two-year cohort study in 21 schools',
      openAlexId: 'W900003',
      doi: '10.1234/brand.new',
    });
    const isSeen = stubSeenLookup([
      {
        title:
          'Delaying school start times increases adolescent sleep: a two-year cohort study in 21 schools',
        publishedOn: shiftISODate(TEST_TODAY, -30),
      },
    ]);
    assert.equal(reasonFor(candidate, { isSeen }), 'EXCL_SEEN_TITLE');
  });

  test('negative control: a candidate with no DOI and no matching ID is not excluded', () => {
    const candidate = makeCandidate({ openAlexId: 'W999999', doi: null, title: 'A completely unrelated paper about bees and clover' });
    const isSeen = stubSeenLookup([
      { openalexId: 'W900001', doi: '10.1038/other', publishedOn: shiftISODate(TEST_TODAY, -10) },
    ]);
    assert.equal(reasonFor(candidate, { isSeen }), null);
  });

  test('RISK-SELECT-05: a seen entry older than the window stops excluding', () => {
    const candidate = makeCandidate({ openAlexId: 'W900004', doi: null });
    const stale = stubSeenLookup([
      { openalexId: 'W900004', publishedOn: shiftISODate(TEST_TODAY, -181) },
    ]);
    const fresh = stubSeenLookup([
      { openalexId: 'W900004', publishedOn: shiftISODate(TEST_TODAY, -180) },
    ]);
    assert.equal(reasonFor(candidate, { isSeen: stale }), null);
    assert.equal(reasonFor(candidate, { isSeen: fresh }), 'EXCL_SEEN');
  });
});

describe('B.1 rules 7 and 8 — records that are not a research paper', () => {
  for (const type of ['editorial', 'letter', 'erratum', 'book-review', 'paratext', 'dataset', 'peer-review']) {
    test(`rule 7 fires on OpenAlex type "${type}"`, () => {
      assert.equal(reasonFor(makeCandidate({ sourceType: type })), 'EXCL_TYPE');
    });
  }

  test('rule 7 does NOT fire on type "article"', () => {
    assert.equal(reasonFor(makeCandidate({ sourceType: 'article' })), null);
  });

  for (const prefix of ['Correction', 'Corrigendum', 'Erratum', 'Editorial', 'Comment on', 'Reply to', 'Response to']) {
    test(`rule 8 fires on a title beginning "${prefix}"`, () => {
      assert.equal(
        reasonFor(makeCandidate({ sourceType: null, title: `${prefix} the school breakfast study` })),
        'EXCL_TYPE',
      );
    });
  }

  test('rule 8 does NOT fire when the word appears later in the title', () => {
    assert.equal(
      reasonFor(makeCandidate({ title: 'Automatic correction of attendance records in 40 schools' })),
      null,
    );
  });
});

describe('B.1 rule 9 — an abstract that is an unreconstructed inverted index', () => {
  const jsonBlob = JSON.stringify(
    Object.fromEntries(
      DEFAULT_ABSTRACT.toLowerCase()
        .replace(/[^a-z ]+/gu, '')
        .split(' ')
        .filter((word) => word !== '')
        .map((word, i) => [word, [i, i + 40, i + 80]]),
    ),
  );
  const positionsOnly = Array.from({ length: 200 }, (_, i) => String(i)).join(' ');

  test('fires on raw JSON that leaked through', () => {
    assert.ok(jsonBlob.length > config.ranking.minAbstractChars);
    assert.equal(reasonFor(makeCandidate({ abstract: jsonBlob, tldr: null })), 'EXCL_NO_ABSTRACT');
  });

  test('fires when the positions were serialised instead of the words', () => {
    assert.ok(positionsOnly.length > config.ranking.minAbstractChars);
    assert.equal(reasonFor(makeCandidate({ abstract: positionsOnly, tldr: null })), 'EXCL_NO_ABSTRACT');
  });

  test('fires when the field name itself came along', () => {
    assert.ok(looksLikeInvertedIndex(`abstract_inverted_index ${DEFAULT_ABSTRACT}`));
  });

  test('does NOT fire on ordinary prose that happens to contain numbers', () => {
    assert.equal(looksLikeInvertedIndex(DEFAULT_ABSTRACT), false);
    assert.equal(reasonFor(makeCandidate({ abstract: DEFAULT_ABSTRACT })), null);
  });
});

describe('B.1 — every drop is counted for the run log (§9)', () => {
  test('counts are per reason code and survivors are everything else', () => {
    const candidates = [
      makeCandidate(),
      makeCandidate({ isRetracted: true }),
      makeCandidate({ isRetracted: true }),
      makeCandidate({ abstract: null, tldr: null }),
      makeCandidate({ abstract: 'Too short.', tldr: null }),
      makeCandidate({ ageDays: 20 }),
      makeCandidate({ sourceType: 'editorial' }),
      makeCandidate(),
    ];
    const outcome = applyExclusions(candidates, options());

    assert.equal(outcome.survivors.length, 2);
    assert.deepEqual(outcome.counts, {
      EXCL_RETRACTED: 2,
      EXCL_NO_ABSTRACT: 1,
      EXCL_ABSTRACT_TOO_THIN: 1,
      EXCL_STALE: 1,
      EXCL_SEEN: 0,
      EXCL_SEEN_TITLE: 0,
      EXCL_TYPE: 1,
    });
    assert.equal(outcome.survivors.length + outcome.excluded.length, candidates.length);
    assert.equal(
      formatExclusionCounts(outcome.counts),
      'EXCL_RETRACTED=2 EXCL_NO_ABSTRACT=1 EXCL_ABSTRACT_TOO_THIN=1 EXCL_STALE=1 EXCL_TYPE=1',
    );
  });

  test('every exclusion carries a human-readable detail line', () => {
    const outcome = applyExclusions([makeCandidate({ ageDays: 20 })], options());
    assert.equal(outcome.excluded[0]?.detail, '20 days old (window is 7)');
  });

  test('an empty candidate set produces zero counts, not a crash', () => {
    const outcome = applyExclusions([], options());
    assert.deepEqual(outcome.survivors, []);
    assert.equal(formatExclusionCounts(outcome.counts), 'no exclusions');
  });
});
