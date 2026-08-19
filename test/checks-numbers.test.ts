/**
 * RISK-VOICE-09 — every number in block 3 has a plain-language anchor (§7.3).
 * RISK-VOICE-10 — block 2 contains no numbers (§7.2).
 * DESIGN-NOTES A.5.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBlock2NumeralBan, checkNumberAnchors, classify, findNumbers } from '../src/checks/numbers.js';
import { NEGATIVE_CONTROLS, styleConfig } from './helpers/style-fixtures.js';

const config = styleConfig();
const check = (text: string) => checkNumberAnchors('podrobneVysvetleni', text, config);

describe('RISK-VOICE-09 — the §7.3 example, both halves', () => {
  it('a bare `o 12 %` is hard', () => {
    const findings = check('Riziko kleslo o 12 %.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    const [f] = findings;
    assert.ok(f);
    assert.equal(f.severity, 'hard');
    assert.equal(f.rule, 'number_anchor:unanchored');
    assert.equal(f.matchedText, '12 %');
    assert.equal('Riziko kleslo o 12 %.'.slice(f.span.start, f.span.end), '12 %');
  });

  it('`o 12 % — tedy zhruba jeden člověk z osmi` passes — the spec\'s own §7.3 example', () => {
    assert.deepEqual(check('Riziko kleslo o 12 % — tedy zhruba jeden člověk z osmi.'), []);
  });

  it('an anchor in the immediately following sentence also counts (A.5.3)', () => {
    assert.deepEqual(check('Riziko kleslo o 12 %. To je zhruba jeden člověk z osmi.'), []);
  });

  it('a parenthesised restatement of ≥ 4 words counts (A.5.3, second route)', () => {
    assert.deepEqual(check('Riziko kleslo o 12 % (zhruba jeden člověk z osmi).'), []);
  });

  it('an anchor word with nothing after it does not count', () => {
    assert.equal(check('Riziko kleslo o 12 %, tedy.').length, 1);
  });
});

describe('A.5.2 — the exemption list, asserted explicitly so it cannot swallow effect sizes', () => {
  it('a year needs no anchor', () => assert.deepEqual(check('Studie vyšla v roce 2024.'), []));
  it('a bare 4-digit year needs no anchor', () => assert.deepEqual(check('Data pokrývají období od 1998 dál.'), []));
  it('a date needs no anchor', () => assert.deepEqual(check('Měření skončilo 1. 5. 2026 v poledne.'), []));
  it('an age or duration needs no anchor', () => assert.deepEqual(check('Šlo o 45 let staré domy.'), []));
  it('a temperature needs no anchor', () => assert.deepEqual(check('Venku bylo 21 °C celý den.'), []));

  it('a sample count is warn, not hard — A.5.2 says a raw count is self-explanatory', () => {
    const findings = check('Zapojilo se 240 dětí.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.severity, 'warn');
  });

  it('but a PERCENTAGE is never exempt, whatever surrounds it', () => {
    // A.5.2's last row: %, ‰, ×, krát, procentní bod and the word-form
    // magnitudes are ALWAYS hard if unanchored.
    for (const text of ['V roce 2024 kleslo riziko o 12 %.', 'Za 45 let stouplo o 30 procent.']) {
      const findings = check(text);
      assert.ok(
        findings.some((f) => f.severity === 'hard'),
        `${text} → ${JSON.stringify(findings)}`,
      );
    }
  });

  it('a spelled-out magnitude is hard when unanchored (A.5.1 word-form pass)', () => {
    const findings = check('Cena vzrostla na dvojnásobek.');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, 'hard');
    assert.equal(findings[0]?.matchedText, 'dvojnásobek');
  });

  it('classify reports the exemption it applied', () => {
    const text = 'Zapojilo se 240 dětí.';
    const [num] = findNumbers(text);
    assert.ok(num);
    assert.equal(classify(text, num).exemption, 'sample');
  });

  it('numbers inside a URL or DOI are never checked', () => {
    assert.deepEqual(check('Podrobnosti jsou na https://doi.org/10.1234/abc.5678 v tabulce.'), []);
  });
});

describe('RISK-VOICE-10 / A.5.4 — block 2 numeral ban (§7.2 "No numbers yet")', () => {
  it('any numeral in block 2 is hard', () => {
    const findings = checkBlock2NumeralBan('Riziko kleslo o 12 procent.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    const [f] = findings;
    assert.ok(f);
    assert.equal(f.severity, 'hard');
    assert.equal(f.rule, 'number_anchor:numbers_in_block2');
    assert.equal(f.block, 'oCoJde');
    assert.equal(f.matchedText, '12 procent');
  });

  it('a sample count is hard in block 2 too, even though A.5.2 warns on it elsewhere', () => {
    assert.equal(checkBlock2NumeralBan('Zapojilo se 240 dětí.').length, 1);
  });

  it('a year is the single A.5.4 exemption', () => {
    assert.deepEqual(checkBlock2NumeralBan('Studie vyšla v roce 2024.'), []);
  });

  it('an anchored number is still banned — §7.2 says no numbers, not "anchored numbers"', () => {
    assert.equal(checkBlock2NumeralBan('Riziko kleslo o 12 %, tedy zhruba u jednoho z osmi lidí.').length, 1);
  });

  it('clean block 2 text passes (the two-fixture pair of RISK-VOICE-10)', () => {
    assert.deepEqual(checkBlock2NumeralBan('Vědci chtěli vědět, jestli dřívější večerka pomůže dětem ve škole.'), []);
  });
});

describe('RISK-VOICE-09 — negative controls', () => {
  for (const control of NEGATIVE_CONTROLS) {
    it(`every number in the control is anchored or exempt: ${control.name}`, () => {
      const findings = [
        ...check(control.summary.podrobneVysvetleni),
        ...check(control.summary.prikladZeZivota),
        ...check(control.summary.procJeToDulezite),
        ...checkBlock2NumeralBan(control.summary.oCoJde),
      ];
      assert.deepEqual(findings.map((f) => `${f.rule}: ${f.matchedText}`), []);
    });
  }
});

/**
 * Regression guard for the anchor-detector fix.
 *
 * Every string in the first group is verbatim from `archive/2026-08-19.json` —
 * the first page this project ever produced from real papers. All seven were
 * hard-flagged as unanchored numbers, all seven were wrong, and between them
 * they cost four of five papers their full three-attempt regeneration budget.
 * The second group is the other half of the trade: loosen too far and §7.3
 * stops meaning anything, so these must keep failing.
 */
