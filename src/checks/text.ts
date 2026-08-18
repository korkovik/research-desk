/**
 * Shared text mechanics for the §2 style checker (DESIGN-NOTES A.0.1, A.2.1,
 * A.2.2, A.3.1).
 *
 * Why this file exists at all: JavaScript's `\w`, `\b` and `\W` are ASCII-only.
 * A pattern written as `\brevoluč\w+` does not match `revoluční`, and `\b` fires *inside*
 * `přelomový` — silently, with no error, producing a checker that looks like it
 * works. A.0.1 therefore fixes the shape of every pattern in the checker:
 *
 *   - the `u` flag is always set,
 *   - the letter class is `\p{L}` and the digit class `\p{N}`,
 *   - the left boundary is `(?<!\p{L})` and the right boundary is `(?!\p{L})`.
 *
 * `compileStem` is the single place that shape is written down. Nothing in
 * `src/checks/**` may hand-write those boundaries — sixty hand-written copies is
 * exactly how one of them ends up wrong.
 *
 * Pure functions only: no I/O, no clock, no network.
 */

/**
 * Object Replacement Character. Not a letter (`\p{L}`), not a number (`\p{N}`),
 * not sentence-terminating punctuation — so a masked span is invisible to every
 * pattern in the checker while still occupying its original position.
 */
export const MASK_CHAR = '￼';

/** All the dash-ish characters a model emits where a plain hyphen belongs. */
const SEPARATOR_CLASS = '[\\s\\u00A0\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212-]+';
const SEPARATOR_SPLIT = /[\s\u00A0\u2010\u2011\u2012\u2013\u2014\u2212-]+/u;

/** The Czech letters that carry a diacritic. Used by A.2.3's `D` counter. */
export const CZECH_DIACRITIC_LETTERS = 'áčďéěíňóřšťúůýžĎŇŘŠŤŽÁČÉĚÍÓÚŮÝ';
const DIACRITIC_RE = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u;

/** Does this token carry at least one Czech diacritic? (A.2.3 counter `D`.) */
export function hasCzechDiacritic(token: string): boolean {
  return DIACRITIC_RE.test(token);
}

/**
 * A.0.1: NFC-normalise once and treat the result as canonical. Models emit
 * `ě`, `ř`, `ů` decomposed often enough that skipping this makes stem matching
 * fail on perfectly good Czech. Every offset reported by the checker is into
 * the NFC string, never into whatever arrived.
 */
export function toNfc(text: string): string {
  return text.normalize('NFC');
}

/**
 * Lower-case for matching **without changing the string length**, so an offset
 * into the lower-cased copy is the same offset in the NFC original.
 *
 * A.0.1 says plain `toLowerCase()` is safe for Czech, and it is — but this
 * checker also sees English leak text and paper titles, and a handful of code
 * points (`İ`, `ẞ` in some engines) do change length under `toLowerCase()`.
 * One such character anywhere in a block would shift every subsequent offset,
 * so any code point whose lower-case form is a different length is left alone.
 * That costs nothing: those characters never appear in Czech prose.
 */
