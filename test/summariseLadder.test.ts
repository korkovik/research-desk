/**
 * §7.4's remediation ladder, driven end to end with a scripted model.
 *
 * The property under test is the one the spec cares about most: a paper whose
 * example cannot be traced to the source must not reach the page — and the
 * pipeline must reach that conclusion on its own, including when the verifier
 * itself is unreachable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseAndVerify, type SummariseOptions } from '../src/summarise/summarise.js';
import type { SourceText } from '../src/summarise/verify.js';
import type { LanguageCheckResult, PaperSummary } from '../src/types.js';
import { StubLlm, sequence } from './support/stubLlm.js';

const SOURCE: SourceText = {
  title: 'Twelve weeks of supervised resistance training and fall risk in adults aged 65 to 84',
  abstract:
    'We randomised 288 community-dwelling adults aged 65 to 84 to twelve weeks of supervised ' +
    'resistance training twice weekly at a local community centre, or to a control group ' +
    'receiving a printed falls-prevention leaflet. The training group reported 27% fewer falls ' +
    'over the follow-up year.',
  tldr: 'Twice-weekly resistance training reduced falls by 27% in adults aged 65 to 84.',
  venue: 'Age and Ageing',
  type: 'article',
  date: '2026-08-11',
};

const GOOD_EXAMPLE =
  'Lidé ve věku 65 až 84 let chodili dvakrát týdně posilovat do místního komunitního centra. ' +
  'Během následujícího roku upadli o 27 procent méně často.';
const BAD_EXAMPLE =
  'Lidé po čtyřicítce chodili dvakrát týdně posilovat do místního fitness centra v Brně.';

function summaryWith(example: string): Omit<PaperSummary, 'prikladJeMotivace'> {
  return {
    nadpis: 'Posilování dvakrát týdně snížilo počet pádů u seniorů',
    oCoJde: 'Vědci zkoušeli, jestli pravidelné posilování pomůže starším lidem méně padat. Pomohlo.',
    podrobneVysvetleni: 'x'.repeat(220),
    prikladZeZivota: example,
    procJeToDulezite: 'Pády jsou u starších lidí nejčastější příčinou úrazu, kvůli kterému skončí v nemocnici.',
    poznamkaKOmezenim: 'Účastníci si pády zapisovali sami a studie nebyla zaslepená.',
  };
}

/** Claims that pass every code-side rule, for whichever example is on trial. */
function supportedPayload(example: string) {
  return {
    claims: [
      {
        id: 'c1',
        claimText: 'Adults aged 65 to 84 trained twice weekly at a community centre',
        claimType: 'population' as const,
        exampleSpan: example,
        verdict: 'supported' as const,
        sourceQuote:
          'twelve weeks of supervised resistance training twice weekly at a local community centre',
        quoteField: 'abstract' as const,
      },
      {
        id: 'c2',
        claimText: 'The training group reported 27% fewer falls',
        claimType: 'quantity' as const,
        exampleSpan: example.slice(0, Math.max(8, Math.floor(example.length / 2))),
        verdict: 'supported' as const,
        sourceQuote: 'The training group reported 27% fewer falls over the follow-up year',
        quoteField: 'abstract' as const,
      },
    ],
    modelOverallVerdict: 'supported' as const,
    unsupportedReasonsCs: [],
  };
}

function unsupportedPayload(example: string) {
  return {
    claims: [
      {
        id: 'c1',
        claimText: 'People in their forties took part',
        claimType: 'population' as const,
        exampleSpan: example,
        verdict: 'unsupported' as const,
        sourceQuote: null,
        quoteField: null,
      },
    ],
    modelOverallVerdict: 'unsupported' as const,
    unsupportedReasonsCs: ['Ve zdroji nejsou lidé po čtyřicítce, ale lidé od 65 do 84 let.'],
  };
}

const noStyleFindings = (): LanguageCheckResult => ({ ok: true, status: 'pass', hard: [], soft: [] });

function options(overrides: Partial<SummariseOptions> = {}): SummariseOptions {
  return {
    language: 'cs',
    model: 'test-model',
    effort: 'high',
    maxTokens: 4000,
    maxRegenerationAttempts: 1,
    maxExampleAttempts: 2,
    verification: { model: 'test-model', effort: 'high', maxTokens: 2000, challengePass: false },
    checkStyle: noStyleFindings,
    ...overrides,
  };
}

test('a supported example is accepted on the first attempt', async () => {
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'verify-example': () => supportedPayload(GOOD_EXAMPLE),
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'ok');
  assert.equal(result.verification.resolution, 'accepted');
  assert.equal(result.summary.prikladJeMotivace, false);
});

test('a rejected example is regenerated and then accepted', async () => {
  const llm = new StubLlm({
    summarise: () => summaryWith(BAD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: GOOD_EXAMPLE }),
    'verify-example': sequence(unsupportedPayload(BAD_EXAMPLE), supportedPayload(GOOD_EXAMPLE)),
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'ok');
  assert.equal(result.verification.resolution, 'regenerated');
  assert.equal(result.summary.prikladZeZivota, GOOD_EXAMPLE);
  assert.equal(result.verification.rejections.length, 1);
});

