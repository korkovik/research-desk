/**
 * A.5 — the number-anchor check. §7.3: "every number gets a plain-language
 * anchor ('o 12 % — tedy zhruba jeden člověk z osmi')".
 *
 * Two rules live here:
 *   - A.5.1–A.5.3: in blocks 3, 4 and 5, an unanchored number is hard.
 *   - A.5.4: in block 2 (§7.2 "No numbers yet") any number at all is hard,
 *     with the single exception of a year.
 */
import type { StyleConfig } from '../config.js';
import { countableWords, lowerForMatching, mask, splitSentences, type Sentence } from './text.js';
import type { BlockName, Finding } from './types.js';

/**
 * A.5.1's NUM pattern. Thousands separators are space / non-breaking space /
 * narrow no-break space / period; the decimal separator is a comma (Czech) or a
 * period (models mix them). The optional unit group is what makes `12 %` one
 * token rather than a number followed by a stray sign.
 */
const NUM_RE = new RegExp(
  '(?<![\\p{L}\\p{N}])' +
    '[−–-]?\\p{N}{1,3}(?:[ \\u00A0\\u202F.]\\p{N}{3})*(?:[.,]\\p{N}+)?' +
    '\\s?(?:%|‰|×|x|krát|procent\\p{L}*|promile|milion\\p{L}*|miliard\\p{L}*|tisíc\\p{L}*|' +
    'bod\\p{L}*|p\\.\\s?b\\.|procentní\\s+bod\\p{L}*)?' +
    '(?![\\p{L}\\p{N}])',
  'gu',
);

/**
 * A.5.1's word-form pass: spelled-out magnitudes that still need an anchor.
 * `polovina` is by far the most common of these in ordinary Czech, and it is
 * the one most likely to produce a false positive — see the report.
 */
const WORD_MAGNITUDE_RE =
  /(?<!\p{L})(?:dvojnásob\p{L}*|trojnásob\p{L}*|polovin\p{L}*|třetin\p{L}*|čtvrtin\p{L}*|pětin\p{L}*|desetin\p{L}*)(?!\p{L})/gu;

/**
 * A.5.2's last row: these units are **always** hard if unanchored, whatever the
 * exemption table says. A percentage is exactly the kind of number §7.3 was
 * written about — it means nothing to a reader without a comparison.
 */
const ALWAYS_ANCHORED_RE =
  /(?:%|‰|×|(?<!\p{L})x(?!\p{L})|krát|procent|promile|p\.\s?b\.|procentní\s+bod)/u;

// --- A.5.2 exemptions ---
const YEAR_RE = /^(?:1[5-9]\p{N}{2}|20\p{N}{2})$/u;
const DATE_RE = /\p{N}{1,2}\.\s?\p{N}{1,2}\.\s?\p{N}{4}/u;
const DATE_MONTH_RE =
  /\p{N}{1,2}\.\s?(?:ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince)/u;
const AGE_DURATION_RE =
  /^\s?(?:let|letý|leté|letých|letém|měsíc\p{L}*|týdn\p{L}*|týden|dní|dnů|dnech|hodin\p{L}*|minut\p{L}*|sekund\p{L}*)(?!\p{L})/u;
const SAMPLE_COUNT_RE =
  /^\s?(?:\p{L}+\s+){0,2}(?:lidí|osob\p{L}*|účastník\p{L}*|pacient\p{L}*|studentů|dětí|domácností|škol\p{L}*|zvířat|myší|včel|vzorků|domů|provinci\p{L}*|zemí|měst\p{L}*|obcí|stát\p{L}*|region\p{L}*|nemocnic\p{L}*|úmrtí|případ\p{L}*)(?!\p{L})/u;
/** Matched against the lower-cased tail, hence `°c`. */
const TEMPERATURE_RE = /^\s?°\s?c(?!\p{L})/u;

/**
 * A.5.3's anchor markers, verbatim. Longest first so `což znamená` is not
 * matched as the shorter `to je` hiding inside a different phrase.
 */
const ANCHOR_LITERALS = [
  'v praxi to znamená',
  'prakticky to znamená',
  'je to zhruba jako',
  'jinými slovy',
  'pro představu',
  'představte si',
  'což znamená',
  'to znamená',
  'pro srovnání',
  'zaokrouhleno',
  'podobně jako',
  'odpovídá to',
  'na každých',
  'z každých',
  'u každého',
  'je to jako',
  'přibližně',
  'neboli',
  'zhruba',
  'řádově',
  'což je',
  'čili',
  'tedy',
  'to je',
  'asi',
  'tj.',
  'jeden z',
  'dva z',
] as const;

