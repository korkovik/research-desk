/**
 * §11 step 6's acceptance check and DESIGN-NOTES B.8/B.9 end to end.
 *
 *   > Ranking + selection — scoring, diversity constraint, dedup against
 *   > seen.json. Check: returns exactly 5, max 2 per subfield, none present in
 *   > seen.json.
 *
 * Scenarios: S11-06a, S11-06b, S11-06c, RISK-SELECT-13, RISK-SELECT-14.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { countBySubfield } from '../src/select/diversity.js';
import type { SeenLookup } from '../src/select/exclude.js';
import { rankingRecord, selectForDay, weightsVersion } from '../src/select/select.js';
import type { EnrichedCandidate, ScoredCandidate } from '../src/types.js';
import { shiftISODate } from '../src/util/dates.js';
import {
  makeCandidate,
  makeModestCandidate,
  makeUngatedCandidate,
  resetCandidateSequence,
  selectOptions,
  stubSeenLookup,
  TEST_TODAY,
  testConfig,
} from './support/candidates.js';

const config = testConfig();

beforeEach(resetCandidateSequence);

const idsOf = (papers: readonly ScoredCandidate[]): string[] => papers.map((p) => p.id);

/** 40 fresh, complete, unseen candidates spread over 8 subfields. */
function fullPool(): EnrichedCandidate[] {
  const subfields = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return Array.from({ length: 40 }, (_, i) =>
    makeCandidate({
      subfieldId: `subfields/${subfields[i % subfields.length] ?? 'A'}`,
      ageDays: i % 7,
    }),
  );
}

describe('S11-06a/b — §11 step 6: exactly five, max two per subfield', () => {
  test('returns exactly papersPerDay papers', () => {
    const result = selectForDay(fullPool(), selectOptions());
    assert.equal(result.selected.length, config.output.papersPerDay);
    assert.equal(result.shortfall, 0);
    assert.equal(result.shortfallReason, 'none');
    assert.equal(result.belowMinimum, false);
  });

  test('no subfield appears more than maxPerSubfield times', () => {
    const result = selectForDay(fullPool(), selectOptions());
    for (const [key, count] of countBySubfield(result.selected)) {
      assert.ok(count <= config.ranking.maxPerSubfield, `${key} × ${String(count)}`);
    }
  });

  test('the five are distinct by id, by OpenAlex ID and by DOI', () => {
    const result = selectForDay(fullPool(), selectOptions());
    assert.equal(new Set(idsOf(result.selected)).size, 5);
    assert.equal(new Set(result.selected.map((p) => p.openAlexId)).size, 5);
    assert.equal(new Set(result.selected.map((p) => p.doi)).size, 5);
  });

  test('they come back in ranked order, and the remainder is everything else', () => {
    const result = selectForDay(fullPool(), selectOptions());
    const positions = result.selected.map((p) => result.ranked.indexOf(p));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.equal(result.ranked.length, 40);
    assert.equal(result.remainder.length, 35);
    assert.equal(
      result.remainder.some((p) => result.selected.includes(p)),
      false,
    );
  });
});

describe('S11-06c — nothing already in seen.json is published again', () => {
  test('the three seeded papers are gone and the day is backfilled to five', () => {
    const pool = fullPool();
    const baseline = selectForDay(pool, selectOptions()).selected;
    const [first, second, third] = baseline;
    assert.ok(first && second && third);

    // One matched by OpenAlex ID only, one by DOI only, one by both — and the
    // DOI is written in a different case with a resolver prefix.
    const isSeen: SeenLookup = stubSeenLookup([
      { openalexId: first.openAlexId ?? '', publishedOn: shiftISODate(TEST_TODAY, -30) },
      { doi: `https://doi.org/${(second.doi ?? '').toUpperCase()}`, publishedOn: shiftISODate(TEST_TODAY, -5) },
      {
        openalexId: third.openAlexId ?? '',
        doi: `doi:${third.doi ?? ''}`,
        publishedOn: shiftISODate(TEST_TODAY, -179),
      },
    ]);

    const result = selectForDay(pool, selectOptions({ isSeen }));
    assert.equal(result.selected.length, 5);
    for (const seen of [first, second, third]) {
      assert.equal(result.selected.some((p) => p.id === seen.id), false, `${seen.id} was republished`);
      assert.equal(result.ranked.some((p) => p.id === seen.id), false, `${seen.id} survived exclusion`);
    }
    assert.equal(result.exclusionCounts.EXCL_SEEN, 3);
  });
});

