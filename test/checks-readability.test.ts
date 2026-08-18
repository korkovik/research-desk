/**
 * RISK-VOICE-04 — reading level: short sentences, active voice (§2).
 * DESIGN-NOTES A.3.
 *
 * The point of this suite is that the metrics move in both directions: academic
 * Czech trips R1–R7 and R9 hard, and the plain-Czech negative controls trip
 * nothing at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkNadpis,
  checkReadability,
  computeMetrics,
  findPeriphrasticPassive,
  hasReflexivePassive,
} from '../src/checks/readability.js';
import { NEGATIVE_CONTROLS, styleConfig } from './helpers/style-fixtures.js';

const config = styleConfig();

/** Academic Czech — a real abstract's register, written back at the reader. */
const ACADEMIC =
  'Reprodukovatelnost publikovaných výsledků byla ověřena prostřednictvím systematického přehledu randomizovaných ' +
  'kontrolovaných studií, přičemž metodologická kvalita jednotlivých zahrnutých prací byla hodnocena nezávisle dvěma ' +
  'posuzovateli podle standardizovaného nástroje pro posouzení rizika zkreslení. Statisticky významné rozdíly mezi ' +
  'experimentální a kontrolní skupinou byly zaznamenány pouze u podskupiny účastníků s vyšší výchozí hodnotou ' +
  'sledovaného biomarkeru, což naznačuje potenciální existenci moderujícího efektu, jehož mechanismus však zůstává ' +
  'nedostatečně objasněn a vyžaduje další longitudinální ověření v reprezentativnějším vzorku populace.';

describe('RISK-VOICE-04 — the checks genuinely fire', () => {
  const findings = checkReadability([{ block: 'podrobneVysvetleni', text: ACADEMIC }], config);
  const rules = findings.findings.map((f) => `${f.rule}:${f.severity}`);

  it('R1 mean sentence length is hard on academic Czech', () => {
    assert.ok(findings.metrics.meanSentenceWords > config.readability.meanSentenceWords.hard);
    assert.ok(rules.includes('readability:R1:hard'), rules.join(', '));
  });

  it('R2 flags the longest sentence and points at it', () => {
    const r2 = findings.findings.find((f) => f.rule === 'readability:R2');
    assert.ok(r2);
    assert.equal(r2.severity, 'hard');
    assert.ok(r2.matchedText.startsWith('Statisticky významné'), r2.matchedText.slice(0, 40));
    assert.equal(r2.block, 'podrobneVysvetleni');
  });

  it('R4, R5, R6 and R7 all fire hard', () => {
    for (const rule of ['R4', 'R5', 'R6', 'R7']) {
      assert.ok(rules.includes(`readability:${rule}:hard`), `${rule} did not hard-fire: ${rules.join(', ')}`);
    }
  });

  it('R3 fires warn, because this fixture has two long sentences and hard needs > 3', () => {
    // The direction matters more than the level: R3 must be able to warn on a
    // text that is not yet a hard reject, which is what a warn budget is for.
    assert.equal(findings.metrics.longSentenceCount, 2);
    assert.ok(rules.includes('readability:R3:warn'), rules.join(', '));
  });

  it('R9 composite index falls below the hard floor', () => {
    assert.ok(
      findings.metrics.compositeIndex < config.readability.compositeIndexFloor.hard,
      `I=${findings.metrics.compositeIndex}`,
    );
  });
});

describe('RISK-VOICE-04 — the checks genuinely pass', () => {
  for (const control of NEGATIVE_CONTROLS) {
    it(`plain Czech produces no readability finding: ${control.name}`, () => {
      const result = checkReadability(
        [
          { block: 'oCoJde', text: control.summary.oCoJde },
          { block: 'podrobneVysvetleni', text: control.summary.podrobneVysvetleni },
          { block: 'prikladZeZivota', text: control.summary.prikladZeZivota },
          { block: 'procJeToDulezite', text: control.summary.procJeToDulezite },
        ],
        config,
      );
      assert.deepEqual(
        result.findings.map((f) => `${f.rule} (${f.matchedText})`),
        [],
        JSON.stringify(result.metrics),
      );
      // And the numbers themselves sit where §2 wants them.
      assert.ok(result.metrics.meanSentenceWords <= config.readability.meanSentenceWords.warn);
      assert.ok(result.metrics.compositeIndex >= config.readability.compositeIndexFloor.warn);
    });
  }
});

