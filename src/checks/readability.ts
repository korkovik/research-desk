/**
 * A.3 — the Czech readability heuristic. §2: "aim for what a 15-year-old reads
 * comfortably. Short sentences. Active voice."
 *
 * A.3.2 computes R1–R9 over blocks `oCoJde`, `podrobne`, `priklad`, `proc`
 * **concatenated**, because the per-block sample is too small to be stable —
 * one 30-word sentence in a two-sentence block would put the mean anywhere.
 * That is why aggregate findings carry `block: 'all'`: they genuinely belong to
 * no single block. Findings that *can* be localised (R2's longest sentence)
 * carry the block that owns the sentence and offsets into that block.
 */
import type { StyleConfig } from '../config.js';
import {
  countableWords,
  countSyllables,
  splitSentences,
  type Sentence,
} from './text.js';
import type { BlockName, Finding } from './types.js';

/**
 * A.3.3's periphrastic-passive pattern.
 *
 * The load-bearing constraint is `PART_END`: only **short** participle endings.
 * `byl známý` and `je důležitý` are adjectival predicates, not passives, and
 * they end in `-ý/-á/-é`. Excluding those endings is what makes this usable at
 * all — without it the detector fires on half of all Czech copular sentences.
 */
const AUX = '(?:je|jsou|byl|byla|bylo|byli|byly|bude|budou|bývá|bývají)';
const GAP = '(?:\\p{L}+\\s+){0,2}';
const PART_END =
  '(?:án|ána|áno|áni|ány|en|ena|eno|eni|eny|ěn|ěna|ěno|ěni|ěny|nut|nuta|nuto|nuti|nuty|t|ta|to|ti|ty)';
const PASSIVE_RE = new RegExp(`(?<!\\p{L})${AUX}(?!\\p{L})\\s+${GAP}(\\p{L}*${PART_END})(?!\\p{L})`, 'gu');

/**
 * A.3.3's stop list of short adjectives and pronouns that end in the same
 * letters as a short participle. In practice the ≥ 5-character floor does most
 * of the work; the list is kept because A.3.3 names it and because a future
 * loosening of the floor would need it.
 */
const PARTICIPLE_STOPLIST = new Set([
  'to', 'ta', 'ty', 'ti', 'tu', 'sto', 'sta', 'kdy', 'nikdy', 'jen', 'ven', 'den', 'plen',
  'len', 'sen', 'sten', 'ten', 'teď',
]);
const PARTICIPLE_MIN_CHARS = 5;

/**
 * A.3.4's reflexive-passive pattern. **Expected precision ~0.5** — Czech
 * reflexive passive is formally identical to true reflexives (`dítě se učí`),
 * reciprocals (`potkali se`) and lexical reflexives (`smát se`), and the clitic
 * `se` sits in second position, often several words from its verb. Telling them
 * apart needs a dependency parse and animacy information, neither of which this
 * checker has. So it is reported, never hard-failed, and it is deliberately NOT
 * added to R7.
 */
const REFLEXIVE_RE =
  /(?<!\p{L})se(?!\p{L})\s+(\p{L}+?)(uje|ují|á|ají|í|aly|ala|alo|ily|ila|ilo)(?!\p{L})/gu;

export interface ReadabilityMetrics {
  sentenceCount: number;
  wordCount: number;
  /** R1 */
  meanSentenceWords: number;
  /** R2 */
  longestSentenceWords: number;
  /** R3 */
  longSentenceCount: number;
  /** R4 */
  meanSyllablesPerWord: number;
  /** R5 */
  share4Syllables: number;
  /** R6 */
  share5Syllables: number;
  /** R7 */
  passiveShare: number;
  /** R8 */
  reflexivePassiveShare: number;
  /** R9 */
  compositeIndex: number;
}

/** One segment of the concatenated document, so a finding can name its block. */
export interface ConcatSegment {
  block: BlockName;
  text: string;
}

interface Located {
  block: BlockName;
  start: number;
  end: number;
}

/**
 * Concatenate the readability blocks with a paragraph break between them. The
 * break matters: without it the last sentence of one block and the first of the
 * next would merge whenever a block does not end in a full stop.
 */