export function lowerForMatching(text: string): string {
  const naive = text.toLowerCase();
  if (naive.length === text.length) return naive;
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CompileOptions {
  /**
   * What may follow the stem. `\p{L}*` (the A.0.1 default) is what makes one
   * entry cover Czech inflection: `revoluč` → revoluční / revolučně /
   * revolučního.
   */
  suffix?: string;
  /** Extra flags on top of the mandatory `gu`. */
  flags?: string;
}

/**
 * Compile a literal stem or phrase into the A.0.1 pattern shape:
 * `(?<!\p{L})stem\p{L}*(?!\p{L})`, `u` flag always on.
 *
 * Multi-word stems accept any run of whitespace or dash as the separator, which
 * is what A.1.3 asks for ("hyphen variants normalised — `-`, `‑`, `–`, and
 * space all treated as the same separator"): one entry covers `game-changing`,
 * `game changing` and `game–changing`.
 */
export function compileStem(stem: string, options: CompileOptions = {}): RegExp {
  const suffix = options.suffix ?? '\\p{L}*';
  const parts = stem
    .trim()
    .split(SEPARATOR_SPLIT)
    .filter((p) => p.length > 0)
    .map(escapeRegex);
  const body = parts.join(SEPARATOR_CLASS);
  return new RegExp(`(?<!\\p{L})${body}${suffix}(?!\\p{L})`, `gu${options.flags ?? ''}`);
}

/**
 * Compile a hand-written pattern body. Used only for the dozen lexicon entries
 * the design note itself writes as regex (`svat\p{L}+ grál`,
 * `raketov\p{L}+ (růst|nárůst)`) and for the non-letter-terminated acronym forms
 * (`p <`, `OR =`, `95% CI`) that the stem shape cannot express.
 *
 * The body must supply its own boundaries; `assertNoAsciiClasses` guards
 * against `\b`/`\w` sneaking in, and a unit test runs it over every lexicon
 * entry.
 */
export function compilePattern(body: string, options: CompileOptions = {}): RegExp {
  assertNoAsciiClasses(body);
  return new RegExp(body, `gu${options.flags ?? ''}`);
}

/**
 * Throws if a pattern uses the ASCII-only classes A.0.1 forbids. Cheap, and it
 * turns "silently wrong on Czech" into "fails at module load".
 */
export function assertNoAsciiClasses(source: string): void {
  // `\\b` (an escaped backslash followed by b) is fine; a lone `\b` is not.
  const offending = source.replace(/\\\\/gu, '').match(/\\[bBwW]/u);
  if (offending) {
    throw new Error(
      `pattern uses the ASCII-only class ${offending[0]} — A.0.1 forbids it; use \\p{L} boundaries: ${source}`,
    );
  }
}

// ---------------------------------------------------------------------------
// A.2.1 — masking
// ---------------------------------------------------------------------------

export type MaskKind = 'url' | 'doi' | 'paren' | 'title-echo' | 'number';

export interface MaskSpan {
  kind: MaskKind;
  start: number;
  end: number;
  /** The original text that was masked, so a finding can still quote it. */
  text: string;
}

export interface MaskedText {
  /** Same length as the input, masked spans replaced by `MASK_CHAR` runs. */
  text: string;
  spans: MaskSpan[];
}

export interface MaskOptions {
  urls?: boolean;
  dois?: boolean;
  /** §2 requires the English original in parentheses, so A.2.1 exempts them. */
  parens?: boolean;
  numbers?: boolean;
  /** A.2.1 step 4: the paper's own title, echoed back into a generated block. */
  sourceTitle?: string;
}

/**
 * A.2.1 masking. **Deviation, deliberate:** the design note suggests replacing
 * each span with `￼` + an index token. That changes the string length, which
 * means every later offset has to be translated through a mapping table — and
 * every check that forgets to translate reports a subtly wrong span. Replacing
 * each masked span with a *same-length* run of `MASK_CHAR` achieves the design
 * note's stated goal ("so offsets can be mapped back") with the identity
 * mapping, which cannot be got wrong. The span list still carries the original
 * text for anything that needs it.
 *
 * Order is A.2.1's order: URLs, DOIs, parenthesised spans, title echo, numbers.
 * URLs first matters — `https://doi.org/10.1234/x` must be masked as a URL
 * before the bare-DOI pattern can chew off half of it.
 */
export function mask(text: string, options: MaskOptions = {}): MaskedText {
  const chars = [...text];
  // Work on code units, not code points: offsets in this project are string
  // indices throughout, so an emoji in a title must not shift them.
  let out = text;
  const spans: MaskSpan[] = [];
  void chars;

  const apply = (re: RegExp, kind: MaskKind): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const found: MaskSpan[] = [];
    while ((m = re.exec(out)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      // Never mask something already masked — that would report the placeholder
      // as the matched text.
      if (m[0].includes(MASK_CHAR)) continue;
      found.push({ kind, start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length) });
    }
    for (const span of found) {
      out = out.slice(0, span.start) + MASK_CHAR.repeat(span.end - span.start) + out.slice(span.end);
      spans.push(span);
    }
  };

  if (options.urls !== false) apply(/https?:\/\/\S+/gu, 'url');
  if (options.dois !== false) apply(/10\.\d{4,9}\/\S+/gu, 'doi');
  if (options.parens === true) {
    // A.2.1 step 3: an unterminated `(` within 200 chars is NOT masked — a
    // runaway parenthesis is itself a defect and should stay visible.
    apply(/\([^()]{0,200}\)/gu, 'paren');
  }
  if (options.sourceTitle !== undefined && options.sourceTitle.length >= TITLE_ECHO_MIN) {
    for (const span of findTitleEchoes(out, options.sourceTitle)) {
      out = out.slice(0, span.start) + MASK_CHAR.repeat(span.end - span.start) + out.slice(span.end);
      spans.push({ ...span, text: text.slice(span.start, span.end) });
    }
  }
  if (options.numbers === true) {
    // "Numeric-only tokens and units" — the English detector must not read
    // `12` or `%` as evidence either way.
    apply(/(?<![\p{L}\p{N}])[−–-]?\p{N}[\p{N}\s.,]*(?:%|‰|×)?(?![\p{L}\p{N}])/gu, 'number');
  }

  spans.sort((a, b) => a.start - b.start);
  return { text: out, spans };
}

