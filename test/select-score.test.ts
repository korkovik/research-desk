/**
 * DESIGN-NOTES B.2–B.6 — the four §6 factors and the weighted total.
 * Scenarios: RISK-SELECT-08, -09, -10, -12.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  credibilityOf,
  EXPLAINABILITY_GATE,
  everydayRelevanceOf,
  explainabilityOf,
  extractSampleSize,
  freshnessOf,
  openAccessScore,
  passesExplainabilityGate,
  peerReviewScore,
  scoreCandidate,
  type RankingWeights,
} from '../src/select/score.js';
import type { EnrichedCandidate } from '../src/types.js';
import {
  DEFAULT_ABSTRACT,
  makeCandidate,
  makeModestCandidate,
  makeUngatedCandidate,
  MODEST_ABSTRACT,
  resetCandidateSequence,
  selectOptions,
  TEST_TODAY,
  testConfig,
} from './support/candidates.js';

const config = testConfig();
const scoreOptions = {
  today: TEST_TODAY,
  weights: config.ranking.weights,
  freshnessDays: config.windows.freshnessDays,
};

beforeEach(resetCandidateSequence);

describe('B.3.2 worked example — the formula must keep producing 0.83', () => {
  // This is the one number DESIGN-NOTES pins down end to end. If a later
  // refactor quietly changes a cap, a weight or the title-doubling rule, this
  // is the test that notices.
  const worked = () =>
    makeCandidate({
      title:
        'Delaying school start times increases adolescent sleep: a two-year cohort study in 21 schools',
      abstract:
        'We asked what happens to teenage sleep when the school day starts later. Twenty one ' +
        'schools moved their first lesson from 8:00 to 9:00 and we followed the same young ' +
        'people for two years (n = 4213). We asked them to keep a sleep diary every week and ' +
        'we checked the diaries against a simple wrist sensor. On average they slept 34 minutes ' +
        'longer each night, and the gain held over the whole two years rather than fading after ' +
        'a few weeks. Reports of falling asleep in class fell by half.',
    });

  test('scores 0.83 ± 0.05', () => {
    const value = explainabilityOf(worked()).value;
    assert.ok(
      Math.abs(value - 0.83) <= 0.05,
      `expected 0.83 ± 0.05, got ${value.toFixed(4)}`,
    );
  });

  test('every component matches the worked breakdown v=0.5 s=1 q=1 c=1 t=0 j=0', () => {
    assert.deepEqual(explainabilityOf(worked()).detail, { v: 0.5, s: 1, q: 1, c: 1, t: 0, j: 0 });
  });

  test('it clears B.2’s 0.35 gate comfortably, as B.3.2 says it does', () => {
    const scored = { score: scoreCandidate(worked(), scoreOptions) };
    assert.ok(passesExplainabilityGate(scored));
    assert.ok(scored.score.explainability > EXPLAINABILITY_GATE + 0.4);
  });

  test('the evidence names the verb, the subjects and the number it found', () => {
    const evidence = explainabilityOf(worked()).evidence.join('\n');
    assert.match(evidence, /increases \(title, ×2\)/u);
    assert.match(evidence, /adolescents \(title, ×2\)/u);
    assert.match(evidence, /schools \(title, ×2\)/u);
    assert.match(evidence, /sample size/u);
  });
});

describe('B.3 explainability — the components behave as specified', () => {
  test('a title hit counts double, a body-only hit counts once', () => {
    const inTitle = makeCandidate({
      title: 'A study of eleven towns',
      abstract: 'x'.repeat(500),
    });
    const inBody = makeCandidate({
      title: 'A study of eleven places',
      abstract: `towns ${'x'.repeat(500)}`,
    });
    assert.equal(explainabilityOf(inTitle).detail.s, 0.5);
    assert.equal(explainabilityOf(inBody).detail.s, 0.25);
  });

  test('plural tolerance: the listed "adolescents" matches "adolescent" in the text', () => {
    const singular = makeCandidate({ title: 'Adolescent sleep and daylight', abstract: 'x'.repeat(500) });
    assert.ok(explainabilityOf(singular).detail.s > 0);
  });

  test('a methods-paper title is penalised on concreteness and on markers', () => {
    const detail = explainabilityOf(makeUngatedCandidate()).detail;
    // −0.4 method-word subtitle, −0.3 no verb or subject in the title.
    assert.equal(detail.c, 0.3);
    assert.equal(detail.t, 1);
    assert.equal(explainabilityOf(makeUngatedCandidate()).value, 0);
  });

  test('an over-long title and chemical strings both cost concreteness', () => {
    const wordy = makeCandidate({
      title:
        'On the question of whether it is the case that the thing which we have been looking at for a long time now is in fact happening at all',
      abstract: 'x'.repeat(500),
    });
    // −0.3 (no verb, no recognisable subject) −0.2 (28 words).
    assert.equal(explainabilityOf(wordy).detail.c, 0.5);

    const chemical = makeCandidate({
      title: 'Tetrakishydroxymethylphosphonium chloride and hexafluoroisopropanol interfaces',
      abstract: 'x'.repeat(500),
    });
    // −0.3 (no verb, no recognisable subject) −0.2 (two 15+ character tokens).
    assert.equal(explainabilityOf(chemical).detail.c, 0.5);
  });

  test('jargon density saturates at a tenth of the abstract', () => {
    const heavy = makeCandidate({
      abstract: `${'immunohistochemistry electroencephalography '.repeat(20)} short words here`,
    });
    assert.equal(explainabilityOf(heavy).detail.j, 1);
    assert.equal(explainabilityOf(makeCandidate()).detail.j, 0);
  });

  test('the gate predicate is exclusive below 0.35 and inclusive at it', () => {
    const at = { score: { ...scoreCandidate(makeCandidate(), scoreOptions), explainability: 0.35 } };
    const below = { score: { ...at.score, explainability: 0.3499 } };
    assert.equal(passesExplainabilityGate(at), true);
    assert.equal(passesExplainabilityGate(below), false);
  });
});

describe('RISK-SELECT-08 — explainability outranks citation count', () => {
  test('an everyday effect with 2 citations beats an incremental method with 500', () => {
    // §6 factor 1: "even if the latter is more cited". Citation count is
    // deliberately not a factor at all (B.6), so this must hold by construction.
    const method = makeUngatedCandidate({
      citedByCount: 500,
      venue: 'Nature',
      subfieldId: 'subfields/1700',
    });
    const everyday = makeCandidate({ citedByCount: 2, ageDays: 0, subfieldId: 'subfields/3206' });

    const methodScore = scoreCandidate(method, scoreOptions);
    const everydayScore = scoreCandidate(everyday, scoreOptions);
    assert.ok(
      everydayScore.total > methodScore.total,
      `${String(everydayScore.total)} should beat ${String(methodScore.total)}`,
    );
    assert.ok(everydayScore.explainability > methodScore.explainability);
  });
});

describe('B.4 everyday relevance', () => {
  test('a domain counts once however many of its terms hit', () => {
    const once = makeCandidate({ title: 'Sleep and daylight', abstract: 'x'.repeat(500) });
    const many = makeCandidate({
      title: 'Sleep, sleeping, insomnia, naps and bedtime',
      abstract: `circadian drowsiness sleepiness ${'x'.repeat(450)}`,
    });
    assert.deepEqual(everydayRelevanceOf(once).domains, ['sleep']);
    assert.deepEqual(everydayRelevanceOf(many).domains, ['sleep']);
    // Same single domain, so D is identical; only the term count H can differ.
    assert.ok(everydayRelevanceOf(many).value > everydayRelevanceOf(once).value);
  });

  test('three domains saturate D, and a fourth adds nothing to it', () => {
    const three = makeCandidate({
      title: 'Sleep, school and food',
      abstract: `students eat breakfast ${'x'.repeat(450)}`,
    });
    const five = makeCandidate();
    assert.ok(everydayRelevanceOf(three).domains.length >= 3);
    assert.ok(everydayRelevanceOf(five).domains.length >= 4);
    assert.equal(everydayRelevanceOf(three).value, everydayRelevanceOf(five).value);
  });

  test('a paper touching nothing recognisable scores zero', () => {
    const remote = makeCandidate({
      title: 'Spectral gaps of random unitary ensembles',
      abstract: 'x'.repeat(500),
    });
    assert.deepEqual(everydayRelevanceOf(remote).domains, []);
    assert.equal(everydayRelevanceOf(remote).value, 0);
  });
});

describe('RISK-SELECT-09 / B.5 — freshness', () => {
  test('today scores 1.0 and the window edge scores 0.0', () => {
    assert.equal(freshnessOf(makeCandidate({ ageDays: 0 }), TEST_TODAY, 7).value, 1);
    assert.equal(freshnessOf(makeCandidate({ ageDays: 7 }), TEST_TODAY, 7).value, 0);
  });

  test('the newer of two otherwise identical papers ranks first, five times running', () => {
    for (let run = 0; run < 5; run++) {
      resetCandidateSequence();
      const newer = makeCandidate({ ageDays: 1 });
      const older = makeCandidate({ ageDays: 6 });
      assert.ok(
        scoreCandidate(newer, scoreOptions).total > scoreCandidate(older, scoreOptions).total,
      );
    }
  });

  test('a future date is as fresh as today, never fresher', () => {
    const embargoed = makeCandidate({ ageDays: -3 });
    assert.equal(freshnessOf(embargoed, TEST_TODAY, 7).value, 1);
  });
});

describe('RISK-SELECT-10 — the credibility signal, one axis at a time', () => {
  const withAbstract = (abstract: string, spec: Partial<EnrichedCandidate> = {}) =>
    makeCandidate({ abstract, ...spec });

  test('peer-reviewed beats preprint, all else equal', () => {
    const article = withAbstract(DEFAULT_ABSTRACT, { isPreprint: false, sourceType: 'article' });
    const preprint = withAbstract(DEFAULT_ABSTRACT, {
      isPreprint: true,
      sourceType: 'preprint',
      venue: 'arXiv',
    });
    assert.equal(peerReviewScore(article), 1);
    assert.equal(peerReviewScore(preprint), 0.4);
    assert.ok(credibilityOf(article).value > credibilityOf(preprint).value);
  });

  test('proceedings sit between the two, as B.6 c1 specifies', () => {
    const proceedings = withAbstract(DEFAULT_ABSTRACT, { sourceType: 'proceedings-article', venue: null });
    assert.equal(peerReviewScore(proceedings), 0.6);
  });

  test('a larger study beats a smaller one, all else equal', () => {
    const big = withAbstract(`${MODEST_ABSTRACT} The sample was n = 2000.`);
    const small = withAbstract(`${MODEST_ABSTRACT} The sample was n = 20.`);
    assert.ok(credibilityOf(big).value > credibilityOf(small).value);
  });

  test('open access beats closed, all else equal', () => {
    const open = withAbstract(DEFAULT_ABSTRACT, { isOpenAccess: true, licence: 'cc-by' });
    const green = withAbstract(DEFAULT_ABSTRACT, { isOpenAccess: true, licence: null });
    const closed = withAbstract(DEFAULT_ABSTRACT, { isOpenAccess: false, licence: null });
    assert.equal(openAccessScore(open), 1);
    assert.equal(openAccessScore(green), 0.8);
    assert.equal(openAccessScore(closed), 0.3);
    assert.ok(credibilityOf(open).value > credibilityOf(closed).value);
  });

  test('B.6 c2 takes the largest n in the abstract, not the first', () => {
    assert.equal(extractSampleSize('We recruited n = 120 adults; the pooled cohort was n = 4 213.'), 4213);
    assert.equal(extractSampleSize('A survey of 1,200 households in three regions.'), 1200);
    assert.equal(extractSampleSize('No numbers of any kind here.'), null);
  });

  test('a missing n falls back to B.6’s 0.40, not to zero', () => {
    const noN = withAbstract(MODEST_ABSTRACT);
    assert.equal(extractSampleSize(MODEST_ABSTRACT), null);
    // 0.40*1 + 0.25*0.40 + 0.20*1 + 0.15*0.30 = 0.745
    assert.ok(Math.abs(credibilityOf(noN).value - 0.745) < 1e-9);
  });
});

describe('RISK-SELECT-12 — the weights come from config, not from the code', () => {
  const everydayRich = () =>
    makeCandidate({
      ageDays: 0,
      abstract: DEFAULT_ABSTRACT.replace(' (n = 1240)', ''),
      isPreprint: true,
      sourceType: 'preprint',
      venue: 'bioRxiv',
      isOpenAccess: false,
      licence: null,
    });
  const credible = () =>
    makeModestCandidate({ ageDays: 0, abstract: `${MODEST_ABSTRACT} In total n = 9000 plants were grown.` });

  test('the shipped weights are exactly the ones in config.json', () => {
    assert.deepEqual(selectOptions().weights, config.ranking.weights);
  });

  test('zeroing the everyday weight and raising credibility reverses the order', () => {
    const shipped = config.ranking.weights;
    const flipped: RankingWeights = {
      explainability: 0.4,
      everydayRelevance: 0,
      freshness: 0.18,
      credibility: 0.42,
    };

    const a = everydayRich();
    const b = credible();
    const withShipped = (c: EnrichedCandidate) => scoreCandidate(c, { ...scoreOptions, weights: shipped }).total;
    const withFlipped = (c: EnrichedCandidate) => scoreCandidate(c, { ...scoreOptions, weights: flipped }).total;

    assert.ok(withShipped(a) > withShipped(b), 'everyday-rich paper wins under the shipped weights');
    assert.ok(withFlipped(b) > withFlipped(a), 'credible paper wins once credibility is weighted highest');
  });
});

describe('B.11 — the breakdown carries everything the JSON twin needs', () => {
  test('explainDetail, everydayDomains and subfieldKey are all populated', () => {
    const scored = scoreCandidate(makeCandidate({ subfieldId: 'subfields/3206' }), scoreOptions);
    assert.equal(scored.subfieldKey, 'subfields/3206');
    assert.deepEqual(Object.keys(scored.explainDetail).sort(), ['c', 'j', 'q', 's', 't', 'v']);
    assert.ok(scored.everydayDomains.includes('school'));
    assert.ok(scored.evidence.length > 5);
    assert.match(scored.evidence[0] ?? '', /^total /u);
  });

  test('the evidence says out loud when a paper is below the gate', () => {
    const scored = scoreCandidate(makeUngatedCandidate(), scoreOptions);
    assert.ok(scored.evidence.some((line) => line.includes('BELOW the 0.35 explainability gate')));
  });
});
