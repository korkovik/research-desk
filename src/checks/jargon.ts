/**
 * A.4 — the jargon check. §2: "no unexplained technical term, ever. If a term
 * is unavoidable, explain it in the same sentence in plain words, and put the
 * English original in parentheses on first use."
 *
 * §2 states **two separate obligations** and A.4.2 is emphatic that they are
 * separate:
 *
 *   - a plain-words explanation, in the same sentence → missing is **hard**;
 *   - the English original in parentheses on first use → missing is **warn**.
 *
 * The distinction that makes or breaks this check: a parenthesis containing
 * only the English original — `neuronová síť (neural network)` — is the §2 term
 * marker, **not** a gloss. It does not satisfy the explanation obligation. A
 * checker that accepts it passes exactly the output §2 was written to prevent.
 *
 * A.4.1's rule of application: only the **first** occurrence per paper must be
 * glossed, and occurrence order is computed over blocks in output order
 * (nadpis → oCoJde → podrobne → priklad → proc).
 */
import type { StyleConfig } from '../config.js';
import {
  compileEntries,
  CS_FUNCTION,
  JARGON_TERMS,
  type CompiledEntry,
  type JargonEntry,
} from './lexicons.cs.js';
import { hasCzechDiacritic, lowerForMatching, splitSentences, tokenizeWords } from './text.js';
import type { BlockName, Finding } from './types.js';

/** A.4.2 condition 1 — explanatory connectives, verbatim. */
const CONNECTIVES = [
  'tedy jinak řečeno',
  'zjednodušeně řečeno',
  'jinými slovy',
  'jinak řečeno',
  'laicky řečeno',
  'to znamená',
  'což znamená',
  'tomu se říká',
  'říká se tomu',
  'zjednodušeně',
  'to jest',
  'neboli',
  'čili',
  'což je',
  'to je',
  'tedy',
  'tj.',
] as const;

interface CompiledTerm {
  entry: JargonEntry;
  forms: CompiledEntry[];
}

const COMPILED: readonly CompiledTerm[] = JARGON_TERMS.map((entry) => ({
  entry,
  forms: compileEntries(entry.forms),
}));

interface Occurrence {
  term: JargonEntry;
  block: BlockName;
  /** Offset into that block. */
  start: number;
  end: number;
  matchedText: string;
  /** Index of the block in output order, for "first occurrence per paper". */
  blockOrder: number;
}

export interface JargonBlock {
  name: BlockName;
  text: string;
}

/**
 * @param blocks the jargon-scoped blocks, **in §7 output order** — A.4.1's
 *        first-occurrence rule is defined over that order, so passing them
 *        shuffled would gloss-check the wrong occurrence.
 */
export function checkJargon(blocks: readonly JargonBlock[], config: StyleConfig): Finding[] {
  const occurrences = findOccurrences(blocks);

  // A.4.1: only the first occurrence per paper needs a gloss.
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const occ of occurrences) {
    if (seen.has(occ.term.id)) continue;
    seen.add(occ.term.id);

    const blockText = blocks[occ.blockOrder]?.text ?? '';
    const sentence = sentenceAround(blockText, occ.start);
    if (!sentence) continue;

    const relativeEnd = occ.end - sentence.start;

    if (!hasGloss(sentence.text, relativeEnd, config)) {
      findings.push({
        check: 'jargon',
        severity: occ.term.severity,
        block: occ.block,
        span: { start: occ.start, end: occ.end },
        matchedText: occ.matchedText,
        rule: `jargon:no_gloss:${occ.term.id}`,
        messageCs: noGlossMessageCs(occ.term.termCs),
      });
      continue;
    }

    // A.4.2: gloss present, English original missing → warn, not hard. Forcing
    // an English original for `medián` or `placebo` would clutter the text, so
    // only entries that carry one are checked, and the model is left judgement.
    const english = occ.term.englishOriginal;
    if (english !== undefined && !hasEnglishOriginal(blockText, occ.end, english, config)) {
      findings.push({
        check: 'jargon',
        severity: 'warn',
        block: occ.block,
        span: { start: occ.start, end: occ.end },
        matchedText: occ.matchedText,
        rule: `jargon:no_english_original:${occ.term.id}`,
        messageCs:
          `U termínu „${occ.term.termCs}“ chybí při prvním použití anglický originál v závorce ` +
          `(např. „${occ.term.termCs} (${english})“). Čtenář ten anglický výraz potká jinde (§2).`,
      });
    }
  }

  return findings;
}

