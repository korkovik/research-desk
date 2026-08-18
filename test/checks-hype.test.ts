/**
 * RISK-VOICE-01 — hype vocabulary is absent (§2 "No hype.").
 * DESIGN-NOTES A.1.
 *
 * The scenario's pass criterion is 10/10 flagged and 0/10 false positives, with
 * matching that is diacritic- and case-insensitive and handles Czech inflection
 * by stem, not by exact string.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkHype } from '../src/checks/hype.js';
import { HYPE_CS_HARD, HYPE_CS_WARN, HYPE_EN_HARD, HYPE_EN_WARN } from '../src/checks/lexicons.cs.js';
import { HYPE_NEGATIVE, HYPE_POSITIVE, NEGATIVE_CONTROLS, styleConfig } from './helpers/style-fixtures.js';

const config = styleConfig();
const hard = (text: string) => checkHype('podrobneVysvetleni', text, config).filter((f) => f.severity === 'hard');
const all = (text: string) => checkHype('podrobneVysvetleni', text, config);

describe('RISK-VOICE-01 — the shipped lexicon matches A.1', () => {
  it('ships 35 Czech hard entries and 18 Czech warn entries (A.1.2 totals)', () => {
    assert.equal(HYPE_CS_HARD.length, 35, 'A.1.1 numbers 36 rows but flags #19 as a duplicate: ship 35');
    assert.equal(HYPE_CS_WARN.length, 18);
  });

  it('ships A.1.3\'s English leak list in full', () => {
    assert.equal(HYPE_EN_HARD.length, 34);
    assert.equal(HYPE_EN_WARN.length, 19);
  });

  it('covers every term RISK-VOICE-01 names as a minimum', () => {
    const required = [
      'revoluční', 'revoluce v', 'průlom', 'průlomový', 'převratný', 'zásadní zlom',
      'mění pravidla hry', 'senzační', 'zázračný', 'ohromující', 'neuvěřitelný', 'dramaticky',
      'poprvé v historii', 'svatý grál', 'revolutionary', 'breakthrough', 'game-changing',
      'unprecedented', 'groundbreaking',
    ];
    for (const term of required) {
      assert.ok(all(`Text obsahuje ${term} uprostřed věty.`).length > 0, `not detected: ${term}`);
    }
  });
});

describe('RISK-VOICE-01 — positives: 10/10 flagged', () => {
  for (const fixture of HYPE_POSITIVE) {
    it(`flags ${JSON.stringify(fixture.expectMatch)} as hard`, () => {
      const findings = hard(fixture.text);
      assert.equal(findings.length, 1, `expected exactly one hard finding, got ${JSON.stringify(findings)}`);
      const [only] = findings;
      assert.ok(only);
      assert.equal(only.matchedText, fixture.expectMatch);
      // The reported span must actually point at the matched text.
      assert.equal(fixture.text.slice(only.span.start, only.span.end), fixture.expectMatch);
      assert.ok(only.messageCs.includes(fixture.expectMatch));
    });
  }
});

describe('RISK-VOICE-01 — negatives: 0/10 false positives', () => {
  for (const text of HYPE_NEGATIVE) {
    it(`leaves clean Czech alone: ${text.slice(0, 40)}…`, () => {
      assert.deepEqual(all(text), [], text);
    });
  }

  for (const control of NEGATIVE_CONTROLS) {
    it(`negative control passes the hype check: ${control.name}`, () => {
      for (const block of [
        control.summary.nadpis,
        control.summary.oCoJde,
        control.summary.podrobneVysvetleni,
        control.summary.prikladZeZivota,
        control.summary.procJeToDulezite,
        control.summary.poznamkaKOmezenim,
      ]) {
        assert.deepEqual(all(block).map((f) => f.rule), [], block.slice(0, 60));
      }
    });
  }
});

describe('A.1.2 — the false-positive guards', () => {
  it('`revoluční` is hard', () => {
    const [f] = hard('Autoři to nazývají revoluční metodou.');
    assert.ok(f);
    assert.equal(f.rule, 'hype:revoluč');
    assert.equal(f.matchedText, 'revoluční');
  });

  it('`průmyslová revoluce` is NOT hard — A.1.2 entry 38', () => {
    const findings = all('Průmyslová revoluce změnila způsob práce v továrnách.');
    assert.deepEqual(findings.map((f) => f.severity), ['warn']);
    assert.equal(findings[0]?.rule, 'hype:revoluc');
  });

  it('`průlomová bolest` is NOT hard — A.1.2 entry 37\'s medical guard', () => {
    const findings = all('Pacienti popisovali průlomovou bolest mezi dávkami léku.');
    assert.deepEqual(findings.map((f) => f.severity), ['warn']);
  });

  it('`průlom v léčbě` IS caught by the same guard', () => {
    const findings = hard('Autoři mluví o průlomu v léčbě cukrovky.');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, 'hype:průlom-hyped');
  });

  it('`zlomová linie` is NOT a hard hit on a Wednesday-category text — A.1.2 entry 40', () => {
    const findings = all('Pod městem prochází zlomová linie, kterou geologové sledují už sto let.');
    assert.deepEqual(findings.map((f) => f.severity), ['warn']);
    assert.equal(findings[0]?.rule, 'hype:zlomov');
  });

  it('`zlomový okamžik` IS hard — A.1.1 entry 36\'s required guard', () => {
    const findings = hard('Pro celý obor to byl zlomový okamžik.');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.matchedText, 'zlomový okamžik');
  });
});

describe('A.1.3 — English leak, parenthesis exemption', () => {
  it('flags English hype in running text', () => {
    const [f] = hard('Tým to popisuje jako groundbreaking výsledek.');
    assert.ok(f);
    assert.equal(f.rule, 'hype:en:groundbreaking');
  });

  it('does NOT flag an English term that appears only inside parentheses (§2 term marker)', () => {
    // A.1.3: matched only outside parenthesised spans, because §2 legitimately
    // puts English originals in parentheses and `state-of-the-art` may appear
    // there as the term being glossed.
    const text = 'Šlo o nejlepší dostupný postup (state-of-the-art), tedy metodu, kterou dnes obor považuje za nejlepší.';
    assert.deepEqual(all(text), []);
  });

  it('normalises hyphen variants (A.1.3)', () => {
    for (const form of ['game-changing', 'game changing', 'game–changing']) {
      assert.equal(hard(`Autoři píší o ${form} results.`).length, 1, form);
    }
  });
});

describe('A.1.4 — severity resolution', () => {
  it('a hard entry and a warn entry at the same offset resolve to one hard finding', () => {
    const findings = all('Byl to zlomový okamžik pro celý obor.');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, 'hard');
    assert.equal(findings[0]?.matchedText, 'zlomový okamžik');
  });
});