export function concatenate(segments: readonly ConcatSegment[]): { text: string; locate: (offset: number) => Located } {
  const JOIN = '\n\n';
  const bounds: Array<{ block: BlockName; start: number; end: number }> = [];
  let text = '';
  for (const segment of segments) {
    if (text.length > 0) text += JOIN;
    const start = text.length;
    text += segment.text;
    bounds.push({ block: segment.block, start, end: text.length });
  }
  const locate = (offset: number): Located => {
    for (const b of bounds) {
      if (offset >= b.start && offset <= b.end) {
        return { block: b.block, start: offset - b.start, end: offset - b.start };
      }
    }
    return { block: 'all', start: offset, end: offset };
  };
  return { text, locate };
}

/** True when this sentence contains an A.3.3 periphrastic passive. */
export function hasPeriphrasticPassive(sentence: string): boolean {
  return findPeriphrasticPassive(sentence) !== null;
}

/** The matched span, or null. Exported so a test can assert what matched. */
export function findPeriphrasticPassive(sentence: string): { text: string; participle: string } | null {
  PASSIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PASSIVE_RE.exec(sentence)) !== null) {
    const participle = m[1];
    if (participle === undefined) continue;
    // A.3.3: "practically, require the participle candidate to be ≥ 5 characters".
    if (participle.length < PARTICIPLE_MIN_CHARS) continue;
    if (PARTICIPLE_STOPLIST.has(participle.toLowerCase())) continue;
    return { text: m[0], participle };
  }
  return null;
}

export function hasReflexivePassive(sentence: string): boolean {
  REFLEXIVE_RE.lastIndex = 0;
  return REFLEXIVE_RE.test(sentence);
}

export interface MetricsResult {
  metrics: ReadabilityMetrics;
  sentences: Sentence[];
  /** Word count per sentence, index-aligned with `sentences`. */
  perSentenceWords: number[];
}

/**
 * @param longSentenceWords what R3 calls "a long sentence". A.3.2 fixes it at 25.
 */
export function computeMetrics(text: string, longSentenceWords: number): MetricsResult {
  const sentences = splitSentences(text);
  const perSentenceWords = sentences.map((s) => countableWords(s.text).length);
  const wordCount = perSentenceWords.reduce((a, b) => a + b, 0);

  // Syllables are counted over letter-bearing words only. A bare numeral has no
  // vowel, so A.3.1's floor would score it as one syllable and drag the mean
  // down for a text that is *harder*, not easier, to read.
  const syllableCounts = countableWords(text)
    .filter((t) => /\p{L}/u.test(t.text))
    .map((t) => countSyllables(t.text));
  const syllableWordCount = syllableCounts.length;
  const totalSyllables = syllableCounts.reduce((a, b) => a + b, 0);

  const meanSentenceWords = sentences.length > 0 ? wordCount / sentences.length : 0;
  const meanSyllablesPerWord = syllableWordCount > 0 ? totalSyllables / syllableWordCount : 0;

  const passiveSentences = sentences.filter((s) => hasPeriphrasticPassive(s.text)).length;
  const reflexiveSentences = sentences.filter((s) => hasReflexivePassive(s.text)).length;

  const metrics: ReadabilityMetrics = {
    sentenceCount: sentences.length,
    wordCount,
    meanSentenceWords,
    longestSentenceWords: perSentenceWords.reduce((a, b) => Math.max(a, b), 0),
    longSentenceCount: perSentenceWords.filter((w) => w > longSentenceWords).length,
    meanSyllablesPerWord,
    share4Syllables: syllableWordCount > 0 ? syllableCounts.filter((c) => c >= 4).length / syllableWordCount : 0,
    share5Syllables: syllableWordCount > 0 ? syllableCounts.filter((c) => c >= 5).length / syllableWordCount : 0,
    passiveShare: sentences.length > 0 ? passiveSentences / sentences.length : 0,
    reflexivePassiveShare: sentences.length > 0 ? reflexiveSentences / sentences.length : 0,
    // A.3.5. Our own index, not a published Czech formula — do not cite it as
    // one. It exists so the run log has a single trackable number.
    compositeIndex: 100 - (2.0 * meanSentenceWords + 25 * (meanSyllablesPerWord - 2.0)),
  };
  return { metrics, sentences, perSentenceWords };
}

export interface ReadabilityResult {
  metrics: ReadabilityMetrics;
  findings: Finding[];
}

