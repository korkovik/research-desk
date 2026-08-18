/**
 * DESIGN-NOTES B.8 (greedy selection, relax pass) and B.10 (the subfield key).
 * Scenarios: RISK-SELECT-06, RISK-SELECT-07.
 *
 * §6's cap is a hard constraint by default: a day that cannot fill five slots
 * under it publishes fewer and says why. The relax pass exists but is opt-in,
 * behind `ranking.relaxDiversityToReachTarget`.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { countBySubfield, subfieldKey } from '../src/select/diversity.js';
import { selectForDay } from '../src/select/select.js';
import type { EnrichedCandidate, ScoredCandidate } from '../src/types.js';
import {
  makeCandidate,
  makeModestCandidate,
  makeUngatedCandidate,
  resetCandidateSequence,
  selectOptions,
} from './support/candidates.js';

beforeEach(resetCandidateSequence);

const idsOf = (papers: readonly ScoredCandidate[]): string[] => papers.map((p) => p.id);

describe('B.10 — the subfield key fallback chain', () => {
  test('1: the OpenAlex subfield id wins when present', () => {
    assert.equal(subfieldKey(makeCandidate({ subfieldId: 'subfields/2703' })), 'subfields/2703');
  });

  test('2: the field id is used when no subfield was classified', () => {
    const candidate = makeCandidate({ subfield: null, field: { id: 'fields/32', name: 'Psychology' } });
    assert.equal(subfieldKey(candidate), 'fields/32');
  });

  test('4: an arXiv preprint keys on its namespaced primary category', () => {
    // The arXiv adapter already writes `arxiv:cs.LG` into `subfield`, so B.10
    // step 4 arrives through step 1 rather than needing its own branch.
    const preprint = makeCandidate({
      id: 'arxiv:2608.16889',
      source: 'arxiv',
      subfield: { id: 'arxiv:cs.LG', name: 'cs.LG' },
      field: null,
    });
    assert.equal(subfieldKey(preprint), 'arxiv:cs.LG');
  });

  test('5: two unclassified papers get DIFFERENT keys, so they never block each other', () => {
    const a = makeCandidate({ subfield: null, field: null });
    const b = makeCandidate({ subfield: null, field: null });
    assert.notEqual(subfieldKey(a), subfieldKey(b));
    assert.match(subfieldKey(a), /^unknown:/u);
  });

  test('an empty-string id is treated as absent, not as a shared key', () => {
    const candidate = makeCandidate({ subfield: { id: '  ', name: '' }, field: null });
    assert.match(subfieldKey(candidate), /^unknown:/u);
  });
});

/** 8 top-scoring papers in A, then 2 in B, 1 in C, 1 in D — RISK-SELECT-06. */
function skewedPool(): EnrichedCandidate[] {
  const a = Array.from({ length: 8 }, (_, i) =>
    makeCandidate({ subfieldId: 'subfields/A', ageDays: i }),
  );
  const b = [
    makeModestCandidate({ subfieldId: 'subfields/B', ageDays: 0 }),
    makeModestCandidate({ subfieldId: 'subfields/B', ageDays: 1 }),
  ];
  const c = [makeModestCandidate({ subfieldId: 'subfields/C', ageDays: 0 })];
  const d = [makeModestCandidate({ subfieldId: 'subfields/D', ageDays: 0 })];
  return [...a, ...b, ...c, ...d];
}

describe('RISK-SELECT-06 / S11-06b — the cap is two per subfield', () => {
  test('five are returned and only two of them come from the dominant subfield', () => {
    const result = selectForDay(skewedPool(), selectOptions());
    assert.equal(result.selected.length, 5);
    for (const [key, count] of countBySubfield(result.selected)) {
      assert.ok(count <= 2, `${key} appears ${String(count)} times`);
    }
    assert.equal(countBySubfield(result.selected).get('subfields/A'), 2);
  });

  test('the two survivors of the capped subfield are its two HIGHEST-ranked papers', () => {
    // The cap must drop the lowest-ranked surplus, not an arbitrary one.
    const pool = skewedPool();
    const result = selectForDay(pool, selectOptions());
    const chosenA = result.selected.filter((p) => p.score.subfieldKey === 'subfields/A');
    const rankedA = result.ranked.filter((p) => p.score.subfieldKey === 'subfields/A');
    assert.deepEqual(idsOf(chosenA), idsOf(rankedA.slice(0, 2)));
  });

  test('the cap is read from config: at maxPerSubfield = 1 exactly one A appears', () => {
    const result = selectForDay(skewedPool(), selectOptions({ maxPerSubfield: 1 }));
    assert.equal(countBySubfield(result.selected).get('subfields/A'), 1);
    // Four subfields, one slot each: the day is short, and says so.
    assert.equal(result.selected.length, 4);
    assert.equal(result.shortfallReason, 'diversity-cap');
  });
});

