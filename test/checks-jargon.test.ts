/**
 * RISK-VOICE-03 — every jargon term is explained in the same sentence, with the
 * English original in parentheses on first use (§2 jargon rule).
 * DESIGN-NOTES A.4.
 *
 * The distinction this suite exists to protect: a parenthesis containing only
 * the English original is a §2 **term marker**, not a gloss. A checker that
 * accepts it passes exactly the output §2 was written to prevent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkJargon, countCzechWords } from '../src/checks/jargon.js';
import { JARGON_TERMS } from '../src/checks/lexicons.cs.js';
import { NEGATIVE_CONTROLS, styleConfig } from './helpers/style-fixtures.js';

const config = styleConfig();
const inBlock = (text: string) => checkJargon([{ name: 'podrobneVysvetleni', text }], config);

describe('RISK-VOICE-03 — the lexicon covers what the scenario names', () => {
  it('contains every term RISK-VOICE-03 lists', () => {
    const required = [
      'randomizovaná studie',
      'metaanalýza',
      'statisticky významný',
      'kohorta',
      'placebo',
      'p-hodnota',
      'konfidenční interval',
      'neuronová síť',
      'transformer',
      'in vitro',
      'biomarker',
    ];
    for (const term of required) {
      assert.ok(inBlock(`Text zmiňuje ${term} bez vysvětlení.`).length > 0, `not detected: ${term}`);
    }
  });

  it('transcribes A.4.1 completely — 86 terms across the five groups', () => {
    assert.equal(JARGON_TERMS.length, 86);
    // A.4.1's four named warn entries; everything else is hard.
    const warnIds = JARGON_TERMS.filter((t) => t.severity === 'warn').map((t) => t.id).sort();
    assert.deepEqual(warnIds, ['fotovoltaika', 'inzulin', 'kortizol', 'kvalitativni-analyza', 'median-prijmu']);
  });
});

describe('RISK-VOICE-03 — the four fixtures', () => {
  it('term with in-sentence gloss + parenthesised English → passes', () => {
    const text = 'Použili neuronovou síť (neural network), tedy program, který se učí z příkladů.';
    assert.deepEqual(inBlock(text), []);
  });

  it('term bare → fails hard', () => {
    const findings = inBlock('Model postavili na neuronové síti a pak ho otestovali.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    const [f] = findings;
    assert.ok(f);
    assert.equal(f.rule, 'jargon:no_gloss:neuronova-sit');
    assert.equal(f.severity, 'hard');
    assert.equal(f.matchedText, 'neuronové síti');
  });

  it('term glossed only in the NEXT sentence → fails (§2 says "in the same sentence")', () => {
    const text = 'Použili neuronovou síť. Je to program, který se sám učí z mnoha příkladů.';
    const findings = inBlock(text);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.rule, 'jargon:no_gloss:neuronova-sit');
  });

  it('a second use without parentheses after a correct first use → passes ("on first use")', () => {
    const text =
      'Použili neuronovou síť (neural network), tedy program, který se učí z příkladů. ' +
      'Tuto neuronovou síť pak pustili na nové fotky.';
    assert.deepEqual(inBlock(text), []);
  });
});

describe('A.4.2 — the critical distinction', () => {
  it('`neuronová síť (neural network)` ALONE is NOT a satisfied gloss', () => {
    // The English original is a §2 term marker, not an explanation. The two are
    // separate obligations and the checker must enforce both.
    const findings = inBlock('Použili neuronovou síť (neural network).');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.rule, 'jargon:no_gloss:neuronova-sit');
    assert.equal(findings[0]?.severity, 'hard');
  });

  it('`neuronová síť (neural network), tedy program, který se učí z příkladů` IS', () => {
    assert.deepEqual(inBlock('Použili neuronovou síť (neural network), tedy program, který se učí z příkladů.'), []);
  });

  it('a gloss without the English original is warn, not hard (A.4.2)', () => {
    const findings = inBlock('Použili neuronovou síť, tedy program, který se sám učí z příkladů.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.rule, 'jargon:no_english_original:neuronova-sit');
    assert.equal(findings[0]?.severity, 'warn');
  });

  it('a dash gloss satisfies condition 2', () => {
    assert.deepEqual(inBlock('Měřili medián — tedy prostřední hodnotu celé řady čísel.'), []);
  });

  it('a parenthetical gloss with ≥ 3 Czech words satisfies condition 3', () => {
    assert.deepEqual(inBlock('Měřili medián (prostřední hodnotu celé řady naměřených čísel).'), []);
  });

  it('countCzechWords is what tells a gloss from a term marker', () => {
    assert.equal(countCzechWords('neural network'), 0);
    assert.ok(countCzechWords('program, který se učí z příkladů') >= 3);
  });
});

describe('A.4.1 — first occurrence only, in output order', () => {
  it('only the first occurrence per paper needs a gloss, across blocks', () => {
    const findings = checkJargon(
      [
        { name: 'souhrn', text: 'Použili placebo, tedy tabletku bez účinné látky.' },
        { name: 'podrobneVysvetleni', text: 'Druhá skupina dostala placebo po celý měsíc.' },
      ],
      config,
    );
    assert.deepEqual(findings, []);
  });

  it('the finding lands on the FIRST block that used the term', () => {
    const findings = checkJargon(
      [
        { name: 'souhrn', text: 'Skupina dostala placebo.' },
        { name: 'podrobneVysvetleni', text: 'Placebo dostávali čtyři týdny.' },
      ],
      config,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.block, 'souhrn');
  });

  it('the longest match at an offset wins, so `medián příjmu` (warn) beats `medián` (hard)', () => {
    const findings = inBlock('Sledovali medián příjmu v kraji.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.severity, 'warn');
    assert.equal(findings[0]?.matchedText, 'medián příjmu');
  });
});

describe('A.4.3 — the message template', () => {
  it('quotes the Czech term and suggests the fix', () => {
    const [f] = inBlock('Model postavili na neuronové síti.');
    assert.ok(f);
    assert.equal(
      f.messageCs,
      'Termín „neuronová síť“ není v téže větě vysvětlen běžnými slovy. Doplňte vysvětlení (např. „…, tedy …“) nebo termín nepoužívejte.',
    );
  });
});

describe('RISK-VOICE-03 — negative controls', () => {
  for (const control of NEGATIVE_CONTROLS) {
    it(`produces no jargon finding: ${control.name}`, () => {
      const findings = checkJargon(
        [
          { name: 'souhrn', text: control.summary.souhrn },
          { name: 'souhrn', text: control.summary.souhrn },
          { name: 'podrobneVysvetleni', text: control.summary.podrobneVysvetleni },
          { name: 'souhrn', text: control.summary.souhrn },
          { name: 'procJeToDulezite', text: control.summary.procJeToDulezite },
        ],
        config,
      );
      assert.deepEqual(findings.map((f) => `${f.rule}: ${f.matchedText}`), []);
    });
  }
});
