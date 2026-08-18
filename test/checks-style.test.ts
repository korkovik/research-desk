/**
 * The §2 style checker end to end — DESIGN-NOTES A.0 (block scope), A.1.4
 * (severity resolution), A.6 (warn budget and the regeneration loop).
 *
 * Covers TEST-SCENARIOS RISK-VOICE-01, -02, -03, -04, -09, -10 at the level the
 * pipeline actually calls: `checkStyle(summary, config)`.
 *
 * The load-bearing assertion in this file is the last describe block: **style
 * failure never drops a paper.** A.6 is explicit that only failed example
 * verification does that, and `docs/ASSUMPTIONS.md` A11 says the opposite, so
 * the code has to be unambiguous about which one it implements.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyseStyle,
  BLOCK_SCOPE,
  checkStyle,
  regenerationInstructions,
  resolveStatus,
  warnBudgetExceeded,
} from '../src/checks/index.js';
import type { Finding } from '../src/checks/types.js';
import { NEGATIVE_CONTROLS, styleConfig, summaryWith, CONTROL_LEDOVEC } from './helpers/style-fixtures.js';

const config = styleConfig();

describe('A.0 — block scope', () => {
  it('readability skips the nadpis and the reference block', () => {
    assert.deepEqual(BLOCK_SCOPE.readability, ['oCoJde', 'podrobneVysvetleni', 'prikladZeZivota', 'procJeToDulezite']);
  });

  it('number_anchor never looks at the nadpis or the limitation note', () => {
    assert.deepEqual(BLOCK_SCOPE.numberAnchor, ['podrobneVysvetleni', 'prikladZeZivota', 'procJeToDulezite']);
  });

  it('hype and english cover the limitation note; jargon does not', () => {
    assert.ok(BLOCK_SCOPE.hype.includes('poznamkaKOmezenim'));
    assert.ok(BLOCK_SCOPE.english.includes('poznamkaKOmezenim'));
    assert.equal(BLOCK_SCOPE.jargon.includes('poznamkaKOmezenim' as never), false);
  });

  it('a number in the reference-style limitation note is not a number-anchor finding', () => {
    const summary = summaryWith({ poznamkaKOmezenim: 'Studie zahrnula 24 lidí a trvala 6 týdnů.' });
    const result = checkStyle(summary, config);
    assert.deepEqual(
      [...result.hard, ...result.soft].filter((v) => v.rule === 'unanchored-number'),
      [],
    );
  });
});

describe('the negative controls pass the whole checker', () => {
  for (const control of NEGATIVE_CONTROLS) {
    it(`status is pass and ok is true: ${control.name}`, () => {
      const report = analyseStyle(control.summary, config);
      assert.deepEqual(
        report.findings.map((f) => `${f.severity} ${f.rule}: ${f.matchedText}`),
        [],
      );
      assert.equal(report.status, 'pass');
      const result = checkStyle(control.summary, config);
      assert.equal(result.ok, true);
      assert.equal(result.status, 'pass');
    });
  }
});

describe('the checker genuinely fails on bad output', () => {
  const bad = summaryWith({
    nadpis: 'Revoluční průlom, který navždy změní medicínu',
    oCoJde: 'Vědci udělali zásadní zlom. Riziko kleslo o 12 %.',
    podrobneVysvetleni:
      'Byla použita metaanalýza a p-hodnota byla nízká. The results were replicated in a second cohort of patients. ' +
      'Riziko kleslo o 12 % a to je vše.',
    prikladZeZivota: 'Představte si pacienta, kterému se sníží riziko.',
    procJeToDulezite: 'Je to zázrak.',
    poznamkaKOmezenim: 'Šlo o malou studii.',
  });
  const result = checkStyle(bad, config);

  it('fails', () => {
    assert.equal(result.status, 'fail');
    assert.equal(result.ok, false);
  });

  it('reports at least one finding from every check', () => {
    const rules = new Set([...result.hard, ...result.soft].map((v) => v.rule));
    for (const rule of ['hype', 'untranslated-english', 'unexplained-jargon', 'unanchored-number']) {
      assert.ok(rules.has(rule as never), `${rule} missing from ${[...rules].join(', ')}`);
    }
  });

  it('every violation carries a span that really points at its matched text', () => {
    const blocks: Record<string, string> = { ...bad } as unknown as Record<string, string>;
    for (const v of [...result.hard, ...result.soft]) {
      if (v.block === 'all') continue;
      const text = blocks[v.block];
      if (typeof text !== 'string') continue;
      if (v.span.start === 0 && v.span.end === 0) continue; // aggregate readability finding
      assert.equal(text.slice(v.span.start, v.span.end), v.matchedText, `${v.ruleId} in ${v.block}`);
    }
  });

  it('every hard violation carries a non-empty Czech message for the regeneration prompt', () => {
    for (const v of result.hard) {
      assert.ok(v.messageCs.length > 20, v.ruleId);
      assert.match(v.messageCs, /[ěščřžýáíéůúňťď]/u, `${v.ruleId} message does not look like Czech`);
    }
  });

  it('regenerationInstructions renders A.6 step 1\'s list', () => {
    const text = regenerationInstructions(result);
    assert.ok(text.startsWith('- ['), text.slice(0, 40));
    assert.equal(text.split('\n').length, result.hard.length);
    assert.ok(text.includes('konkrétně:'));
  });
});

describe('A.6 — the warn budget', () => {
  it('4 warn findings pass', () => {
    assert.equal(warnBudgetExceeded(4, 500, config), false);
  });

  it('5 warn findings tip the status to warn', () => {
    assert.equal(warnBudgetExceeded(5, 500, config), true);
  });

  it('the density half bites independently: 3 warns in a 200-word paper is over budget', () => {
    // A.6: at most 1 warn per 100 words of blocks 2–5, AND at most 4 per paper.
    assert.equal(warnBudgetExceeded(2, 200, config), false);
    assert.equal(warnBudgetExceeded(3, 200, config), true);
  });

  it('resolveStatus: warns within budget → pass', () => {
    assert.equal(resolveStatus(warns(4), 500, config), 'pass');
  });

  it('resolveStatus: warns over budget → warn', () => {
    assert.equal(resolveStatus(warns(5), 500, config), 'warn');
  });

  it('resolveStatus: a single hard finding → fail, regardless of the budget', () => {
    assert.equal(resolveStatus([...warns(1), hardFinding()], 500, config), 'fail');
  });
});

describe('A.6 — style failure never drops a paper', () => {
  it('warn status leaves ok true, so publication is not blocked', () => {
    // A.6 is explicit: warn status is logged and counted, never a block.
    // (`docs/ASSUMPTIONS.md` A11 says a paper that still fails is dropped;
    // A.6 overrides it for style — only failed example verification drops.)
    const withWarns = summaryWith({
      ...CONTROL_LEDOVEC,
      procJeToDulezite:
        'Výsledek je slibný a zároveň nadějný. Je to zcela mimořádné a naprosto fascinující zjištění pro obor.',
    });
    const result = checkStyle(withWarns, config);
    assert.equal(result.hard.length, 0, JSON.stringify(result.hard.map((v) => v.ruleId)));
    assert.ok(result.soft.length >= 5, JSON.stringify(result.soft.map((v) => v.ruleId)));
    assert.equal(result.status, 'warn');
    assert.equal(result.ok, true, 'warn status must never set ok:false');
  });

  it('ok is false only when a hard finding exists, and that means "regenerate"', () => {
    const result = checkStyle(summaryWith({ ...CONTROL_LEDOVEC, procJeToDulezite: 'Je to revoluční objev.' }), config);
    assert.equal(result.status, 'fail');
    assert.equal(result.ok, false);
    assert.equal(result.hard.length, 1);
  });
});

describe('purity', () => {
  it('the same input produces the same output, and the input is not mutated', () => {
    const before = JSON.stringify(CONTROL_LEDOVEC);
    const a = checkStyle(CONTROL_LEDOVEC, config);
    const b = checkStyle(CONTROL_LEDOVEC, config);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(CONTROL_LEDOVEC), before);
  });

  it('regexes are not left with a stale lastIndex between calls', () => {
    // Global regexes are stateful; a leaked lastIndex makes the second call on
    // identical text return fewer findings than the first.
    const text = summaryWith({ podrobneVysvetleni: 'Revoluční metoda. Revoluční metoda. Revoluční metoda.' });
    const first = checkStyle(text, config).hard.length;
    const second = checkStyle(text, config).hard.length;
    assert.equal(first, second);
    assert.ok(first >= 3, `expected all three hits, got ${first}`);
  });
});

function warns(count: number): Finding[] {
  return Array.from({ length: count }, (_unused, i) => ({
    check: 'hype' as const,
    severity: 'warn' as const,
    block: 'podrobneVysvetleni' as const,
    span: { start: i, end: i + 1 },
    matchedText: 'x',
    rule: `hype:test${i}`,
    messageCs: 'testovací hlášení',
  }));
}

function hardFinding(): Finding {
  return {
    check: 'hype',
    severity: 'hard',
    block: 'podrobneVysvetleni',
    span: { start: 0, end: 1 },
    matchedText: 'x',
    rule: 'hype:test-hard',
    messageCs: 'testovací hlášení',
  };
}
