/**
 * A.0 / A.6 — the §2 style checker's entry point.
 *
 * A **deterministic, pure function** run after summarisation (§11 step 7) and
 * before verification (§11 step 8). No model call, no I/O, no clock. §2's rules
 * are the requirement; A11 in `docs/ASSUMPTIONS.md` records that Tom wanted
 * them enforced by a check, not only by a sentence in a prompt — a prompt
 * instruction that the model ignores leaves no trace, and a checker that cannot
 * fail is the same thing with more code.
 *
 * What this file owns:
 *   - the A.0 block-scope table (which check sees which block),
 *   - A.1.4 severity resolution across checks,
 *   - A.6's warn budget and the `pass` / `warn` / `fail` status,
 *   - flattening `Finding` into the pipeline's `LanguageViolation`.
 *
 * **A.6 is explicit and this file enforces it: style failure never drops a
 * paper.** `ok: false` means "regenerate"; only failed example verification
 * (Section C) removes a paper from the day. A clumsy sentence is a blemish, a
 * fabricated example is a lie.
 */
import type { StyleConfig } from '../config.js';
import type { LanguageCheckResult, LanguageViolation, PaperSummary } from '../types.js';
import { checkEnglish } from './english.js';
import { checkHype } from './hype.js';
import { checkJargon, type JargonBlock } from './jargon.js';
import { checkNumberAnchors } from './numbers.js';
import { checkReadability, type ConcatSegment, type ReadabilityMetrics } from './readability.js';
import { countableWords, toNfc } from './text.js';
import type { BlockName, Finding } from './types.js';

export interface StyleContext {
  /**
   * The paper's own title, for A.2.1 step 4's title-echo detection. Absent in
   * unit tests and whenever the caller has no source title to compare against.
   */
  sourceTitle?: string;
}

export interface StyleReport {
  status: 'pass' | 'warn' | 'fail';
  findings: Finding[];
  metrics: ReadabilityMetrics;
  /** Words in blocks 2–5, the denominator of A.6's warn density. */
  wordCount: number;
}

/**
 * The A.0 block-scope table, as data.
 *
 * | Check            | nadpis | O co jde | Podrobné | Příklad | Proč | Chci vědět víc |
 * | hype             | yes    | yes      | yes      | yes     | yes  | limitation note only |
 * | english_sentence | yes    | yes      | yes      | yes     | yes  | limitation note only |
 * | readability      | no*    | yes      | yes      | yes     | yes  | no |
 * | jargon           | yes    | yes      | yes      | yes     | yes  | no |
 * | number_anchor    | no     | ban only | yes      | yes     | yes  | no |
 *
 * (*) the nadpis has its own rule instead — one sentence, ≤ 14 words, ≤ 100
 * characters (A.3.2, §7.1).
 *
 * The structured fields of block 6 — authors, journal name, DOI, OpenAlex ID,
 * PDF URL, dates — are **never** checked. They are legitimately English and
 * legitimately full of numerals, and this function never sees them: it takes a
 * `PaperSummary`, whose only block-6 member is the free-text limitation note.
 */
export const BLOCK_SCOPE = {
  hype: ['souhrn', 'podrobneVysvetleni', 'procJeToDulezite', 'poznamkaKOmezenim'],
  english: ['souhrn', 'podrobneVysvetleni', 'procJeToDulezite', 'poznamkaKOmezenim'],
  readability: ['souhrn', 'podrobneVysvetleni', 'procJeToDulezite'],
  jargon: ['souhrn', 'podrobneVysvetleni', 'procJeToDulezite'],
  // §7.3's rule is about the block where numbers live. The summary paragraph
  // carries a few results now, so it is in scope too.
  numberAnchor: ['souhrn', 'podrobneVysvetleni', 'procJeToDulezite'],
} as const satisfies Record<string, readonly (keyof PaperSummary)[]>;

type TextBlock = keyof PaperSummary;

/** NFC once (A.0.1); every offset in every finding is into these strings. */
function normalisedBlocks(summary: PaperSummary): Record<TextBlock, string> {
  return {
    souhrn: toNfc(summary.souhrn),
    podrobneVysvetleni: toNfc(summary.podrobneVysvetleni),
    procJeToDulezite: toNfc(summary.procJeToDulezite),
    poznamkaKOmezenim: toNfc(summary.poznamkaKOmezenim),
  };
}