/** A.5.3's two pattern-shaped markers. */
const ANCHOR_PATTERNS = [
  /(?<!\p{L})každ\p{L}+\s+\p{L}+\s+z(?!\p{L})/u,
  /(?<!\p{L})z\s+(?:deseti|dvaceti|padesáti|sta|stovky|tisíce)(?!\p{L})/u,
  // A comparison to a named reference point. "5,4krát víc, než doporučuje
  // Světová zdravotnická organizace" is about as good an anchor as a lay reader
  // gets: the number is given something to be relative to.
  /(?<!\p{L})než(?!\p{L})/u,
];

/**
 * Anchors that are complete in themselves, so unlike `ANCHOR_PATTERNS` they are
 * not required to be followed by further words.
 *
 * A rate denominator is the case: in "3,2 úmrtí navíc na sto tisíc obyvatel"
 * the denominator IS what makes 3,2 mean anything, and it usually ends the
 * sentence, so demanding three more words after it would reject the very
 * construction that does the anchoring.
 */
const SELF_SUFFICIENT_ANCHOR_PATTERNS = [
  /(?<!\p{L})na\s+(?:sto|tisíc|deset|dvacet|padesát|milion)\p{L}*/u,
];

export interface NumberMatch {
  start: number;
  end: number;
  text: string;
  kind: 'numeric' | 'word-magnitude';
}

/** Every number A.5.1 recognises, outside URLs and DOIs. */
export function findNumbers(text: string): NumberMatch[] {
  // URLs and DOIs are full of digits that are not claims about the world.
  const masked = mask(text, { urls: true, dois: true });
  const out: NumberMatch[] = [];
  for (const [re, kind] of [
    [NUM_RE, 'numeric'],
    [WORD_MAGNITUDE_RE, 'word-magnitude'],
  ] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(kind === 'numeric' ? masked.text : lowerForMatching(masked.text))) !== null) {
      if (m[0].trim().length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length), kind });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface NumberVerdict {
  /** `'exempt'` needs no anchor; `'sample'` is warn-only when unanchored. */
  exemption: 'none' | 'exempt' | 'sample';
  /** True when A.5.2's last row forces the anchor regardless of exemptions. */
  alwaysAnchored: boolean;
}

/**
 * True when the text before this point, within the same sentence, carries both
 * a digit and an anchor marker — i.e. this spelled-out magnitude is restating a
 * number rather than asserting a new one.
 */
function restatesAnEarlierNumber(lowered: string, at: number): boolean {
  const breakAt = Math.max(
    lowered.lastIndexOf('.', at - 1),
    lowered.lastIndexOf('!', at - 1),
    lowered.lastIndexOf('?', at - 1),
  );
  const before = lowered.slice(breakAt + 1, at);
  if (!/\p{N}/u.test(before)) return false;
  return ANCHOR_LITERALS.some((literal) => before.includes(literal));
}

/** A.5.2's exemption table, applied to one number in its context. */
export function classify(text: string, num: NumberMatch): NumberVerdict {
  const lowered = lowerForMatching(text);
  const after = lowered.slice(num.end, num.end + 24);
  const body = lowered.slice(num.start, num.end).trim();

  // A.5.2's last exemption row — specified and, until now, never implemented:
  // "numbers appearing inside a matched anchor phrase are not re-checked".
  //
  // It matters because §7.3's anchor vocabulary IS spelled-out magnitudes:
  // polovina, třetina, čtvrtina, pětina. So "…o 20,47 %, tedy asi o pětinu"
  // had the checker demanding an anchor for the anchor the model correctly
  // supplied — seven of seven surviving findings on the first real page were
  // this or one of three near neighbours.
  //
  // The test is deliberately narrow: a word-magnitude is the anchor only when,
  // earlier in the same sentence, there is BOTH a digit and an anchor marker.
  // That is the shape of a restatement. A bare "Zasaženy byly dvě třetiny" has
  // neither and is still flagged.
  if (num.kind === 'word-magnitude' && restatesAnEarlierNumber(lowered, num.start)) {
    return { exemption: 'exempt', alwaysAnchored: false };
  }

  const alwaysAnchored =
    num.kind === 'word-magnitude' || ALWAYS_ANCHORED_RE.test(lowered.slice(num.start, num.end));
  if (alwaysAnchored) return { exemption: 'none', alwaysAnchored: true };

  // Dates first: `1. 5. 2026` contains what looks like a bare year.
  const dateWindow = lowered.slice(Math.max(0, num.start - 12), num.end + 16);
  if (DATE_RE.test(dateWindow) || DATE_MONTH_RE.test(dateWindow)) return { exemption: 'exempt', alwaysAnchored: false };

  // Years. A.5.2 exempts a year "when adjacent to rok…/v roce/od roku/z roku,
  // or standing alone as a 4-digit number" — and a NUM match whose whole body is
  // a 4-digit year in 1500–2099 satisfies the second branch by construction, so
  // the adjacency test would never change the outcome.
  if (YEAR_RE.test(body)) return { exemption: 'exempt', alwaysAnchored: false };

  if (AGE_DURATION_RE.test(after)) return { exemption: 'exempt', alwaysAnchored: false };
  if (TEMPERATURE_RE.test(after)) return { exemption: 'exempt', alwaysAnchored: false };
  // A raw count is self-explanatory in a way a percentage is not, so A.5.2
  // makes an unanchored sample count warn rather than hard.
  if (SAMPLE_COUNT_RE.test(after)) return { exemption: 'sample', alwaysAnchored: false };

  return { exemption: 'none', alwaysAnchored: false };
}

