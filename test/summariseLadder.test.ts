/**
 * §7 summarisation, and §2's rule that a style failure never drops a paper.
 *
 * This file used to drive §7.4's example-verification ladder end to end. That
 * block is no longer part of the page, so the ladder is no longer part of a
 * run — but the machinery is retained and still covered directly by
 * `verifyAdjudicate.test.ts`, which is where the rules that could reject a
 * fabricated example are exercised. What is left here is the loop that stayed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, type SummariseOptions } from '../src/summarise/summarise.js';
import type { SourceText } from '../src/summarise/verify.js';
import type { LanguageCheckResult, PaperSummary } from '../src/types.js';
import { StubLlm, sequence } from './support/stubLlm.js';

const SOURCE: SourceText = {
  title: 'Twelve weeks of supervised resistance training and fall risk in adults aged 65 to 84',
  abstract:
    'We randomised 288 community-dwelling adults aged 65 to 84 to twelve weeks of supervised ' +
    'resistance training twice weekly, or to a control group receiving a printed leaflet. ' +
    'The training group reported 27% fewer falls over the follow-up year.',
  tldr: 'Twice-weekly resistance training reduced falls by 27% in adults aged 65 to 84.',
  venue: 'Age and Ageing',
  type: 'article',
  date: '2026-08-11',
};

const CONTEXT = { isPreprint: false, categoryLabel: 'Zdraví a medicína' };

function summaryPayload(souhrn: string): PaperSummary {
  return {
    souhrn,
    podrobneVysvetleni: 'x'.repeat(220),
    procJeToDulezite: 'Pády jsou u starších lidí nejčastější příčinou úrazu, kvůli kterému skončí v nemocnici.',
    poznamkaKOmezenim: 'Účastníci si pády zapisovali sami a studie nebyla zaslepená.',
  };
}

const GOOD = 'Vědci zkoušeli, jestli pravidelné posilování pomůže starším lidem méně padat. Pomohlo.';

const clean = (): LanguageCheckResult => ({ ok: true, status: 'pass', hard: [], soft: [] });

function failing(): LanguageCheckResult {
  return {
    ok: false,
    status: 'fail',
    hard: [
      {
        block: 'souhrn',
        rule: 'hype',
        ruleId: 'hype:revoluč',
        span: { start: 0, end: 9 },
        matchedText: 'revoluční',
        detail: 'slovo „revoluční" je zakázané (§2)',
        messageCs: 'Slovo „revoluční" je zakázané. Napište, co konkrétně se změnilo.',
      },
    ],
    soft: [],
  };
}

function options(overrides: Partial<SummariseOptions> = {}): SummariseOptions {
  return {
    language: 'cs',
    model: 'test-model',
    effort: 'medium',
    maxTokens: 8000,
    maxRegenerationAttempts: 2,
    checkStyle: clean,
    ...overrides,
  };
}

test('a clean summary is produced in one call', async () => {
  const llm = new StubLlm({ summarise: () => summaryPayload(GOOD) });
  const result = await summarise(llm, SOURCE, CONTEXT, options());
  assert.equal(result.status, 'ok');
  assert.equal(result.summary.souhrn, GOOD);
  // The whole point of removing §7.4: one paper is now one call.
  assert.equal(llm.calls.length, 1);
});

test('a style failure regenerates, and stops as soon as it is clean', async () => {
  let call = 0;
  const llm = new StubLlm({ summarise: () => summaryPayload(GOOD) });
  const check = (): LanguageCheckResult => {
    call += 1;
    return call === 1 ? failing() : clean();
  };
  const result = await summarise(llm, SOURCE, CONTEXT, options({ checkStyle: check }));
  assert.equal(result.status, 'ok');
  assert.equal(llm.calls.length, 2);
});

test('§2 never drops a paper — the best attempt publishes, and says so', async () => {
  const errors: string[] = [];
  const llm = new StubLlm({ summarise: () => summaryPayload(GOOD) });
  const result = await summarise(
    llm,
    SOURCE,
    CONTEXT,
    options({
      checkStyle: failing,
      log: { info: () => {}, warn: () => {}, error: (m) => errors.push(m) },
    }),
  );
  assert.equal(result.status, 'ok');
  assert.ok(errors.some((e) => e.includes('published with 1 unresolved style finding')));
});

test('a regeneration that will not complete publishes what we already have', async () => {
  const llm = new StubLlm({
    summarise: sequence(summaryPayload(GOOD), new Error('529 overloaded')),
  });
  let call = 0;
  const check = (): LanguageCheckResult => {
    call += 1;
    return call === 1 ? failing() : clean();
  };
  const result = await summarise(llm, SOURCE, CONTEXT, options({ checkStyle: check }));
  assert.equal(result.status, 'ok', 'a bad night at the API must not cost a paper');
});

test('a first call that never completes drops the paper', async () => {
  const llm = new StubLlm({
    summarise: () => {
      throw new Error('500 from the API');
    },
  });
  const result = await summarise(llm, SOURCE, CONTEXT, options());
  assert.equal(result.status, 'dropped');
  assert.equal(result.reason, 'summarisation_failed');
});
