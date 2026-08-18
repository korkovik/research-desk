/**
 * A.2 — the untranslated-English-sentence detector. §2 requires Czech; §11
 * step 7's acceptance check is "no block contains an untranslated English
 * sentence".
 *
 * Three checks, in the order A.2.3 gives them:
 *   1. per-sentence English likelihood (hard),
 *   2. mixed-language sentence (warn),
 *   3. long unmasked English run, independent of sentence splitting (hard).
 *
 * The whole design rests on masking (A.2.1) running first. §2 *requires* the
 * English original in parentheses on first use, so a parenthesised span is
 * exempt by spec — without that exemption the correct output
 * `neuronová síť (neural network)` would be flagged, and the checker would be
 * punishing the model for obeying the spec.
 */
import type { StyleConfig } from '../config.js';
import {
  AMBIGUOUS_TOKENS,
  CS_FUNCTION,
  CZECH_SUFFIX_RE,
  EN_FUNCTION,
  ENGLISH_SUFFIX_RE,
} from './lexicons.cs.js';
import {
  hasCzechDiacritic,
  lowerForMatching,
  mask,
  MASK_CHAR,
  splitSentences,
  tokenizeWords,
  type MaskOptions,
} from './text.js';
import type { BlockName, Finding } from './types.js';

export interface EnglishScore {
  n: number;
  e: number;
  c: number;
  d: number;
  msuf: number;
  esuf: number;
  englishScore: number;
  czechScore: number;
}

/** A.2.3's counters and the two scores, for one already-masked sentence. */
export function scoreSentence(sentence: string): EnglishScore {
  const tokens = tokenizeWords(lowerForMatching(sentence)).map((t) => t.text);
  const n = tokens.length;
  let e = 0;
  let c = 0;
  let d = 0;
  let msuf = 0;
  let esuf = 0;
  for (const token of tokens) {
    const diacritic = hasCzechDiacritic(token);
    if (diacritic) d++;
    // A.2.3: ambiguous tokens are excluded from BOTH counts. `to`, `do`, `by`,
    // `my`, `on`, `a`, `i`, `s`, `v`, `z` are frequent in both languages and
    // would otherwise decide the verdict on their own.
    if (AMBIGUOUS_TOKENS.has(token)) continue;
    if (EN_FUNCTION.has(token)) e++;
    if (CS_FUNCTION.has(token)) c++;
    if (CZECH_SUFFIX_RE.test(token)) msuf++;
    if (!diacritic && ENGLISH_SUFFIX_RE.test(token)) esuf++;
  }
  const denom = Math.max(n, 1);
  return {
    n,
    e,
    c,
    d,
    msuf,
    esuf,
    englishScore: (e + 0.5 * esuf) / denom,
    czechScore: (c + d + 0.5 * msuf) / denom,
  };
}

export interface EnglishCheckOptions {
  /**
   * A.2.1 step 4 — the paper's own title. When supplied, a run of ≥ 8 characters
   * shared with it is masked and raises a warn `english_sentence:title_echo`:
   * the renderer stores the original title separately (§7.6), so a generated
   * block should never contain it.
   */
  sourceTitle?: string;
}