describe('B.2 — the explainability gate keeps a high-scoring unexplainable paper out', () => {
  /**
   * The gate exists because the other three factors outweigh explainability
   * 0.60 to 0.40, so a paper that is perfectly relevant, perfectly fresh and
   * perfectly credible can beat an explainable one on the weighted sum alone.
   * This pool constructs exactly that case.
   */
  const pool = (): EnrichedCandidate[] => [
    makeUngatedCandidate({ subfieldId: 'subfields/ENERGY' }),
    ...['P', 'Q', 'R'].map((key) =>
      makeModestCandidate({
        subfieldId: `subfields/${key}`,
        ageDays: 7,
        isPreprint: true,
        sourceType: 'preprint',
        venue: 'bioRxiv',
        isOpenAccess: false,
        licence: null,
      }),
    ),
  ];

  test('the unexplainable paper really does top the weighted ranking', () => {
    const result = selectForDay(pool(), selectOptions());
    const top = result.ranked[0];
    assert.ok(top);
    assert.equal(top.title.startsWith('A framework for modelling'), true);
    assert.ok(top.score.explainability < 0.35, 'fixture must be below the gate');
    for (const other of result.ranked.slice(1)) {
      assert.ok(top.score.total > other.score.total, 'fixture must have the highest total');
    }
  });

  test('and it is still not selected — the day publishes the three explainable papers', () => {
    const result = selectForDay(pool(), selectOptions());
    assert.equal(result.selected.length, 3);
    assert.equal(
      result.selected.some((p) => p.score.explainability < 0.35),
      false,
    );
    assert.equal(result.flags.explainGateWaived, false);
    assert.equal(result.shortfall, 2);
    // §9: three is publishable, so the run is not aborted — it is short.
    assert.equal(result.belowMinimum, false);
  });
});

describe('B.8 step 7 — the gate is waived only to avoid dropping below the minimum', () => {
  const pool = (): EnrichedCandidate[] => [
    makeCandidate({ subfieldId: 'subfields/A', ageDays: 0 }),
    makeCandidate({ subfieldId: 'subfields/B', ageDays: 1 }),
    makeUngatedCandidate({ subfieldId: 'subfields/X' }),
    makeUngatedCandidate({ subfieldId: 'subfields/Y' }),
    makeUngatedCandidate({ subfieldId: 'subfields/Z' }),
  ];

  test('two eligible papers are topped up to exactly the minimum, and flagged', () => {
    const result = selectForDay(pool(), selectOptions());
    assert.equal(result.selected.length, config.output.minPapersToPublish);
    assert.equal(result.flags.explainGateWaived, true);
    // "only enough to reach 3" — the other two ungated papers stay out.
    assert.equal(result.selected.filter((p) => p.score.explainability < 0.35).length, 1);
    assert.equal(result.belowMinimum, false);
  });

  test('with no ungated papers to fall back on, the run is below the minimum', () => {
    const thin = [makeCandidate({ subfieldId: 'subfields/A', ageDays: 0 })];
    const result = selectForDay(thin, selectOptions());
    assert.equal(result.selected.length, 1);
    assert.equal(result.belowMinimum, true);
    assert.equal(result.flags.explainGateWaived, false);
  });
});

describe('§3/§9 — a short day is short: the selector NEVER pads', () => {
  /**
   * "A run that cannot produce 5 papers still publishes with however many it
   * found (minimum 3) and notes the shortfall — it does not pad with older or
   * off-category papers." The temptation this guards against is real: the
   * padding candidates below all out-score the eligible three.
   */
  const eligibleIds = ['openalex:W1001', 'openalex:W1002', 'openalex:W1003'];

  function shortPool(): EnrichedCandidate[] {
    const eligible = ['A', 'B', 'C'].map((key) =>
      makeCandidate({ subfieldId: `subfields/${key}`, ageDays: 3 }),
    );
    const padding = [
      // Yesterday's paper, but eight days old: outside §3's seven-day window.
      makeCandidate({ id: 'pad:stale-8', subfieldId: 'subfields/D', ageDays: 8 }),
      // A month old and otherwise perfect — the strongest pull towards padding.
      makeCandidate({ id: 'pad:stale-30', subfieldId: 'subfields/E', ageDays: 30 }),
      // Fresh and excellent, but published in a previous digest.
      makeCandidate({ id: 'pad:seen', subfieldId: 'subfields/F', ageDays: 0, openAlexId: 'W777777' }),
      // Fresh, but nothing to summarise from.
      makeCandidate({ id: 'pad:no-abstract', subfieldId: 'subfields/G', abstract: null, tldr: null }),
    ];
    return [...eligible, ...padding];
  }

  const isSeen = stubSeenLookup([
    { openalexId: 'W777777', publishedOn: shiftISODate(TEST_TODAY, -14) },
  ]);

  test('three eligible candidates produce three papers, not five', () => {
    const result = selectForDay(shortPool(), selectOptions({ isSeen }));
    assert.equal(result.selected.length, 3);
    assert.deepEqual(idsOf(result.selected).sort(), [...eligibleIds].sort());
    assert.equal(result.shortfall, 2);
    assert.equal(result.shortfallReason, 'candidate-shortage');
  });

  test('no stale candidate appears in the result, however well it would have scored', () => {
    const result = selectForDay(shortPool(), selectOptions({ isSeen }));
    for (const padded of ['pad:stale-8', 'pad:stale-30']) {
      assert.equal(idsOf(result.selected).includes(padded), false, `${padded} was used as padding`);
      assert.equal(idsOf(result.ranked).includes(padded), false, `${padded} was scored at all`);
    }
    assert.equal(result.exclusionCounts.EXCL_STALE, 2);
  });

  test('no already-published and no abstract-less candidate appears either', () => {
    const result = selectForDay(shortPool(), selectOptions({ isSeen }));
    assert.equal(idsOf(result.selected).includes('pad:seen'), false);
    assert.equal(idsOf(result.selected).includes('pad:no-abstract'), false);
    assert.equal(result.exclusionCounts.EXCL_SEEN, 1);
    assert.equal(result.exclusionCounts.EXCL_NO_ABSTRACT, 1);
  });
});