export function checkReadability(segments: readonly ConcatSegment[], config: StyleConfig): ReadabilityResult {
  const r = config.readability;
  const { text, locate } = concatenate(segments);
  const { metrics, sentences, perSentenceWords } = computeMetrics(text, r.longSentenceWords);

  const findings: Finding[] = [];
  if (metrics.sentenceCount === 0) return { metrics, findings };

  const aggregate = (
    id: string,
    value: number,
    threshold: { warn: number; hard: number },
    messageCs: (v: number) => string,
    detail: string,
  ): void => {
    const severity = value > threshold.hard ? 'hard' : value > threshold.warn ? 'warn' : null;
    if (severity === null) return;
    findings.push({
      check: 'readability',
      severity,
      block: 'all',
      span: { start: 0, end: 0 },
      matchedText: detail,
      rule: `readability:${id}`,
      messageCs: messageCs(value),
    });
  };

  // R1 — Czech popular-science prose sits at 13–16 words/sentence; above 20 the
  // sentence carries more than one idea and a 15-year-old loses the thread.
  aggregate(
    'R1',
    metrics.meanSentenceWords,
    r.meanSentenceWords,
    (v) => `Věty jsou v průměru moc dlouhé (${v.toFixed(1)} slova). Rozdělte je: jedna věta, jedna myšlenka.`,
    `meanSentenceWords=${metrics.meanSentenceWords.toFixed(2)}`,
  );

  // R2 — a 34-word Czech sentence almost always contains three subordinate
  // clauses; that is a paper sentence, not a family-reading sentence. This one
  // can be localised, so it points at the offending sentence.
  {
    const worst = longestSentence(sentences, perSentenceWords);
    const severity =
      metrics.longestSentenceWords > r.longestSentenceWords.hard
        ? 'hard'
        : metrics.longestSentenceWords > r.longestSentenceWords.warn
          ? 'warn'
          : null;
    if (severity !== null && worst) {
      const from = locate(worst.start);
      findings.push({
        check: 'readability',
        severity,
        block: from.block,
        span: { start: from.start, end: from.start + worst.text.length },
        matchedText: worst.text,
        rule: 'readability:R2',
        messageCs:
          `Tato věta má ${metrics.longestSentenceWords} slov a je moc dlouhá: „${truncate(worst.text)}“. ` +
          `Rozdělte ji na dvě až tři kratší věty.`,
      });
    }
  }

  // R3 — one long sentence per paper is survivable; four means the model
  // reverted to academic register.
  aggregate(
    'R3',
    metrics.longSentenceCount,
    r.longSentenceCount,
    (v) => `Text má ${v} vět delších než ${r.longSentenceWords} slov. Zkraťte je.`,
    `longSentenceCount=${metrics.longSentenceCount}`,
  );

  // R4 — Czech neutral prose averages ~2.3–2.5 syllables/word, academic Czech
  // ~2.8+. 2.60 is where text starts reading as institutional.
  aggregate(
    'R4',
    metrics.meanSyllablesPerWord,
    r.meanSyllablesPerWord,
    (v) => `Slova jsou v průměru moc dlouhá (${v.toFixed(2)} slabiky). Použijte kratší, běžnější výrazy.`,
    `meanSyllablesPerWord=${metrics.meanSyllablesPerWord.toFixed(3)}`,
  );

  // R5 — CALIBRATION WARNING (A.3.2, Open Question OQ-2): Czech derivation makes
  // 4-syllable words ordinary (`porovnali`, `sledovali`, `elektřiny`), so the
  // intuitive 10 % threshold is unmeetable. 0.25/0.35 are provisional.
  aggregate(
    'R5',
    metrics.share4Syllables,
    r.share4Syllables,
    (v) => `Příliš mnoho dlouhých slov (${Math.round(v * 100)} % slov má čtyři a více slabik). Zkuste běžnější výrazy.`,
    `share4Syllables=${metrics.share4Syllables.toFixed(3)}`,
  );

  // R6 — the better discriminator: 5+ syllables in Czech means an abstract noun
  // (`pravděpodobnost`, `srozumitelnost`), and those are what actually block
  // comprehension.
  aggregate(
    'R6',
    metrics.share5Syllables,
    r.share5Syllables,
    (v) =>
      `Příliš mnoho abstraktních dlouhých slov (${Math.round(v * 100)} % slov má pět a více slabik). ` +
      `Nahraďte je konkrétními, kratšími slovy.`,
    `share5Syllables=${metrics.share5Syllables.toFixed(3)}`,
  );

  // R7 — §2 requires active voice. 20 % allows the occasional unavoidable
  // "byl testován"; 35 % means the model wrote the abstract back at us.
  aggregate(
    'R7',
    metrics.passiveShare,
    r.passiveShare,
    (v) => `${Math.round(v * 100)} % vět je v trpném rodě. Pište činným rodem: „vědci změřili…“, ne „bylo změřeno…“.`,
    `passiveShare=${metrics.passiveShare.toFixed(3)}`,
  );

  // R8 — reflexive passive. Never hard: the detector is ~0.5 precise (A.3.4).
  if (metrics.reflexivePassiveShare > r.reflexivePassiveShareWarn) {
    findings.push({
      check: 'readability',
      severity: 'warn',
      block: 'all',
      span: { start: 0, end: 0 },
      matchedText: `reflexivePassiveShare=${metrics.reflexivePassiveShare.toFixed(3)}`,
      rule: 'readability:reflexive_passive',
      messageCs:
        `Hodně vět používá zvratnou vazbu („vzorky se analyzovaly“). Zkuste říct, kdo to udělal: „vědci vzorky analyzovali“.`,
    });
  }

  // R9 — the composite index runs the other way: warn below 50, hard below 40.
  {
    const severity =
      metrics.compositeIndex < r.compositeIndexFloor.hard
        ? 'hard'
        : metrics.compositeIndex < r.compositeIndexFloor.warn
          ? 'warn'
          : null;
    if (severity !== null) {
      findings.push({
        check: 'readability',
        severity,
        block: 'all',
        span: { start: 0, end: 0 },
        matchedText: `compositeIndex=${metrics.compositeIndex.toFixed(1)}`,
        rule: 'readability:R9',
        messageCs:
          `Text se celkově čte těžko (index ${metrics.compositeIndex.toFixed(0)} ze 100). ` +
          `Zkraťte věty a nahraďte odborná slova běžnými.`,
      });
    }
  }

  return { metrics, findings };
}