/** A.2.1 step 4: "≥ 8 consecutive characters equal to the source title". */
export const TITLE_ECHO_MIN = 8;

/**
 * Longest-first scan for runs of ≥ 8 characters shared with the paper's own
 * title. The renderer stores the original title separately (§7.6), so a
 * generated block echoing it is a defect regardless of language.
 */
export function findTitleEchoes(text: string, sourceTitle: string): Array<{ kind: MaskKind; start: number; end: number }> {
  const haystack = lowerForMatching(text);
  const needleSource = lowerForMatching(toNfc(sourceTitle));
  const found: Array<{ kind: MaskKind; start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= haystack.length - TITLE_ECHO_MIN) {
    let best = -1;
    let bestLen = 0;
    for (let len = needleSource.length; len >= TITLE_ECHO_MIN; len--) {
      for (let i = 0; i + len <= needleSource.length; i++) {
        const piece = needleSource.slice(i, i + len);
        if (piece.includes(MASK_CHAR)) continue;
        const at = haystack.indexOf(piece, cursor);
        if (at !== -1) {
          best = at;
          bestLen = len;
          break;
        }
      }
      if (best !== -1) break;
    }
    if (best === -1) break;
    found.push({ kind: 'title-echo', start: best, end: best + bestLen });
    cursor = best + bestLen;
  }
  return found;
}

/** True when the char range overlaps any masked span. */
export function isMasked(spans: readonly MaskSpan[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

// ---------------------------------------------------------------------------
// A.2.2 — Czech sentence splitting
// ---------------------------------------------------------------------------

/**
 * A.2.2's abbreviation list, verbatim, lower-cased and period-included.
 * A boundary candidate preceded by one of these is not a boundary.
 */
export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'tj.', 'tzv.', 'tzn.', 'atd.', 'apod.', 'např.', 'mj.', 'resp.', 'popř.', 'event.', 'cca.', 'cca',
  'č.', 'čís.', 'str.', 's.', 'obr.', 'tab.', 'kap.', 'odd.', 'sv.', 'roč.', 'vyd.', 'zn.', 'hod.',
  'min.', 'sek.', 'mld.', 'mil.', 'tis.', 'st.', 'stol.', 'n.l.', 'př.n.l.', 'viz', 'srov.', 'angl.',
  'lat.', 'dr.', 'ing.', 'mgr.', 'bc.', 'mudr.', 'rndr.', 'phdr.', 'judr.', 'prof.', 'doc.', 'ph.d.',
  'csc.', 'drsc.', 'm.j.', 'tel.', 'ul.', 'nám.',
]);

/**
 * A.2.2's month list: genitive forms (as used after an ordinal, `5. ledna`)
 * plus the nominatives. `září` is both, hence one entry.
 */
export const MONTHS: ReadonlySet<string> = new Set([
  'ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října',
  'listopadu', 'prosince',
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'říjen',
  'listopad', 'prosinec',
]);

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const TERMINATORS = /[.!?…]+/gu;
const OPENING_QUOTES = new Set(['„', '"', '“', '”', '‚', '‘', '»', '«', "'"]);