describe('RISK-SELECT-13 — selection is deterministic under any input order', () => {
  /** A seeded LCG: the shuffle must be reproducible for the failure to be. */
  function shuffle<T>(items: readonly T[], seed: number): T[] {
    const out = [...items];
    let state = seed;
    for (let i = out.length - 1; i > 0; i--) {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      const j = state % (i + 1);
      const a = out[i];
      const b = out[j];
      if (a !== undefined && b !== undefined) {
        out[i] = b;
        out[j] = a;
      }
    }
    return out;
  }

  test('five shuffles of the same pool produce byte-identical selections', () => {
    const pool = fullPool();
    const expected = idsOf(selectForDay(pool, selectOptions()).selected);
    assert.equal(expected.length, 5);

    for (let seed = 1; seed <= 5; seed++) {
      const shuffled = shuffle(pool, seed * 7919);
      const actual = idsOf(selectForDay(shuffled, selectOptions()).selected);
      assert.deepEqual(actual, expected, `shuffle seed ${String(seed)} changed the selection`);
    }
  });

  test('the whole ranked list is stable too, not just the top five', () => {
    const pool = fullPool();
    const expected = idsOf(selectForDay(pool, selectOptions()).ranked);
    for (let seed = 1; seed <= 5; seed++) {
      const actual = idsOf(selectForDay(shuffle(pool, seed * 104_729), selectOptions()).ranked);
      assert.deepEqual(actual, expected);
    }
  });

  test('B.9 rule 5: two identically scored papers order by their OpenAlex ID', () => {
    // Same text, same date, same everything — only rule 5 can separate them.
    const later = makeCandidate({ id: 'openalex:W2', openAlexId: 'W2', subfieldId: 'subfields/A' });
    const earlier = makeCandidate({ id: 'openalex:W1', openAlexId: 'W1', subfieldId: 'subfields/B' });
    const result = selectForDay([later, earlier], selectOptions());
    assert.deepEqual(idsOf(result.ranked), ['openalex:W1', 'openalex:W2']);
  });
});

describe('RISK-SELECT-14 — papersPerDay and minPapersToPublish are independent knobs', () => {
  test('papersPerDay = 3 selects three; = 7 selects seven', () => {
    assert.equal(selectForDay(fullPool(), selectOptions({ papersPerDay: 3 })).selected.length, 3);

    const seven = selectForDay(fullPool(), selectOptions({ papersPerDay: 7 }));
    assert.equal(seven.selected.length, 7);
    for (const count of countBySubfield(seven.selected).values()) {
      assert.ok(count <= config.ranking.maxPerSubfield);
    }
  });

  test('the publish minimum moves on its own', () => {
    const pool = [
      makeCandidate({ subfieldId: 'subfields/A', ageDays: 0 }),
      makeCandidate({ subfieldId: 'subfields/B', ageDays: 1 }),
    ];
    assert.equal(selectForDay(pool, selectOptions({ minPapersToPublish: 2 })).belowMinimum, false);
    assert.equal(selectForDay(pool, selectOptions({ minPapersToPublish: 3 })).belowMinimum, true);
  });
});

describe('B.11 — the ranking block written into the JSON twin', () => {
  test('carries the score, the factors, the detail and the weights version', () => {
    const result = selectForDay(fullPool(), selectOptions());
    const first = result.selected[0];
    assert.ok(first);
    const record = rankingRecord(first, result);

    assert.equal(record.score, first.score.total);
    assert.equal(record.rank, 1);
    assert.equal(record.subfieldKey, first.score.subfieldKey);
    assert.equal(record.diversityRelaxed, false);
    assert.match(record.weightsVersion, /^[0-9a-f]{12}$/u);
    assert.deepEqual(record.factors, {
      explainability: first.score.explainability,
      everydayRelevance: first.score.everydayRelevance,
      freshness: first.score.freshness,
      credibility: first.score.credibility,
    });
  });

  test('the weights version changes when a weight changes, and only then', () => {
    const base = weightsVersion(config.ranking.weights, 7);
    assert.equal(base, weightsVersion({ ...config.ranking.weights }, 7));
    assert.notEqual(base, weightsVersion({ ...config.ranking.weights, freshness: 0.19 }, 7));
    assert.notEqual(base, weightsVersion(config.ranking.weights, 14));
  });
});