/**
 * A.3.2's rule outside the table: §7.1 says the plain-language title is "one
 * line". 14 words and 100 characters is what fits on two lines at 390 px — the
 * phone width §11 step 9 names.
 */
export function checkNadpis(text: string, config: StyleConfig): Finding[] {
  const r = config.readability;
  const findings: Finding[] = [];
  const words = countableWords(text).length;
  const trimmed = text.trim();

  if (words > r.nadpisMaxWords) {
    findings.push({
      check: 'readability',
      severity: 'hard',
      block: 'nadpis',
      span: { start: 0, end: text.length },
      matchedText: trimmed,
      rule: 'readability:nadpis_words',
      messageCs: `Nadpis má ${words} slov, povoleno je nejvýš ${r.nadpisMaxWords}. Zkraťte ho na jednu krátkou větu.`,
    });
  }
  if (trimmed.length > r.nadpisMaxChars) {
    findings.push({
      check: 'readability',
      severity: 'hard',
      block: 'nadpis',
      span: { start: 0, end: text.length },
      matchedText: trimmed,
      rule: 'readability:nadpis_chars',
      messageCs:
        `Nadpis má ${trimmed.length} znaků, povoleno je nejvýš ${r.nadpisMaxChars}, aby se vešel na displej telefonu. Zkraťte ho.`,
    });
  }
  if (splitSentences(trimmed).length > 1) {
    findings.push({
      check: 'readability',
      severity: 'hard',
      block: 'nadpis',
      span: { start: 0, end: text.length },
      matchedText: trimmed,
      rule: 'readability:nadpis_sentences',
      messageCs: 'Nadpis musí být jedna věta na jeden řádek (§7.1). Nechte jen tu podstatnou.',
    });
  }
  return findings;
}

function longestSentence(sentences: readonly Sentence[], words: readonly number[]): Sentence | null {
  let best: Sentence | null = null;
  let bestWords = -1;
  for (let i = 0; i < sentences.length; i++) {
    const count = words[i] ?? 0;
    const sentence = sentences[i];
    if (sentence && count > bestWords) {
      best = sentence;
      bestWords = count;
    }
  }
  return best;
}

function truncate(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
