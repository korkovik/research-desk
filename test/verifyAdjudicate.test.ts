/**
 * §7.4 / §11 step 8 — the code-side half of the verification pass.
 *
 * These tests contain no model. They feed `adjudicate` the JSON a verifier
 * could return and assert what the CODE concludes, because the whole design
 * rests on the model's own verdict being advisory: a verifier that says
 * "supported" while citing a quote that is not in the source must be overruled,
 * and that is a property of this function, not of the model.
 *
 * Scenario IDs refer to docs/TEST-SCENARIOS.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicate, normaliseForQuoteMatch } from '../src/summarise/verify.js';
import type { VerificationPayload } from '../src/summarise/schema.js';
import type { SourceText } from '../src/summarise/verify.js';

const SOURCE: SourceText = {
  title: 'Delaying secondary school start time by 50 minutes and adolescent sleep duration',
  abstract:
    'Between September 2023 and June 2025 we followed 4,213 students aged 13 to 17 in 21 ' +
    'secondary schools in the Netherlands. Eleven schools moved their first lesson from ' +
    '08:00 to 08:50. Students in the later-start schools slept on average 26 minutes longer ' +
    'per school night than students in the comparison schools. End-of-year grade point ' +
    'averages did not differ between the two groups.',
  tldr: 'Moving the school day 50 minutes later increased adolescent sleep by about 26 minutes per night.',
  venue: 'Journal of Adolescent Health',
  type: 'article',
  date: '2026-08-14',
};

const EXAMPLE =
  'Ve dvaceti jedna nizozemských středních školách posunuli začátek vyučování na 8:50. ' +
  'Studenti pak spali každou školní noc v průměru o 26 minut déle.';

function payload(claims: VerificationPayload['claims']): VerificationPayload {
  return { claims, modelOverallVerdict: 'supported', unsupportedReasonsCs: [] };
}

/** Spans chosen to cover the whole example, so V6 is satisfied unless a test breaks it. */
const GOOD_CLAIMS: VerificationPayload['claims'] = [
  {
    id: 'c1',
    claimText: 'The study took place in 21 secondary schools in the Netherlands',
    claimType: 'setting',
    exampleSpan: 'Ve dvaceti jedna nizozemských středních školách posunuli začátek vyučování na 8:50.',
    verdict: 'supported',
    sourceQuote: 'we followed 4,213 students aged 13 to 17 in 21 secondary schools in the Netherlands',
    quoteField: 'abstract',
  },
  {
    id: 'c2',
    claimText: 'Students slept about 26 minutes longer per school night',
    claimType: 'quantity',
    exampleSpan: 'Studenti pak spali každou školní noc v průměru o 26 minut déle.',
    verdict: 'supported',
    sourceQuote: 'slept on average 26 minutes longer per school night',
    quoteField: 'abstract',
  },
];

test('RISK-VERIFY: a well-formed, genuinely supported example is accepted', () => {
  const report = adjudicate(payload(GOOD_CLAIMS), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'supported');
  assert.deepEqual(report.failures, []);
  assert.equal(report.fabricatedQuote, false);
  assert.ok(report.coverage > 0.9, `coverage was ${report.coverage}`);
});

test('RISK-VERIFY-20: a quote that is not in the source is a fabrication, not a pass', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.sourceQuote = 'we followed 4,213 students in 21 primary schools in Belgium';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.equal(report.fabricatedQuote, true);
  assert.ok(report.failures.some((f) => f.code === 'V4_FABRICATED_QUOTE'));
});

test('RISK-VERIFY-21: the model saying "supported" does not override the code', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[1]!.verdict = 'unsupported';
  claims[1]!.sourceQuote = null;
  claims[1]!.quoteField = null;
  const report = adjudicate(
    { claims, modelOverallVerdict: 'supported', unsupportedReasonsCs: [] },
    EXAMPLE,
    SOURCE,
  );
  assert.equal(report.modelVerdict, 'supported');
  assert.equal(report.verdict, 'unsupported');
});

test('a claim marked supported with no quote at all is rejected', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.sourceQuote = null;
  claims[0]!.quoteField = null;
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V3_QUOTE_TOO_WEAK'));
});

