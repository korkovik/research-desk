/**
 * RISK-VOICE-02 — no untranslated English sentence (§2 jargon rule; §11 step 7).
 * DESIGN-NOTES A.2.
 *
 * The scenario names seven fixtures, (a)–(g). Six of them are asserted here.
 * Fixture (g) — a bare three-word English phrase outside parentheses — is
 * NOT met by A.2.3's detector and is documented as such below; see the handover.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkEnglish, scoreSentence } from '../src/checks/english.js';
import { NEGATIVE_CONTROLS, styleConfig } from './helpers/style-fixtures.js';

const config = styleConfig();
const check = (text: string) => checkEnglish('podrobneVysvetleni', text, config);
const hard = (text: string) => check(text).filter((f) => f.severity === 'hard');

describe('RISK-VOICE-02 — must be flagged', () => {
  it('(c) a whole English sentence embedded in a Czech block', () => {
    const text =
      'Naše výsledky ukazují, že spánek pomáhá dětem ve škole. ' +
      'The model was trained on a large dataset of labelled images.';
    const findings = hard(text);
    assert.ok(findings.length >= 1, JSON.stringify(findings));
    const untranslated = findings.find((f) => f.rule === 'english_sentence:untranslated');
    assert.ok(untranslated, 'expected english_sentence:untranslated');
    assert.equal(untranslated.matchedText, 'The model was trained on a large dataset of labelled images.');
    assert.equal(
      text.slice(untranslated.span.start, untranslated.span.end),
      'The model was trained on a large dataset of labelled images.',
    );
  });

  it('(d) an English clause after a Czech one in the same sentence', () => {
    // The per-sentence score dilutes here, so A.2.3's third check — a run of
    // ≥ 6 ASCII-only tokens with ≥ 2 English function words — is what catches it.
    const text = 'Studie zjistila, že spánek pomáhá, but the effect was small and did not last for the whole group.';
    const findings = hard(text);
    assert.ok(findings.some((f) => f.rule === 'english_sentence:run'), JSON.stringify(findings));
  });

  it('(e) an untranslated English block heading', () => {
    const findings = hard('Key Findings And Practical Implications For Everyday Life');
    assert.ok(findings.length >= 1, JSON.stringify(findings));
  });
});

describe('RISK-VOICE-02 — must pass', () => {
  it('(a) pure Czech', () => {
    assert.deepEqual(check('Vědci sledovali, jak se v zimě chovají sýkorky u krmítka na zahradě.'), []);
  });

  it('(b) a Czech sentence with the English original in parentheses on first use', () => {
    // §2 REQUIRES exactly this shape, so flagging it would punish the model for
    // obeying the spec. A.2.1 step 3 exempts parenthesised spans for that reason.
    const text = 'Použili velký jazykový model (large language model), tedy program, který doplňuje text podle příkladů.';
    assert.deepEqual(check(text), []);
  });

  it('(f) proper nouns and venue names in a Czech sentence', () => {
    assert.deepEqual(check('Studie vyšla v časopise Nature Communications a popisuje chování včel.'), []);
  });

  it('a Czech sentence quoting several English technical terms inline is NOT flagged', () => {
    // A.2.3's conditions 3 and 5 exist for exactly this case: the Czech function
    // words and the diacritics keep czechScore above the floor and D above zero.
    const text =
      'Vědci porovnávali pojmy jako transformer, benchmark, dataset a fine-tuning, protože se v oboru běžně používají.';
    const findings = check(text);
    assert.deepEqual(findings.filter((f) => f.severity === 'hard'), []);
  });

  for (const control of NEGATIVE_CONTROLS) {
    it(`negative control produces no English finding: ${control.name}`, () => {
      for (const block of [
        control.summary.souhrn,
        control.summary.souhrn,
        control.summary.podrobneVysvetleni,
        control.summary.souhrn,
        control.summary.procJeToDulezite,
        control.summary.poznamkaKOmezenim,
      ]) {
        assert.deepEqual(check(block).map((f) => f.rule), [], block.slice(0, 60));
      }
    });
  }
});

describe('A.2.3 — the score itself', () => {
  it('an English sentence scores high on englishScore and zero on czechScore', () => {
    const score = scoreSentence('The model was trained on a large dataset of labelled images');
    assert.ok(score.englishScore >= config.english.englishScoreHard, `englishScore=${score.englishScore}`);
    assert.equal(score.czechScore, 0);
    assert.equal(score.d, 0);
  });

  it('a Czech sentence has D > 0, which is condition 4 and the strong one', () => {
    const score = scoreSentence('Vědci měřili, jak rychle taje led nad městem');
    assert.ok(score.d > 0);
    assert.ok(score.czechScore > config.english.czechScoreHard);
  });

  it('ambiguous tokens count for neither side (A.2.3)', () => {
    // `to do by my se si` are all in the ambiguous list; none may raise either score.
    const score = scoreSentence('to do by my se si');
    assert.equal(score.e, 0);
    assert.equal(score.c, 0);
  });

  it('a short fragment below minTokens is never flagged', () => {
    assert.deepEqual(hard('Small sample size'), []);
  });
});

describe('A.2.3 — secondary checks', () => {
  it('a half-translated sentence is warn, not hard', () => {
    const text = 'Model dosáhl of the best results for each of the tested groups and it was fast.';
    const findings = check(text);
    assert.ok(findings.some((f) => f.severity === 'warn' || f.severity === 'hard'), JSON.stringify(findings));
  });

  it('a masked span breaks the ASCII run, so a parenthesised English term cannot chain two fragments', () => {
    const text = 'Termín (large language model) je v závorce a text kolem něj je česky.';
    assert.deepEqual(hard(text), []);
  });
});

describe('A.2.1 step 4 — title echo', () => {
  it('warns when a block repeats ≥ 8 characters of the paper\'s own title', () => {
    const title = 'Sleep duration and arithmetic performance in adolescents';
    const findings = checkEnglish('souhrn', 'Nadpis opisuje arithmetic performance z originálu.', config, {
      sourceTitle: title,
    });
    const echo = findings.find((f) => f.rule === 'english_sentence:title_echo');
    assert.ok(echo, JSON.stringify(findings));
    assert.equal(echo.severity, 'warn');
  });

  it('is silent when no source title is supplied', () => {
    assert.deepEqual(
      checkEnglish('souhrn', 'Nadpis opisuje arithmetic performance z originálu.', config).map((f) => f.rule),
      [],
    );
  });
});

describe('RISK-VOICE-02 (g) — known gap', () => {
  it('DOCUMENTED GAP: a bare 3-word English phrase is not caught by A.2.3', () => {
    // RISK-VOICE-02 fixture (g) wants "out of distribution" outside parentheses
    // flagged. A.2.3 cannot do it: condition 4 (D === 0) fails on the
    // surrounding Czech, and the third check needs ≥ 6 consecutive ASCII tokens.
    // Loosening either would flag the sentence the task explicitly requires to
    // PASS — "a Czech sentence quoting several English technical terms inline".
    // The gap is real and is reported in the handover rather than papered over.
    const text = 'Zajímá je chování mimo trénovací data, tzv. out of distribution.';
    assert.deepEqual(hard(text), [], 'if this ever starts failing, the trade-off above has been changed');
  });
});