describe('A.5 anchor detection, calibrated against real generated Czech', () => {
  const hardCount = (text: string): number =>
    checkNumberAnchors('podrobneVysvetleni', text, config).filter((f) => f.severity === 'hard').length;

  const REAL_FALSE_POSITIVES: [string, string][] = [
    // The check was flagging §7.3's own anchor vocabulary — polovina, třetina,
    // čtvrtina and pětina are the words a plain-language anchor is made of.
    ['a restated fifth', 'Když srážky stouply o desetinu, vody v řece přibylo o 20,47 %, tedy asi o pětinu.'],
    ['a restated half', 'Oxid uhelnatý klesl o 54 %, tedy asi na polovinu.'],
    ['a restated quarter', 'Ozon jako jediný přibyl, a to o 23 %, tedy zhruba o čtvrtinu.'],
    // A raw count of things, with an adjective between the number and the noun.
    ['a count of provinces', 'Data sbírali za rok 2022 ve všech 81 tureckých provinciích.'],
    // A comparison to a named reference point.
    ['a comparison to WHO guidance', 'Průměr vyšel 27 mikrogramů — tedy 5,4krát víc, než doporučuje Světová zdravotnická organizace.'],
    // An em-dash gloss, which the jargon check already accepted and this one did not.
    ['a dash gloss', 'Rozdíly ve znečištění vysvětlily zhruba 41 % rozdílů mezi provinciemi — zbytek má jiné příčiny.'],
    // A rate denominator, which is the whole reason the figure means anything.
    ['a rate denominator', 'Podle výpočtu se s každým nárůstem pojí asi 3,2 úmrtí navíc na sto tisíc obyvatel.'],
  ];

  for (const [what, text] of REAL_FALSE_POSITIVES) {
    it(`does not hard-flag ${what} (real output, 2026-08-19)`, () => {
      assert.equal(hardCount(text), 0, text);
    });
  }

  const MUST_STILL_FAIL: [string, string][] = [
    ['a bare percentage', 'Riziko se u sledované skupiny snížilo o 12 %.'],
    ['two bare percentages', 'Výnos stoupl o 37 % a spotřeba vody klesla o 18 %.'],
    ['a bare multiplier', 'Riziko bylo 3,4krát vyšší.'],
    ['bare percentage points', 'Podíl se zvýšil o 6 procentních bodů.'],
    // The narrow test for the anchor-self exemption: no earlier number, no
    // anchor marker, so this spelled-out magnitude is asserting, not restating.
    ['a bare spelled-out magnitude', 'Zasaženy byly dvě třetiny.'],
  ];

  for (const [what, text] of MUST_STILL_FAIL) {
    it(`still hard-flags ${what}`, () => {
      assert.ok(hardCount(text) > 0, text);
    });
  }
});
