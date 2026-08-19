/**
 * §2 — the locale layer.
 *
 * These tests do not judge the Czech (no one here can); they guard the
 * properties that do not need a native speaker: every key filled, the spec's
 * mandated wordings intact, no hype vocabulary, no placeholder the renderer
 * cannot fill, and no user-facing Czech hiding in the renderer itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringsCs } from '../src/render/strings.cs.js';
import { SUPPORTED_LANGUAGES, stringsFor } from '../src/render/strings.js';
import { REPO_ROOT } from './support/htmlAssertions.js';

/** §2 — "No hype. No 'revolutionary', 'breakthrough', 'game-changing'." */
const HYPE = ['revoluč', 'průlom', 'převratn', 'zázrač', 'senzač', 'game-chang', 'mění svět'];

/** Every slot the renderer knows how to fill. */
const KNOWN_PLACEHOLDERS = new Set([
  'site',
  'category',
  'date',
  'n',
  'total',
  'produced',
  'expected',
  'day',
  'month',
  'year',
]);

function allStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(stringsCs)) {
    if (typeof value === 'string') out.push([key, value]);
    else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'string') out.push([`${key}[${index}]`, item]);
      });
    }
  }
  return out;
}

test('every Czech string is present and non-empty', () => {
  const entries = allStrings();
  assert.ok(entries.length > 40, 'the table lost keys');
  for (const [key, value] of entries) {
    assert.notEqual(value.trim(), '', `${key} is empty`);
  }
  assert.equal(stringsCs.monthsInDates.length, 12);
});

test('no hype vocabulary anywhere in the Czech surface', () => {
  for (const [key, value] of allStrings()) {
    for (const word of HYPE) {
      assert.equal(value.toLowerCase().includes(word), false, `${key} uses hype word "${word}"`);
    }
  }
});

test('every {placeholder} is one the renderer knows how to fill', () => {
  for (const [key, value] of allStrings()) {
    for (const match of value.matchAll(/\{(\w+)\}/g)) {
      const name = match[1] ?? '';
      assert.ok(KNOWN_PLACEHOLDERS.has(name), `${key} uses unknown placeholder {${name}}`);
    }
  }
});

test('the §7 block headings are the ones the spec names', () => {
  // Block 1 has no heading: the headline is its own label.
  assert.equal(stringsCs.blockWhatItIsAbout, 'O co jde');
  assert.equal(stringsCs.blockDetail, 'Podrobné vysvětlení');
  assert.equal(stringsCs.blockExample, 'Příklad ze života');
  assert.equal(stringsCs.blockWhyItMatters, 'Proč je to důležité');
  assert.equal(stringsCs.blockReferences, 'Chci vědět víc');
});

test('the wordings §4.3 and §7.4 mandate are present verbatim', () => {
  assert.ok(stringsCs.preprintNotice.includes('zatím neprošlo recenzním řízením'));
  assert.ok(
    stringsCs.exampleIsMotivation.includes('Autoři to zmiňují jako důvod, proč studii dělali'),
  );
});

test('the language is chosen by config, and an unavailable one fails loudly', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['cs']);
  assert.equal(stringsFor('cs'), stringsCs);
  assert.throws(() => stringsFor('en'), /no string table for output.language="en"/);
});

/**
 * RISK-VOICE-08, scoped to the files this agent owns: user-facing Czech lives
 * in the locale layer or nowhere. A page rendered with `language = "en"` must
 * not leak Czech, and the only way to be sure is that the renderer contains
 * none.
 */
test('no Czech text hides in the renderer or the state layer', () => {
  const czechLetters = /[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]/;
  const files = [
    ...readdirSync(join(REPO_ROOT, 'src', 'render'))
      .filter((name) => name.endsWith('.ts') && name !== 'strings.cs.ts')
      .map((name) => join('src', 'render', name)),
    join('src', 'state', 'seen.ts'),
  ];

  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    const offenders = text
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => czechLetters.test(line));
    assert.deepEqual(
      offenders.map(([line, text_]) => `${file}:${line}: ${text_.trim()}`),
      [],
      'Czech text outside the locale layer',
    );
  }
});