test('when no example survives, the labelled motivation fallback is used — and is itself verified', async () => {
  const motivation = 'Pády jsou u starších lidí nejčastější příčinou úrazu, kvůli kterému skončí v nemocnici.';
  const llm = new StubLlm({
    summarise: () => summaryWith(BAD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: BAD_EXAMPLE }),
    'motivation-fallback': () => ({ motivace: motivation }),
    'verify-example': sequence(
      unsupportedPayload(BAD_EXAMPLE),
      unsupportedPayload(BAD_EXAMPLE),
      supportedPayload(motivation),
    ),
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'ok');
  assert.equal(result.verification.resolution, 'motivation-fallback');
  // §7.4 requires the reader to be told this is a motivation, not a finding.
  assert.equal(result.summary.prikladJeMotivace, true);
  assert.ok(llm.calls.filter((c) => c.startsWith('verify-example')).length >= 3);
});

test('a paper whose example never verifies is DROPPED, not published (§7.4)', async () => {
  const llm = new StubLlm({
    summarise: () => summaryWith(BAD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: BAD_EXAMPLE }),
    'motivation-fallback': () => ({ motivace: 'Vymyšlená motivace, která ve zdroji není.' }),
    'verify-example': () => unsupportedPayload(BAD_EXAMPLE),
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'dropped');
  assert.equal(result.reason, 'example_unverifiable');
  assert.equal(result.verification?.resolution, 'paper-dropped');
  // §11 step 8: "Log every rejection."
  assert.ok((result.verification?.rejections.length ?? 0) >= 4);
});

test('an unreachable verifier fails CLOSED — it never reads as approval', async () => {
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: GOOD_EXAMPLE }),
    'motivation-fallback': () => ({ motivace: 'Cokoliv.' }),
    'verify-example': () => {
      throw new Error('503 from the API');
    },
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'dropped');
  assert.equal(result.reason, 'example_unverifiable');
});

test('a verifier that fabricates its supporting quote does not get the paper published', async () => {
  const fabricated = supportedPayload(GOOD_EXAMPLE);
  fabricated.claims[0]!.sourceQuote = 'participants trained three times weekly at a gym in Brno';
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: GOOD_EXAMPLE }),
    'motivation-fallback': () => ({ motivace: 'Cokoliv, co ve zdroji není.' }),
    'verify-example': () => fabricated,
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'dropped');
  assert.ok(result.verification?.rejections.some((r) => r.fabricatedQuotes.length > 0));
});

test('the challenge pass can reject an example the first verifier approved', async () => {
  let call = 0;
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'regenerate-example': () => ({ prikladZeZivota: GOOD_EXAMPLE }),
    'motivation-fallback': () => ({ motivace: 'Cokoliv, co ve zdroji není.' }),
    'verify-example-challenge': () => unsupportedPayload(GOOD_EXAMPLE),
    'verify-example': () => {
      call += 1;
      return supportedPayload(GOOD_EXAMPLE);
    },
  });
  const result = await summariseAndVerify(
    llm,
    SOURCE,
    { isPreprint: false, categoryLabel: 'Zdraví a medicína' },
    options({ verification: { model: 'test-model', effort: 'high', maxTokens: 2000, challengePass: true } }),
  );
  assert.equal(result.status, 'dropped');
  assert.ok(call > 0);
});

test('an unreachable CHALLENGE pass is benign — the mandatory checks already ran', async () => {
  const warnings: string[] = [];
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'verify-example-challenge': () => {
      throw new Error('529 overloaded');
    },
    'verify-example': () => supportedPayload(GOOD_EXAMPLE),
  });
  const result = await summariseAndVerify(
    llm,
    SOURCE,
    { isPreprint: false, categoryLabel: 'Zdraví a medicína' },
    options({
      verification: {
        model: 'test-model',
        effort: 'high',
        maxTokens: 2000,
        challengePass: true,
        onWarn: (m) => warnings.push(m),
      },
    }),
  );
  assert.equal(result.status, 'ok');
  assert.equal(warnings.length, 1);
});

test('a style failure never drops a paper — it publishes the best attempt and logs', async () => {
  const errors: string[] = [];
  const failing = (): LanguageCheckResult => ({
    ok: false,
    status: 'fail',
    hard: [
      {
        block: 'nadpis',
        rule: 'hype',
        ruleId: 'hype:revoluč',
        span: { start: 0, end: 10 },
        matchedText: 'revoluční',
        detail: 'slovo „revoluční" je zakázané (§2)',
        messageCs: 'Slovo „revoluční" je zakázané. Napište, co konkrétně se změnilo.',
      },
    ],
    soft: [],
  });
  const llm = new StubLlm({
    summarise: () => summaryWith(GOOD_EXAMPLE),
    'verify-example': () => supportedPayload(GOOD_EXAMPLE),
  });
  const result = await summariseAndVerify(
    llm,
    SOURCE,
    { isPreprint: false, categoryLabel: 'Zdraví a medicína' },
    options({
      checkStyle: failing,
      log: { info: () => {}, warn: () => {}, error: (m) => errors.push(m) },
    }),
  );
  assert.equal(result.status, 'ok');
  assert.ok(errors.some((e) => e.includes('style regeneration exhausted')));
  // …and the finding is named again for what actually got published, which may
  // be a different example from the one the regeneration loop saw.
  assert.ok(errors.some((e) => e.includes('published with 1 unresolved style finding')));
});

test('a summarisation call that never completes drops the paper', async () => {
  const llm = new StubLlm({
    summarise: () => {
      throw new Error('500 from the API');
    },
  });
  const result = await summariseAndVerify(llm, SOURCE, { isPreprint: false, categoryLabel: 'Zdraví a medicína' }, options());
  assert.equal(result.status, 'dropped');
  assert.equal(result.reason, 'summarisation_failed');
});