export function checkEnglish(
  block: BlockName,
  text: string,
  config: StyleConfig,
  options: EnglishCheckOptions = {},
): Finding[] {
  const maskOptions: MaskOptions = { urls: true, dois: true, parens: true, numbers: true };
  if (options.sourceTitle !== undefined) maskOptions.sourceTitle = options.sourceTitle;
  const masked = mask(text, maskOptions);

  const findings: Finding[] = [];

  for (const span of masked.spans) {
    if (span.kind !== 'title-echo') continue;
    findings.push({
      check: 'english_sentence',
      severity: 'warn',
      block,
      span: { start: span.start, end: span.end },
      matchedText: span.text,
      rule: 'english_sentence:title_echo',
      messageCs:
        `Text opisuje původní název článku („${span.text}“). Nadpis i vysvětlení mají být napsané vlastními, běžnými slovy.`,
    });
  }

  // Masking preserves length, so a sentence found in the masked copy has the
  // same offsets in the original.
  for (const sentence of splitSentences(masked.text)) {
    const score = scoreSentence(sentence.text);
    const original = text.slice(sentence.start, sentence.end);

    // A.2.3 — flag as untranslated English iff ALL five conditions hold.
    const isEnglish =
      score.n >= config.english.minTokens &&
      score.englishScore >= config.english.englishScoreHard &&
      score.czechScore <= config.english.czechScoreHard &&
      score.d === 0 &&
      score.c <= config.english.maxCzechFunctionWords;

    if (isEnglish) {
      findings.push({
        check: 'english_sentence',
        severity: 'hard',
        block,
        span: { start: sentence.start, end: sentence.end },
        matchedText: original,
        rule: 'english_sentence:untranslated',
        messageCs:
          `Tato věta zůstala v angličtině: „${original}“. Přeložte ji do češtiny. ` +
          `Anglický originál smí být jen v závorce za českým výrazem, a to jen při prvním použití (§2).`,
      });
      continue;
    }

    // A.2.3 secondary check — half-translated sentence. Warn, not hard,
    // because a Czech sentence listing several English terms can hit this
    // legitimately.
    if (score.n >= config.english.mixedMinTokens && score.englishScore >= config.english.mixedEnglishScoreWarn && score.d > 0) {
      findings.push({
        check: 'english_sentence',
        severity: 'warn',
        block,
        span: { start: sentence.start, end: sentence.end },
        matchedText: original,
        rule: 'english_sentence:mixed',
        messageCs:
          `Věta míchá češtinu a angličtinu: „${original}“. Přeložte anglické části, nebo je dejte do závorky za český výraz (§2).`,
      });
    }
  }

  findings.push(...checkLongEnglishRun(block, text, masked.text, config));
  return findings.sort((a, b) => a.span.start - b.span.start);
}

/**
 * A.2.3's third check: any run of ≥ 6 consecutive tokens that are all
 * ASCII-only and contain ≥ 2 EN_FUNCTION words, outside masked spans. This
 * catches English the sentence splitter failed to separate out — an English
 * clause glued onto a Czech one with a comma, which A.2.3's per-sentence score
 * would dilute below threshold.
 *
 * Ambiguous tokens (A.2.3) do not count toward the EN_FUNCTION requirement.
 * Without that, an ASCII-only stretch of Czech containing `to` and `do` would
 * satisfy the check on function words that are not evidence of anything.
 */
function checkLongEnglishRun(block: BlockName, original: string, maskedText: string, config: StyleConfig): Finding[] {
  const lowered = lowerForMatching(maskedText);
  const tokens = tokenizeWords(lowered);
  const findings: Finding[] = [];

  let runStart = 0;
  let run: Array<{ text: string; start: number; end: number }> = [];

  const flush = (): void => {
    if (run.length >= config.english.runMinTokens) {
      const enCount = run.filter((t) => !AMBIGUOUS_TOKENS.has(t.text) && EN_FUNCTION.has(t.text)).length;
      if (enCount >= config.english.runMinEnglishFunctionWords) {
        const first = run[0];
        const last = run[run.length - 1];
        if (first && last) {
          const matched = original.slice(first.start, last.end);
          findings.push({
            check: 'english_sentence',
            severity: 'hard',
            block,
            span: { start: first.start, end: last.end },
            matchedText: matched,
            rule: 'english_sentence:run',
            messageCs:
              `Tento úsek je anglicky: „${matched}“. Napište ho česky. ` +
              `Anglický výraz patří nejvýš do závorky za český překlad (§2).`,
          });
        }
      }
    }
    run = [];
  };

  for (const token of tokens) {
    const gap = lowered.slice(runStart, token.start);
    // A masked span (URL, DOI, parenthesis, number) breaks the run: A.2.3 says
    // "outside masked spans", and a legitimate parenthetical English term must
    // not chain two Czech fragments into one "English run".
    const brokenByMask = gap.includes(MASK_CHAR);
    const asciiOnly = /^[\x20-\x7E]+$/u.test(token.text);
    if (brokenByMask || !asciiOnly) flush();
    if (asciiOnly) run.push(token);
    runStart = token.end;
  }
  flush();

  return findings;
}