/**
 * A.5.3. An anchor counts when it appears **after** the number, within the same
 * sentence or the immediately following one, and is itself followed by
 * ≥ `anchorMinWords` words. The lookahead into the next sentence is what makes
 * "…vzrostlo o 12 %. To je zhruba jeden člověk z osmi." legitimate prose rather
 * than a violation.
 */
export function isAnchored(sentences: readonly Sentence[], num: NumberMatch, config: StyleConfig): boolean {
  const index = sentences.findIndex((s) => num.start >= s.start && num.start < s.end);
  if (index === -1) return false;

  const scopes: string[] = [];
  const own = sentences[index];
  if (own) scopes.push(own.text.slice(num.end - own.start));
  for (let i = 1; i <= config.numbers.anchorLookaheadSentences; i++) {
    const next = sentences[index + i];
    if (next) scopes.push(next.text);
  }

  for (const scope of scopes) {
    const lowered = lowerForMatching(scope);
    for (const literal of ANCHOR_LITERALS) {
      const at = lowered.indexOf(literal);
      if (at === -1) continue;
      const before = at > 0 ? lowered[at - 1] : ' ';
      if (before !== undefined && /\p{L}/u.test(before)) continue;
      const rest = scope.slice(at + literal.length);
      if (countableWords(rest).length >= config.numbers.anchorMinWords) return true;
    }
    for (const pattern of ANCHOR_PATTERNS) {
      const m = pattern.exec(lowered);
      if (!m) continue;
      const rest = scope.slice(m.index + m[0].length);
      if (countableWords(rest).length >= config.numbers.anchorMinWords) return true;
    }
    for (const pattern of SELF_SUFFICIENT_ANCHOR_PATTERNS) {
      if (pattern.test(lowered)) return true;
    }
  }

  // A.5.3's second, independent way: the number is immediately followed by a
  // parenthesis restating it in ≥ 4 words — `o 12 % (zhruba jeden člověk z osmi)`.
  const ownSentence = sentences[index];
  if (ownSentence) {
    const tail = ownSentence.text.slice(num.end - ownSentence.start);
    const paren = /^\s{0,2}\(([^()]{0,200})\)/u.exec(tail);
    if (paren && countableWords(paren[1] ?? '').length >= config.numbers.parenRestatementMinWords) return true;

    // A dash gloss, which A.4.2 already accepts for jargon and A.5.3 never
    // spelled out for numbers: "…vysvětlily zhruba 41 % rozdílů — zbytek má
    // jiné příčiny." An em or en dash is deliberate "here comes the
    // explanation" punctuation; a comma is not, and is not accepted here.
    const dash = /[—–]\s*(.+)$/u.exec(tail);
    if (dash && countableWords(dash[1] ?? '').length >= config.numbers.anchorMinWords) return true;
  }

  return false;
}

/** A.5.1–A.5.3 over one of blocks 3, 4, 5. */
export function checkNumberAnchors(block: BlockName, text: string, config: StyleConfig): Finding[] {
  const sentences = splitSentences(text);
  const findings: Finding[] = [];

  for (const num of findNumbers(text)) {
    const verdict = classify(text, num);
    // `alwaysAnchored` already forces `exemption: 'none'`, so this one test
    // covers A.5.2's table and its "always hard" last row at once.
    if (verdict.exemption === 'exempt') continue;
    if (isAnchored(sentences, num, config)) continue;

    const severity = verdict.alwaysAnchored ? 'hard' : verdict.exemption === 'sample' ? 'warn' : 'hard';
    findings.push({
      check: 'number_anchor',
      severity,
      block,
      span: { start: num.start, end: num.end },
      matchedText: num.text,
      rule: 'number_anchor:unanchored',
      messageCs: unanchoredMessageCs(num.text.trim()),
    });
  }
  return findings;
}


export function unanchoredMessageCs(matched: string): string {
  return (
    `Číslo „${matched}“ nemá vysvětlení běžnými slovy (§7.3). ` +
    `Doplňte přirovnání, například „${matched} — tedy zhruba jeden člověk z osmi“.`
  );
}