/**
 * Czech sentence splitter (A.2.2). A run of `[.!?…]+` is a real boundary only
 * if all five of A.2.2's conditions hold; the conditions exist so that
 * `5. ledna`, `21. století`, `1. 5. 2026`, `J. Novák`, `tj.` and a decimal
 * `3.5` do not manufacture sentences that then blow the readability metrics.
 *
 * **Addition beyond A.2.2:** a run of newlines is also treated as a boundary.
 * The design note is silent on it, but a paragraph break is unambiguously a
 * sentence break, and without it two paragraphs merge into one 60-word
 * "sentence" that fails R2 for no reason.
 */
export function splitSentences(text: string): Sentence[] {
  const boundaries: number[] = [];

  TERMINATORS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TERMINATORS.exec(text)) !== null) {
    const runStart = m.index;
    const runEnd = m.index + m[0].length;
    if (isRealBoundary(text, runStart, runEnd, m[0])) boundaries.push(runEnd);
  }

  // Paragraph breaks.
  const para = /\n+/gu;
  let p: RegExpExecArray | null;
  while ((p = para.exec(text)) !== null) boundaries.push(p.index + p[0].length);

  boundaries.sort((a, b) => a - b);

  const sentences: Sentence[] = [];
  let cursor = 0;
  for (const b of boundaries) {
    if (b <= cursor) continue;
    pushSentence(sentences, text, cursor, b);
    cursor = b;
  }
  if (cursor < text.length) pushSentence(sentences, text, cursor, text.length);
  return sentences;
}

function pushSentence(into: Sentence[], text: string, rawStart: number, rawEnd: number): void {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(text[start] ?? '')) start++;
  while (end > start && /\s/u.test(text[end - 1] ?? '')) end--;
  if (end <= start) return;
  into.push({ text: text.slice(start, end), start, end });
}