describe('A.3.3 — periphrastic passive, the short-participle constraint', () => {
  it('`byl testován` matches', () => {
    const hit = findPeriphrasticPassive('Vzorek byl testován v laboratoři.');
    assert.ok(hit);
    assert.equal(hit.text, 'byl testován');
    assert.equal(hit.participle, 'testován');
  });

  it('`byl známý` does NOT match — it is an adjectival predicate, not a passive', () => {
    assert.equal(findPeriphrasticPassive('Ten postup byl známý už dřív.'), null);
  });

  it('`je důležitý` does NOT match', () => {
    assert.equal(findPeriphrasticPassive('Spánek je důležitý pro pozornost.'), null);
  });

  it('the ≥ 5-character floor rejects short lookalikes', () => {
    // `bude mít` ends in `t` but `mít` is three characters, so A.3.3's floor
    // keeps it out. Without the floor, PART_END's bare `t` would fire on it.
    assert.equal(findPeriphrasticPassive('Zítra bude mít volno.'), null);
  });

  it('allows up to two intervening words (A.3.3 GAP)', () => {
    assert.ok(findPeriphrasticPassive('Vzorky byly následně pečlivě zváženy.'));
  });
});

describe('A.3.4 — reflexive passive is warn-only and admittedly unreliable', () => {
  it('matches the narrow pattern', () => {
    assert.equal(hasReflexivePassive('Vzorky se analyzovaly ve dvou laboratořích.'), true);
  });

  it('also matches a true reflexive — precision is ~0.5 and that is why it never hard-fails', () => {
    assert.equal(hasReflexivePassive('Dítě se učí číst.'), true);
  });

  it('R8 never produces a hard finding, whatever the share', () => {
    const text = 'Vzorky se analyzovaly. Data se sbírala. Výsledky se počítaly. Zprávy se psaly.';
    const result = checkReadability([{ block: 'podrobneVysvetleni', text }], config);
    const r8 = result.findings.filter((f) => f.rule === 'readability:reflexive_passive');
    assert.equal(r8.length, 1, JSON.stringify(result.findings));
    assert.equal(r8[0]?.severity, 'warn');
  });
});

describe('A.3.2 — the nadpis rule outside the table (§7.1)', () => {
  it('accepts a short one-line title', () => {
    assert.deepEqual(checkNadpis('Ledovec nad městem taje rychleji, když fouká teplý vítr', config), []);
  });

  it('rejects a title over 14 words', () => {
    const long = 'Vědci z Norska zjistili, že ledovec nad malým severním městem taje mnohem rychleji, než se dosud myslelo';
    const rules = checkNadpis(long, config).map((f) => f.rule);
    assert.ok(rules.includes('readability:nadpis_words'), rules.join(', '));
  });

  it('rejects a title over 100 characters, the 390 px phone width of §11 step 9', () => {
    const wide = `${'Ledovec taje rychleji '.repeat(6)}dnes`;
    const rules = checkNadpis(wide, config).map((f) => f.rule);
    assert.ok(rules.includes('readability:nadpis_chars'), rules.join(', '));
  });

  it('rejects a two-sentence title', () => {
    const rules = checkNadpis('Ledovec taje rychleji. Vítr za to může.', config).map((f) => f.rule);
    assert.ok(rules.includes('readability:nadpis_sentences'), rules.join(', '));
  });
});

describe('A.3.5 — composite index', () => {
  it('matches the design note\'s reference points', () => {
    // I = 100 - (2.0 * meanSentenceWords + 25 * (meanSyllablesPerWord - 2.0)).
    // A.3.5: easy (11 words, 2.2 syll) → 73; academic (22 words, 2.9) → 33.5.
    const easy = 100 - (2.0 * 11 + 25 * (2.2 - 2.0));
    const academic = 100 - (2.0 * 22 + 25 * (2.9 - 2.0));
    assert.equal(easy, 73);
    assert.equal(academic, 33.5);
  });

  it('is computed from the real metrics, not hardcoded', () => {
    const { metrics } = computeMetrics('Vědci měřili led. Vítr byl teplý.', config.readability.longSentenceWords);
    const expected = 100 - (2.0 * metrics.meanSentenceWords + 25 * (metrics.meanSyllablesPerWord - 2.0));
    assert.equal(metrics.compositeIndex, expected);
  });
});
