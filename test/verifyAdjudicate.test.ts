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
import { describe, it, test } from 'node:test';
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
    claimText: 'In 21 secondary schools in the Netherlands the first lesson moved to 08:50',
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

test('one paraphrased claim does NOT sink a genuinely supported example', () => {
  // The negative control that matters: a lay re-wording shares no word stem with
  // its own source sentence ("worker bees" for "honeybee foragers"). Judging
  // every claim individually would reject good writing for being good writing.
  //
  // The paraphrased claim is given a number-free span on purpose: V9 requires a
  // number in the Czech to be accounted for by whatever supports it, so a
  // paraphrase may drop the wording but not the figures.
  const extra = 'Známky se přitom nezměnily.';
  const claims = structuredClone(GOOD_CLAIMS);
  claims.push({
    id: 'c3',
    claimText: 'Grades were unchanged between the groups',
    claimType: 'outcome',
    exampleSpan: extra,
    verdict: 'supported',
    sourceQuote: 'End-of-year grade point averages did not differ between the two groups',
    quoteField: 'abstract',
  });
  const report = adjudicate(payload(claims), `${EXAMPLE} ${extra}`, SOURCE);
  assert.equal(report.verdict, 'supported');
});

test('a SETTING claim backed by an unrelated quote is rejected on its own (V7)', () => {
  // Where a study happened is one of the three things a fabricated example
  // invents, and a genuine supporting sentence for it names the same place. An
  // unrelated but real quote here is a borrowed sentence covering an invented
  // claim — which V4 alone cannot see, because the quote really is in the source.
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimType = 'setting';
  claims[0]!.claimText = 'The trial ran in intensive care units and operating theatres';
  claims[0]!.sourceQuote = 'End-of-year grade point averages did not differ between the two groups';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V7_QUOTE_IRRELEVANT'));
});

test('a verifier whose quotes are unrelated to MOST claims is rejected (V7)', () => {
  const unrelated = 'End-of-year grade point averages did not differ between the two groups';
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimText = 'The intervention was carried out in Portuguese hospitals';
  claims[0]!.sourceQuote = unrelated;
  claims[1]!.claimText = 'Nurses washed their hands more often';
  claims[1]!.sourceQuote = unrelated;
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
  assert.ok(report.failures.some((f) => f.code === 'V7_QUOTE_IRRELEVANT'));
});

test('stem matching survives plurals, inflection and bare numbers', () => {
  // Each of these was a real false positive found by running the golden set.
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimText = 'The schools moved lessons later';
  claims[0]!.sourceQuote = 'Eleven schools moved their first lesson from 08:00 to 08:50';
  claims[1]!.claimText = 'Sleep rose by 26 minutes';
  claims[1]!.sourceQuote = 'slept on average 26 minutes longer per school night';
  assert.equal(adjudicate(payload(claims), EXAMPLE, SOURCE).verdict, 'supported');
});