function isRealBoundary(text: string, runStart: number, runEnd: number, run: string): boolean {
  // (1) followed by whitespace (or EOS) and then an upper-case letter, a digit,
  //     an opening quote, or EOS.
  if (runEnd < text.length) {
    const next = text[runEnd] ?? '';
    if (!/\s/u.test(next)) return false;
    let i = runEnd;
    while (i < text.length && /\s/u.test(text[i] ?? '')) i++;
    if (i < text.length) {
      const ch = text[i] ?? '';
      const ok = /\p{Lu}/u.test(ch) || /\p{N}/u.test(ch) || OPENING_QUOTES.has(ch);
      if (!ok) return false;
    }
  }

  // (2) the token immediately before it — lower-cased, period included — is not
  //     an abbreviation. The back-scan takes letters, digits and periods so that
  //     `př.n.l.` and `ph.d.` are seen whole.
  let back = runStart;
  while (back > 0 && /[\p{L}\p{N}.]/u.test(text[back - 1] ?? '')) back--;
  const preceding = lowerForMatching(text.slice(back, runEnd));
  if (ABBREVIATIONS.has(preceding)) return false;
  // `viz` and `cca` are listed without a period but are followed by one often
  // enough that the period-stripped form has to be checked too.
  if (ABBREVIATIONS.has(lowerForMatching(text.slice(back, runStart)))) return false;

  // (3) not a decimal point written the English way (`3.5`).
  if (run === '.') {
    const beforeDigits = /\p{N}\s*$/u.test(text.slice(Math.max(0, runStart - 8), runStart));
    const afterDigits = /^\s*\p{N}/u.test(text.slice(runEnd, runEnd + 8));
    if (beforeDigits && afterDigits) return false;
  }

  // (4) not an ordinal. If the run is a single `.` preceded by 1–4 digits it is
  //     a boundary only if the next word is capitalised, is not a month, and the
  //     text does not read as a `d.m.yyyy` date starting at those digits.
  if (run === '.') {
    const digitMatch = /(\p{N}{1,4})$/u.exec(text.slice(Math.max(0, runStart - 4), runStart));
    const digits = digitMatch?.[1];
    if (digits !== undefined) {
      const nextWord = /^\s*([\p{L}]+)/u.exec(text.slice(runEnd, runEnd + 40));
      if (!nextWord || nextWord[1] === undefined) return false; // `1. 5. 2026`
      const word = nextWord[1];
      if (!/^\p{Lu}/u.test(word)) return false;
      if (MONTHS.has(lowerForMatching(word))) return false;
      const digitsStart = runStart - digits.length;
      if (/^\p{N}{1,2}\.\s?\p{N}{1,2}\.\s?(?:\p{N}{4})?/u.test(text.slice(digitsStart))) return false;
    }
  }

  // (5) not an initial (`J. Novák`): a single capital letter before the period.
  if (run === '.' && runStart >= 1) {
    const prev = text[runStart - 1] ?? '';
    const beforePrev = runStart >= 2 ? (text[runStart - 2] ?? '') : '';
    if (/\p{Lu}/u.test(prev) && !/\p{L}/u.test(beforePrev)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

export interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * A.2.3's tokeniser: `[\p{L}']+`, used by the English-likelihood score. Numbers
 * are deliberately not tokens here — A.2.1 masks them before this runs.
 */
export function tokenizeWords(text: string): Token[] {
  return collect(text, /[\p{L}'’]+/gu);
}

/**
 * The word counter used by every readability metric (A.3.2). Letter-or-digit
 * runs, apostrophes and internal hyphens included, so `12 %` counts as one word
 * and `česko-slovenský` counts as one — which is the rule RISK-VOICE-11 fixes
 * for reproducibility.
 */
export function countableWords(text: string): Token[] {
  return collect(text, /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
}

function collect(text: string, re: RegExp): Token[] {
  const out: Token[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// A.3.1 — Czech syllable counting
// ---------------------------------------------------------------------------

/**
 * A.3.1's prefixes. Longest match wins, and the guard only fires when the
 * character right after the prefix is a vowel — that is what stops `po|učit`
 * being read as the diphthong `pou`.
 */
const PREFIXES = ['přes', 'roz', 'bez', 'pod', 'nad', 'pro', 'ne', 'na', 'za', 'do', 'po', 'vy', 'ob', 'od']
  .sort((a, b) => b.length - a.length);

const VOWELS = new Set([...'aáeéěiíoóuúůyý']);
/** Placeholder for a diphthong that has already been reduced to one nucleus. */
const NUCLEUS = '#';

function isVowelish(ch: string | undefined): boolean {
  return ch !== undefined && (VOWELS.has(ch) || ch === NUCLEUS);
}

/**
 * Count syllables in one Czech word (A.3.1).
 *
 * **Honest accuracy statement, carried over from A.3.1:** this is a
 * ±1-syllable heuristic. It over-counts some loanwords (`neuron` → 3, arguably
 * 2) and under-counts nothing systematically. That is acceptable *only* because
 * every threshold in A.3.2 is an aggregate share or mean over the whole paper,
 * where a ±1 error on a few percent of tokens moves the mean by < 0.05. Do not
 * reuse this function anywhere a single word's count has to be right.
 */
export function countSyllables(rawWord: string): number {
  const word = lowerForMatching(toNfc(rawWord)).replace(/[^\p{L}]/gu, '');
  if (word.length === 0) return 0;

  // 1. Prefix guard.
  let marked = word;
  for (const prefix of PREFIXES) {
    if (word.length > prefix.length && word.startsWith(prefix) && VOWELS.has(word[prefix.length] ?? '')) {
      marked = `${prefix}|${word.slice(prefix.length)}`;
      break;
    }
  }

  // 2. Diphthongs — but never across the boundary marker.
  const segments = marked.split('|').map((seg) => seg.replace(/ou|au|eu/gu, NUCLEUS));
  const body = segments.join('');

  // 3. Vowel nuclei (adjacent non-diphthong vowels are separate syllables in
  //    Czech: na-u-čit, bi-o-log).
  let count = 0;
  for (const ch of body) if (isVowelish(ch)) count++;

  // 4. Syllabic consonants: r/l flanked by consonants, or consonant + word-final;
  //    plus a word-final `m` after a consonant (sedm, osm). A syllabic consonant
  //    directly adjacent to a vowel is not syllabic.
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : undefined;
    const next = i + 1 < body.length ? body[i + 1] : undefined;
    if (ch === 'r' || ch === 'l') {
      if (isVowelish(prev) || isVowelish(next)) continue;
      const flanked = prev !== undefined && next !== undefined;
      const finalAfterConsonant = prev !== undefined && next === undefined;
      if (flanked || finalAfterConsonant) count++;
    } else if (ch === 'm' && next === undefined && prev !== undefined && !isVowelish(prev)) {
      count++;
    }
  }

  // 5. Floor.
  return Math.max(1, count);
}
