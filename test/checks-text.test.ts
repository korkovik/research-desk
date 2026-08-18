/**
 * DESIGN-NOTES A.0.1, A.2.1, A.2.2, A.3.1 — the shared text mechanics.
 *
 * These are the foundations every other check stands on. A bug here does not
 * produce a wrong finding, it produces a checker that quietly stops checking.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ABBREVIATIONS,
  compileStem,
  countableWords,
  countSyllables,
  lowerForMatching,
  mask,
  MASK_CHAR,
  MONTHS,
  splitSentences,
  toNfc,
  tokenizeWords,
} from '../src/checks/text.js';
import { compileEntries, HYPE_CS_HARD, HYPE_CS_WARN, HYPE_EN_HARD, HYPE_EN_WARN, JARGON_TERMS } from '../src/checks/lexicons.cs.js';

describe('A.0.1 — regex mechanics', () => {
  it('compileStem uses Unicode boundaries, so a stem matches Czech inflection', () => {
    const re = compileStem('revoluč');
    for (const form of ['revoluční', 'revolučně', 'revolučního']) {
      re.lastIndex = 0;
      assert.equal(re.test(form), true, `expected ${form} to match`);
    }
  });

  it('compileStem does NOT fire inside a longer word — the \\b trap of A.0.1', () => {
    // `\b` is ASCII-only and would fire in the middle of `přelomový`.
    const re = compileStem('lomov');
    re.lastIndex = 0;
    assert.equal(re.test('přelomový'), false);
  });

  it('compileStem treats space, hyphen and en dash as the same separator (A.1.3)', () => {
    const re = compileStem('game-changing');
    for (const form of ['game-changing', 'game changing', 'game–changing']) {
      re.lastIndex = 0;
      assert.equal(re.test(form), true, `expected ${form} to match`);
    }
  });

  it('every compiled lexicon pattern uses the u flag and no ASCII-only classes', () => {
    const all = [
      ...compileEntries([...HYPE_CS_HARD, ...HYPE_CS_WARN, ...HYPE_EN_HARD, ...HYPE_EN_WARN]),
      ...JARGON_TERMS.flatMap((t) => compileEntries(t.forms)),
    ];
    assert.ok(all.length > 150, `expected a substantial lexicon, got ${all.length} patterns`);
    for (const entry of all) {
      assert.ok(entry.re.unicode, `${entry.id} is missing the u flag`);
      assert.equal(/\\[bBwW]/u.test(entry.re.source.replace(/\\\\/gu, '')), false, `${entry.id} uses an ASCII-only class`);
    }
  });

  it('NFC normalisation makes a decomposed ě match a composed stem', () => {
    // `č` arrives as c + combining caron, which is what a model sometimes emits.
    const decomposed = 'revoluc\u030Cn\u0069\u0301';
    assert.notEqual(decomposed, 'revoluční');
    const re = compileStem('revoluč');
    assert.equal(re.test(decomposed), false, 'sanity: without NFC the stem cannot match');
    re.lastIndex = 0;
    assert.equal(re.test(toNfc(decomposed)), true);
  });

  it('lowerForMatching never changes the string length, so offsets survive', () => {
    for (const s of ['REVOLUČNÍ', 'İstanbul', 'Příliš žluťoučký kůň', 'ẞ']) {
      assert.equal(lowerForMatching(s).length, s.length, s);
    }
  });
});

describe('A.2.1 — masking preserves offsets', () => {
  it('masks a URL, a DOI and a parenthesised span without moving any character', () => {
    const text = 'Odkaz https://example.org/x je v textu, DOI 10.1234/abc.def, a gloss (neural network) taky.';
    const masked = mask(text, { parens: true });
    assert.equal(masked.text.length, text.length);
    assert.equal(masked.text.includes('https://'), false);
    assert.equal(masked.text.includes('neural network'), false);
    // Text outside the masked spans is untouched at the same offsets.
    assert.equal(masked.text.slice(0, 6), 'Odkaz ');
    for (const span of masked.spans) {
      assert.equal(masked.text.slice(span.start, span.end), MASK_CHAR.repeat(span.end - span.start));
      assert.equal(text.slice(span.start, span.end), span.text);
    }
  });

  it('leaves a runaway open parenthesis visible (A.2.1 step 3)', () => {
    const text = 'Text s otevřenou závorkou (a nikdy ji nezavře.';
    const masked = mask(text, { parens: true });
    assert.equal(masked.text, text);
  });
});

describe('A.2.2 — Czech sentence splitting', () => {
  const oneSentence = (text: string): void => {
    assert.deepEqual(
      splitSentences(text).map((s) => s.text),
      [text],
      text,
    );
  };

  it('does not break on an ordinal + month (`5. ledna`)', () => oneSentence('Studie vyšla 5. ledna a nikdo si jí nevšiml.'));
  it('does not break on `21. století`', () => oneSentence('Jde o největší sucho 21. století v regionu.'));
  it('does not break on a date `1. 5. 2026`', () => oneSentence('Měření skončilo 1. 5. 2026 v poledne.'));
  it('does not break on an initial (`J. Novák`)', () => oneSentence('Data sebral J. Novák z Brna.'));
  it('does not break on the abbreviation `tj.`', () => oneSentence('Šlo o třetinu vzorku, tj. asi třicet kusů.'));
  it('does not break on the abbreviation `např.`', () => oneSentence('Platí to např. u malých dětí a starších lidí.'));
  it('does not break on a decimal `3.5`', () => oneSentence('Hodnota byla 3.5 stupně nad průměrem.'));

  it('still splits real sentence boundaries', () => {
    const parts = splitSentences('Vědci měřili led. Pak měřili vítr! A co dál?');
    assert.deepEqual(parts.map((s) => s.text), ['Vědci měřili led.', 'Pak měřili vítr!', 'A co dál?']);
  });

  it('splits on a paragraph break even without terminal punctuation', () => {
    const parts = splitSentences('První odstavec bez tečky\n\nDruhý odstavec');
    assert.equal(parts.length, 2);
  });

  it('reports offsets into the original string', () => {
    const text = 'Vědci měřili led. Pak měřili vítr.';
    const [, second] = splitSentences(text);
    assert.ok(second);
    assert.equal(text.slice(second.start, second.end), 'Pak měřili vítr.');
  });

  it('ships A.2.2\'s full abbreviation and month lists', () => {
    // Spot-check the awkward multi-period entries and both month forms.
    for (const abbr of ['tj.', 'např.', 'př.n.l.', 'ph.d.', 'mudr.', 'nám.']) {
      assert.equal(ABBREVIATIONS.has(abbr), true, abbr);
    }
    assert.equal(ABBREVIATIONS.size, 55);
    for (const month of ['ledna', 'prosince', 'leden', 'září']) assert.equal(MONTHS.has(month), true, month);
    assert.equal(MONTHS.size, 23); // 12 genitive + 12 nominative, `září` shared
  });
});

describe('A.3.1 — Czech syllable counting', () => {
  // Every worked check from A.3.1, verbatim.
  const worked: ReadonlyArray<[string, number]> = [
    ['vlk', 1],
    ['prst', 1],
    ['čtvrt', 1],
    ['smrt', 1],
    ['krk', 1],
    ['osm', 2],
    ['vlkodlak', 3],
    ['koupit', 2],
    ['poučit', 3],
    ['naučit', 3],
    ['neurčitý', 4],
    ['srozumitelný', 5],
    ['výzkumníci', 4],
    ['elektřiny', 4],
  ];
  for (const [word, expected] of worked) {
    it(`${word} → ${expected}`, () => assert.equal(countSyllables(word), expected));
  }

  it('floors at one syllable', () => assert.equal(countSyllables('z'), 1));
});

describe('tokenisation', () => {
  it('countableWords counts a hyphenated compound once (RISK-VOICE-11)', () => {
    assert.equal(countableWords('česko-slovenský pokus').length, 2);
  });
  it('countableWords counts a number as a word, tokenizeWords does not', () => {
    assert.equal(countableWords('o 12 procent').length, 3);
    assert.equal(tokenizeWords('o 12 procent').length, 2);
  });
});