function findOccurrences(blocks: readonly JargonBlock[]): Occurrence[] {
  const out: Occurrence[] = [];
  blocks.forEach((block, blockOrder) => {
    const lowered = lowerForMatching(block.text);
    for (const { entry, forms } of COMPILED) {
      for (const form of forms) {
        const subject = form.caseSensitive === true ? block.text : lowered;
        form.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = form.re.exec(subject)) !== null) {
          if (m[0].length === 0) {
            form.re.lastIndex += 1;
            continue;
          }
          out.push({
            term: entry,
            block: block.name,
            start: m.index,
            end: m.index + m[0].length,
            matchedText: block.text.slice(m.index, m.index + m[0].length),
            blockOrder,
          });
        }
      }
    }
  });

  // Order by position, then prefer the longest match at a position: `medián
  // příjmu` (warn) must win over `medián` (hard) when both start at the same
  // offset, otherwise the more specific entry never gets a chance to fire.
  out.sort((a, b) => a.blockOrder - b.blockOrder || a.start - b.start || b.end - a.end);

  const kept: Occurrence[] = [];
  for (const occ of out) {
    const overlapsLonger = kept.some(
      (k) => k.blockOrder === occ.blockOrder && occ.start < k.end && occ.end > k.start,
    );
    if (!overlapsLonger) kept.push(occ);
  }
  return kept;
}

function sentenceAround(text: string, offset: number): { text: string; start: number } | null {
  for (const s of splitSentences(text)) {
    if (offset >= s.start && offset < s.end) return { text: s.text, start: s.start };
  }
  return null;
}

/**
 * A.4.2's three ways a gloss can be present. All three require the gloss to sit
 * **after** the term and **in the same sentence** — RISK-VOICE-03 says a gloss
 * in the *next* sentence does not count, because a reader who stumbles on the
 * term has already stopped reading by then.
 */
export function hasGloss(sentence: string, termEnd: number, config: StyleConfig): boolean {
  const after = sentence.slice(termEnd);
  const loweredAfter = lowerForMatching(after);

  // 1. Explanatory connective + ≥ 4 words that contain no other jargon term.
  for (const connective of CONNECTIVES) {
    const at = loweredAfter.indexOf(connective);
    if (at === -1) continue;
    // The connective must stand as its own word, not inside one.
    const before = at > 0 ? loweredAfter[at - 1] : ' ';
    if (before !== undefined && /\p{L}/u.test(before)) continue;
    if (substanceFollows(after.slice(at + connective.length), config)) return true;
  }

  // 2. Dash or colon gloss: the term followed within `dashGlossMaxGapChars` by
  //    an em dash, en dash, spaced hyphen or colon, then ≥ 4 words.
  const dashWindow = after.slice(0, config.jargon.dashGlossMaxGapChars + 2);
  const dash = /^(?:\s{0,3}[—–:]|\s-\s)/u.exec(dashWindow);
  if (dash) {
    if (substanceFollows(after.slice(dash[0].length), config)) return true;
  }

  // 3. Parenthetical gloss beginning within 60 chars, holding ≥ 3 Czech words.
  //    THE CRITICAL LINE: "(neural network)" has zero Czech words and therefore
  //    is not a gloss — it is the §2 term marker, a separate obligation.
  const window = after.slice(0, config.jargon.parenGlossMaxDistanceChars);
  const parenRe = /\(([^()]{0,200})\)/gu;
  let p: RegExpExecArray | null;
  while ((p = parenRe.exec(window)) !== null) {
    const inner = p[1];
    if (inner !== undefined && countCzechWords(inner) >= config.jargon.parenGlossMinCzechWords) return true;
  }

  return false;
}

/** ≥ `glossMinWords` words that contain no other jargon term (A.4.2). */
function substanceFollows(text: string, config: StyleConfig): boolean {
  const stop = /[.!?…]/u.exec(text);
  const scope = stop ? text.slice(0, stop.index) : text;
  const words = tokenizeWords(scope);
  if (words.length < config.jargon.glossMinWords) return false;
  return !containsJargon(scope);
}

function containsJargon(text: string): boolean {
  const lowered = lowerForMatching(text);
  for (const { forms } of COMPILED) {
    for (const form of forms) {
      const subject = form.caseSensitive === true ? text : lowered;
      form.re.lastIndex = 0;
      if (form.re.test(subject)) return true;
    }
  }
  return false;
}

/**
 * A.4.2 condition 3's definition of a Czech word: a token of ≥ 3 letters that
 * either carries a diacritic or is in CS_FUNCTION (A.2.3).
 */
export function countCzechWords(text: string): number {
  let count = 0;
  for (const token of tokenizeWords(text)) {
    const lowered = lowerForMatching(token.text);
    if (lowered.length < 3) continue;
    if (hasCzechDiacritic(lowered) || CS_FUNCTION.has(lowered)) count++;
  }
  return count;
}

/** Is the English original present in parentheses near the first occurrence? */
function hasEnglishOriginal(blockText: string, termEnd: number, english: string, config: StyleConfig): boolean {
  const window = lowerForMatching(blockText.slice(termEnd, termEnd + config.jargon.parenGlossMaxDistanceChars));
  const target = lowerForMatching(english);
  const parenRe = /\(([^()]{0,200})\)/gu;
  let p: RegExpExecArray | null;
  while ((p = parenRe.exec(window)) !== null) {
    if ((p[1] ?? '').includes(target)) return true;
  }
  return false;
}

/** A.4.3's template, verbatim. */
export function noGlossMessageCs(term: string): string {
  return `Termín „${term}“ není v téže větě vysvětlen běžnými slovy. Doplňte vysvětlení (např. „…, tedy …“) nebo termín nepoužívejte.`;
}