/** Two subfields only: the cap of 2 allows four papers, no more. */
function twoSubfieldPool(): EnrichedCandidate[] {
  return [
    ...Array.from({ length: 3 }, (_, i) => makeCandidate({ subfieldId: 'subfields/A', ageDays: i })),
    ...Array.from({ length: 3 }, (_, i) =>
      makeModestCandidate({ subfieldId: 'subfields/B', ageDays: i }),
    ),
  ];
}

describe('RISK-SELECT-07(i) — the cap cannot be satisfied at five', () => {
  test('shipped default: four papers, a diversity shortfall, and no relax', () => {
    const result = selectForDay(twoSubfieldPool(), selectOptions());
    assert.equal(result.selected.length, 4);
    assert.equal(result.flags.diversityRelaxed, false);
    assert.equal(result.shortfall, 1);
    // The log must not send a reader looking at the adapters for a cap problem.
    assert.equal(result.shortfallReason, 'diversity-cap');
    assert.equal(result.belowMinimum, false);
    for (const count of countBySubfield(result.selected).values()) assert.ok(count <= 2);
  });

  test('with the relax flag on: five papers, three from one subfield, flagged', () => {
    const result = selectForDay(
      twoSubfieldPool(),
      selectOptions({ relaxDiversityToReachTarget: true }),
    );
    assert.equal(result.selected.length, 5);
    assert.equal(result.flags.diversityRelaxed, true);
    assert.equal(result.shortfall, 0);
    assert.equal(result.shortfallReason, 'none');
    const counts = [...countBySubfield(result.selected).values()].sort((x, y) => y - x);
    assert.deepEqual(counts, [3, 2]);
  });

  test('the relaxed cap is itself a ceiling — never four from one subfield', () => {
    const result = selectForDay(
      twoSubfieldPool(),
      selectOptions({ relaxDiversityToReachTarget: true, relaxedMaxPerSubfield: 3 }),
    );
    for (const count of countBySubfield(result.selected).values()) assert.ok(count <= 3);
  });
});

describe('RISK-SELECT-07(ii) — one subfield only: the day stays short', () => {
  const pool = (): EnrichedCandidate[] => [
    ...Array.from({ length: 5 }, (_, i) => makeCandidate({ subfieldId: 'subfields/A', ageDays: i })),
    // Papers that would happily fill the gap if the rules were negotiable.
    makeUngatedCandidate({ subfieldId: 'subfields/F' }),
    makeUngatedCandidate({ subfieldId: 'subfields/G' }),
  ];

  test('even relaxed to three, the day publishes three and reports the shortfall', () => {
    const result = selectForDay(pool(), selectOptions({ relaxDiversityToReachTarget: true }));

    assert.equal(result.selected.length, 3);
    assert.equal(result.shortfall, 2);
    assert.equal(result.flags.diversityRelaxed, true);

    // No fourth paper from the capped subfield…
    assert.equal(countBySubfield(result.selected).get('subfields/A'), 3);
    // …and no ungated paper either: the minimum of three was already met, so
    // B.8 step 7 never fires.
    assert.equal(result.flags.explainGateWaived, false);
    assert.equal(
      result.selected.every((p) => p.score.explainability >= 0.35),
      true,
    );
    assert.equal(result.belowMinimum, false);
  });

  test('the ungated papers are still ranked, they are simply not selected', () => {
    const result = selectForDay(pool(), selectOptions({ relaxDiversityToReachTarget: true }));
    const ungated = result.ranked.filter((p) => p.score.explainability < 0.35);
    assert.equal(ungated.length, 2);
    for (const paper of ungated) assert.ok(result.remainder.includes(paper));
  });
});