test('a claim stating a magnitude needs a quote that states one', () => {
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimType = 'quantity';
  claims[0]!.claimText = 'Sleep increased by 26 minutes in 21 schools';
  claims[0]!.sourceQuote = 'we followed 4,213 students aged 13 to 17 in 21 secondary schools in the Netherlands';
  claims[1]!.claimType = 'quantity';
  claims[1]!.claimText = 'Sleep increased by 45 minutes';
  claims[1]!.sourceQuote = 'End-of-year grade point averages did not differ between the two groups';
  const report = adjudicate(payload(claims), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
});

test('a claim TYPED as a quantity but carrying no number is not punished for it', () => {
  // Found by the golden set: "The dose matched what bees meet in the field" was
  // typed `quantity` and quoted with a qualitative sentence. That is a
  // classification quibble, not a fabrication.
  const claims = structuredClone(GOOD_CLAIMS);
  claims[1]!.claimType = 'quantity';
  claims[1]!.claimText = 'Students slept longer than the comparison group';
  claims[1]!.sourceQuote =
    'Students in the later-start schools slept on average 26 minutes longer per school night';
  assert.equal(adjudicate(payload(claims), EXAMPLE, SOURCE).verdict, 'supported');
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

test('V9 accepts a lay rounding but not an invented figure', () => {
  // §7.3 asks the writer to round for the reader, so a source reporting 92.3 %
  // becomes "about 92" — and a verifier restating the precise figure must not
  // sink the paper for it. Found by measuring the rule against the calibration
  // set rather than by reasoning about it.
  const rounded = structuredClone(GOOD_CLAIMS);
  rounded[1]!.exampleSpan = 'Studenti pak spali každou školní noc v průměru o 26 minut déle.';
  rounded[1]!.claimText = 'Students slept 26.4 minutes longer per school night';
  rounded[1]!.sourceQuote = 'slept on average 26 minutes longer per school night';
  assert.equal(adjudicate(payload(rounded), EXAMPLE, SOURCE).verdict, 'supported');

  // The tolerance is a rounding, not a licence: an invented magnitude is
  // nowhere near a real one.
  const invented = structuredClone(GOOD_CLAIMS);
  invented[1]!.exampleSpan = 'Studenti pak spali každou školní noc v průměru o 26 minut déle.';
  invented[1]!.claimText = 'Students slept 90 minutes longer per school night';
  invented[1]!.sourceQuote = 'End-of-year grade point averages did not differ between the two groups';
  const report = adjudicate(payload(invented), EXAMPLE, SOURCE);
  assert.equal(report.verdict, 'unsupported');
});

test('V9 sees the units the seven categories actually produce', () => {
  // Found by measurement, not by reading: a trailing "not a letter" guard on the
  // whole alternation silently killed °C — the degree sign matched and the C
  // failed the guard — which is the worst single unit to miss for a digest whose
  // Wednesday is climate and Saturday is physics. And SI prefixes were spelled
  // out one at a time, so `gram` was known and `miligramů` was not.
  const claims = structuredClone(GOOD_CLAIMS);
  claims[0]!.claimType = 'outcome';
  claims[0]!.claimText = 'Students slept longer';
  claims[1]!.claimText = 'Students slept longer';
  claims[1]!.sourceQuote = 'slept on average 26 minutes longer per school night';

  for (const invented of [
    'Venku bylo o 10 °C tepleji.',
    'Spotřeba klesla o 40 kWh.',
    'Do vody se dostalo 5 miligramů látky.',
    'Hluk stoupl o 12 decibelů.',
    'Rodina ušetřila 900 eur.',
    'Tlak spadl o 2 bary.',
    'Naměřili 300 ppm.',
  ]) {
    claims[0]!.exampleSpan = invented;
    claims[1]!.exampleSpan = invented;
    const report = adjudicate(payload(claims), invented, SOURCE);
    assert.equal(report.verdict, 'unsupported', `V9 did not see the magnitude in: ${invented}`);
    assert.ok(report.failures.some((f) => f.code === 'V9_UNACCOUNTED_NUMBER'), invented);
  }

  // …and the things that are not magnitudes stay invisible to it.
  for (const innocent of [
    'Studie se týkala covidu-19 a proběhla v roce 2023.',
    'Postihlo to zhruba 1 z 8 lidí.',
    'Z každých 100 lidí jich bylo méně.',
  ]) {
    claims[0]!.exampleSpan = innocent;
    claims[1]!.exampleSpan = innocent;
    claims[0]!.claimText = 'The study concerned respiratory illness';
    claims[0]!.sourceQuote = 'we followed 4,213 students aged 13 to 17 in 21 secondary schools';
    const report = adjudicate(payload(claims), innocent, SOURCE);
    assert.equal(
      report.failures.some((f) => f.code === 'V9_UNACCOUNTED_NUMBER'),
      false,
      `V9 wrongly flagged: ${innocent}`,
    );
  }
});

describe('illustration mode — the line that keeps the guard worth having', () => {
  it('accepts an illustration that asserts nothing about the study', () => {
    // The writer's own framing, openly labelled as such on the page. It claims
    // to be a comparison, not a finding, so there is nothing to trace — and the
    // verifier returning no claims at all is the correct answer, not a failure.
    const empty = { claims: [], modelOverallVerdict: 'supported' as const, unsupportedReasonsCs: [] };
    const illustration =
      'Představte si to takto: je to rozdíl mezi tím, jestli si po obědě stihnete kávu, nebo ne.';
    assert.equal(adjudicate(empty, illustration, SOURCE, 'illustration').verdict, 'supported');
  });

  it('still rejects an illustration that smuggles in the study’s number', () => {
    // The failure worth preventing is a reader repeating an invented scene as
    // "research shows". Framing something as a comparison does not license
    // borrowing the study's figures for it.
    const smuggled = {
      claims: [
        {
          id: 'c1',
          claimText: 'Children fell asleep 45 minutes earlier',
          claimType: 'quantity' as const,
          exampleSpan: 'vaše dítě usne o 45 minut dřív',
          verdict: 'supported' as const,
          sourceQuote: 'End-of-year grade point averages did not differ between the two groups',
          quoteField: 'abstract' as const,
        },
      ],
      modelOverallVerdict: 'supported' as const,
      unsupportedReasonsCs: [],
    };
    const text = 'Představte si to takto: vaše dítě usne o 45 minut dřív.';
    const report = adjudicate(smuggled, text, SOURCE, 'illustration');
    assert.equal(report.verdict, 'unsupported');
  });

  it('does not let illustration mode weaken the study-mode contract', () => {
    // Same payload, same text, judged as a statement about the research: the
    // coverage and decomposition rules that illustration mode relaxes are still
    // in force here.
    const thin = {
      claims: [],
      modelOverallVerdict: 'supported' as const,
      unsupportedReasonsCs: [],
    };
    const asStudy = adjudicate(thin, EXAMPLE, SOURCE, 'study');
    assert.equal(asStudy.verdict, 'unsupported');
    assert.ok(asStudy.failures.some((f) => f.code === 'V6_COVERAGE_TOO_LOW'));
  });
});