test('"quote the study to support everything" is rejected as too weak', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.sourceQuote = 'the two groups';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V3_QUOTE_TOO_WEAK'));
});

test('a real but unrelated quote does not support a claim', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimText = 'The intervention was carried out in Portuguese hospitals';
  claims[0]!.sourceQuote = 'End-of-year grade point averages did not differ between the two groups';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V7_QUOTE_IRRELEVANT'));
});

test('a quantity claim backed by a real quote containing no number is rejected', () => {
  // The quote below IS in the abstract, so this isolates the quantity rule from
  // the fabrication rule: a number claim needs a quoted number.
  const claims = structuredClone(GOOD_CLAIMS);
  claims[1]!.claimText = 'Students slept longer per school night';
  claims[1]!.sourceQuote = 'Students in the later-start schools slept on average 26 minutes longer';
  const withNumber = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(withNumber.verdict, 'supported');

  claims[1]!.sourceQuote = 'Eleven schools moved their first lesson from 08:00 to 08:50';
  claims[1]!.claimText = 'Schools moved the first lesson later';
  const withoutMatchingNumber = adjudicate(payload(claims), EXAMPLE, SOURCE);
  // Still supported — 08:50 is a number. Now a quote with no digits at all:
  claims[1]!.sourceQuote = 'End-of-year grade point averages did not differ between the two groups';
  claims[1]!.claimText = 'Grade point averages did not differ';
  const noDigits = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(withoutMatchingNumber.verdict, 'supported');
  assert.equal(noDigits.verdict, 'unsupported');
  assert.ok(noDigits.failures.some((f) => f.code === 'V7_QUOTE_IRRELEVANT'));
});

test('RISK-VERIFY: skipping the fabricated sentence is caught by span coverage (V6)', () => {
  // The lazy-verifier move: decompose only the true first sentence and quietly
  // omit the invented second one. Coverage makes the omission mechanically visible.
  const longExample = `${EXAMPLE} Ředitelé škol v Praze pak stejnou změnu zavedli i na prvním stupni, protože se jim výsledky líbily.`;
  const report = adjudicate(payload(GOOD_CLAIMS), longExample, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V6_COVERAGE_TOO_LOW'));
});

test('a span the verifier paraphrased instead of copying is caught (V5)', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.exampleSpan = 'Ve dvaceti jedna nizozemských školách změnili rozvrh';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.ok(report.failures.some((f) => f.code === 'V5_SPAN_NOT_IN_EXAMPLE'));
  assert.equal(report.verdict, 'unsupported');
});

test('one lump claim for a long example is a rubber-stamp signal', () => {
  const claims: VerificationPayload['claims'] = [
    {
      ...GOOD_CLAIMS[0]!,
      exampleSpan: EXAMPLE,
      claimText: 'The example describes the study',
      sourceQuote: 'we followed 4,213 students aged 13 to 17 in 21 secondary schools in the Netherlands',
    },
  ];
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.ok(report.failures.some((f) => f.code === 'DECOMPOSITION_TOO_COARSE'));
});

test('an example that decomposes into thirteen claims is too elaborate to be a lay example', () => {
  const claims = Array.from({ length: 13 }, (_, i) => ({
    ...GOOD_CLAIMS[0]!,
    id: `c${i + 1}`,
  }));
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.ok(report.failures.some((f) => f.code === 'EXAMPLE_TOO_ELABORATE'));
});

test('a venue string cannot support a mechanism claim (V8)', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimType = 'mechanism';
  claims[0]!.quoteField = 'venue';
  claims[0]!.claimText = 'Adolescent health journals explain why sleep improves';
  claims[0]!.sourceQuote = 'Journal of Adolescent Health article 2026-08-14';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
});

test('quote matching survives curly quotes, dashes and collapsed whitespace', () => {
  assert.equal(
    normaliseForQuoteMatch('  “Sleep”  —   26   minutes…  '),
    '"sleep" - 26 minutes...',
  );
  const claims = structuredClone(GOOD_CLAIMS);
  claims[1]!.sourceQuote = 'slept  on  average 26 minutes longer per school night';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'supported');
});