/** The full A-section report. `checkStyle` is the thin adapter over this. */
export function analyseStyle(summary: PaperSummary, config: StyleConfig, context: StyleContext = {}): StyleReport {
  const text = normalisedBlocks(summary);
  const findings: Finding[] = [];

  for (const block of BLOCK_SCOPE.hype) {
    findings.push(...checkHype(block, text[block], config));
  }

  for (const block of BLOCK_SCOPE.english) {
    const options = context.sourceTitle === undefined ? {} : { sourceTitle: context.sourceTitle };
    findings.push(...checkEnglish(block, text[block], config, options));
  }

  // A.4.1: occurrence order is computed over blocks in output order, so the
  // "first occurrence per paper" rule needs this exact sequence.
  const jargonBlocks: JargonBlock[] = BLOCK_SCOPE.jargon.map((name) => ({ name, text: text[name] }));
  findings.push(...checkJargon(jargonBlocks, config));

  const segments: ConcatSegment[] = BLOCK_SCOPE.readability.map((name) => ({ block: name, text: text[name] }));
  const readability = checkReadability(segments, config);
  findings.push(...readability.findings);

  for (const block of BLOCK_SCOPE.numberAnchor) {
    findings.push(...checkNumberAnchors(block, text[block], config));
  }
  // A.5.4's "no numbers in block 2" is gone with block 2: the summary paragraph
  // is explicitly asked to carry a few results, so numbers belong in it — and
  // they are anchored there like everywhere else.

  const wordCount = BLOCK_SCOPE.readability.reduce((sum, name) => sum + countableWords(text[name]).length, 0);

  return {
    status: resolveStatus(findings, wordCount, config),
    findings: sortFindings(findings),
    metrics: readability.metrics,
    wordCount,
  };
}

/**
 * A.0 / A.6. `fail` if any finding is hard. `warn` if only warn-level findings
 * exist **and** the warn budget is exceeded. Otherwise `pass` — a paper is
 * allowed a couple of soft blemishes without anyone being told about it, which
 * is the point of having a budget rather than a zero-tolerance rule.
 */
export function resolveStatus(
  findings: readonly Finding[],
  wordCount: number,
  config: StyleConfig,
): 'pass' | 'warn' | 'fail' {
  if (findings.some((f) => f.severity === 'hard')) return 'fail';
  return warnBudgetExceeded(findings.filter((f) => f.severity === 'warn').length, wordCount, config) ? 'warn' : 'pass';
}

/**
 * A.6's warn budget: at most 1 warn per 100 words of blocks 2–5, **and** at most
 * 4 warns per paper in absolute terms. Exceeding either is enough.
 *
 * The density half exists so a 900-word day is not held to the same absolute
 * count as a 400-word one; the absolute half exists so a long paper cannot
 * accumulate warns indefinitely.
 */
export function warnBudgetExceeded(warnCount: number, wordCount: number, config: StyleConfig): boolean {
  const byDensity = (wordCount / 100) * config.warnBudget.perHundredWords;
  return warnCount > config.warnBudget.maxPerPaper || warnCount > byDensity;
}

/**
 * The §2 checker as the pipeline calls it. Pure: same summary and config in,
 * same result out, no I/O anywhere beneath it.
 */
export function checkStyle(
  summary: PaperSummary,
  config: StyleConfig,
  context: StyleContext = {},
): LanguageCheckResult {
  const report = analyseStyle(summary, config, context);
  return {
    ok: report.status !== 'fail',
    status: report.status,
    hard: report.findings.filter((f) => f.severity === 'hard').map(toViolation),
    soft: report.findings.filter((f) => f.severity === 'warn').map(toViolation),
  };
}

/** Maps a check's rule id onto the `LanguageViolation.rule` union of `types.ts`. */
function ruleOf(finding: Finding): LanguageViolation['rule'] {
  switch (finding.check) {
    case 'hype':
      return 'hype';
    case 'english_sentence':
      return 'untranslated-english';
    case 'jargon':
      return 'unexplained-jargon';
    case 'number_anchor':
      return 'unanchored-number';
    case 'readability':
      if (finding.rule.startsWith('readability:nadpis')) return 'block-length';
      if (finding.rule === 'readability:R7' || finding.rule === 'readability:reflexive_passive') return 'passive-voice';
      if (finding.rule === 'readability:R4' || finding.rule === 'readability:R5' || finding.rule === 'readability:R6') {
        return 'long-words';
      }
      return 'sentence-length';
  }
}

function toViolation(finding: Finding): LanguageViolation {
  return {
    block: finding.block,
    rule: ruleOf(finding),
    ruleId: finding.rule,
    span: finding.span,
    matchedText: finding.matchedText,
    messageCs: finding.messageCs,
    detail: `${finding.rule} @ ${finding.block}[${finding.span.start},${finding.span.end}]: ${finding.matchedText}`,
  };
}

const BLOCK_ORDER: readonly BlockName[] = [
  'souhrn',
  'podrobneVysvetleni',
  'procJeToDulezite',
  'poznamkaKOmezenim',
  'all',
];

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      BLOCK_ORDER.indexOf(a.block) - BLOCK_ORDER.indexOf(b.block) ||
      a.span.start - b.span.start ||
      a.rule.localeCompare(b.rule),
  );
}

/**
 * A.6 step 1's regeneration section, built from the hard findings. Fed to the
 * summariser verbatim under a `## Co je potřeba opravit` heading, which is why
 * `messageCs` is Czech and imperative rather than a log line.
 */
export function regenerationInstructions(result: LanguageCheckResult): string {
  return result.hard.map((v) => `- [${v.block}] ${v.messageCs} — konkrétně: „${v.matchedText}“`).join('\n');
}

export type { Finding, BlockName } from './types.js';
