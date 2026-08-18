/**
 * The corpora of the §2 style checker: the hype lexicon (DESIGN-NOTES A.1) and
 * the jargon term list (A.4.1), transcribed literally and completely.
 *
 * These live in code, not in `config.json`, on purpose: config carries knobs
 * (thresholds, budgets, window sizes), not corpora. A word list this long in
 * JSON is unreviewable and unannotatable, and every entry here needs its
 * false-positive guard and its justification sitting next to it.
 *
 * Every pattern is built through `compileStem` / `compilePattern` from
 * `text.ts`, so the A.0.1 Unicode boundaries are written down exactly once.
 */
import { compilePattern, compileStem } from './text.js';

export type Severity = 'hard' | 'warn';

/**
 * A guard turns a blanket match into a conditional one. Both A.1.1 entry 36 and
 * A.1.2 entry 37 need one, in opposite directions: `zlomov` is hype *only* when
 * followed by `okamžik|bod|moment|objev`, `průlom` is hype *unless* followed by
 * `bolest|infekc|krvácen|dávk`.
 */
export interface LexGuard {
  /** Regex source, matched against the text following the hit. */
  pattern: string;
  /** How many characters after the hit the guard looks. A.1 says 20. */
  withinChars: number;
  /** `require`: hit counts only if the guard matches. `reject`: only if it does not. */
  mode: 'require' | 'reject';
}

export interface LexEntry {
  /** Stable id, used as the `rule` of a finding: `hype:revoluč`. */
  id: string;
  /**
   * The DESIGN-NOTES row this entry transcribes, e.g. `A.1.1#22`. Several
   * entries may share a row: A.1.1 #22 lists three phrases on one line, and one
   * regex per phrase is clearer than one regex with three alternations. Tests
   * count distinct rows, which is what A.1's "35 hard, 18 warn" totals mean.
   */
  row?: string;
  /** Literal stem/phrase (`kind: 'stem'`) or a hand-written body (`kind: 'pattern'`). */
  source: string;
  kind: 'stem' | 'pattern';
  severity: Severity;
  /**
   * Acronyms only. A.0.1 lower-cases everything before matching, which is right
   * for words but turns `COP` into the ordinary Czech noun *cop* (a braid) and
   * `OR` into the conjunction. Matching those case-sensitively against the
   * original text is a deliberate deviation; see the report.
   */
  caseSensitive?: boolean;
  guard?: LexGuard;
  /** Why this entry is warn and not hard, or why the guard exists. */
  note?: string;
}

/** Compiled once at module load; regex objects are stateful, so callers clone lastIndex. */
export interface CompiledEntry extends LexEntry {
  re: RegExp;
}

export function compileEntries(entries: readonly LexEntry[]): CompiledEntry[] {
  return entries.map((e) => ({
    ...e,
    re: e.kind === 'stem' ? compileStem(e.source) : compilePattern(e.source),
  }));
}

// ===========================================================================
// A.1.1 — Czech hype, hard reject (regeneration required). 35 shipped entries.
// A.1.1's own table numbers 1..36 but flags #19 as a duplicate of #3 ("ship 35
// hard entries"), so #19 is not transcribed. The `id` of each entry keeps the
// design note's numbering so a finding can be traced back to the table row.
// ===========================================================================
export const HYPE_CS_HARD: readonly LexEntry[] = [
  { id: 'revoluč', row: 'A.1.1#1', source: 'revoluč', kind: 'stem', severity: 'hard' },
  { id: 'převratn', row: 'A.1.1#2', source: 'převratn', kind: 'stem', severity: 'hard' },
  { id: 'senzačn', row: 'A.1.1#3', source: 'senzačn', kind: 'stem', severity: 'hard' },
  { id: 'senzace', row: 'A.1.1#4', source: 'senzace', kind: 'stem', severity: 'hard' },
  { id: 'zázračn', row: 'A.1.1#5', source: 'zázračn', kind: 'stem', severity: 'hard' },
  { id: 'zázrak', row: 'A.1.1#6', source: 'zázrak', kind: 'stem', severity: 'hard' },
  { id: 'šokující', row: 'A.1.1#7', source: 'šokující', kind: 'stem', severity: 'hard' },
  { id: 'šokuj', row: 'A.1.1#8', source: 'šokuj', kind: 'stem', severity: 'hard' },
  { id: 'ohromující', row: 'A.1.1#9', source: 'ohromující', kind: 'stem', severity: 'hard' },
  { id: 'nebýval', row: 'A.1.1#10', source: 'nebýval', kind: 'stem', severity: 'hard' },
  { id: 'bezprecedentn', row: 'A.1.1#11', source: 'bezprecedentn', kind: 'stem', severity: 'hard' },
  { id: 'dechberoucí', row: 'A.1.1#12', source: 'dechberoucí', kind: 'stem', severity: 'hard' },
  { id: 'neuvěřiteln', row: 'A.1.1#13', source: 'neuvěřiteln', kind: 'stem', severity: 'hard' },
  { id: 'úžasn', row: 'A.1.1#14', source: 'úžasn', kind: 'stem', severity: 'hard' },
  { id: 'neskutečn', row: 'A.1.1#15', source: 'neskutečn', kind: 'stem', severity: 'hard' },
  { id: 'epocháln', row: 'A.1.1#16', source: 'epocháln', kind: 'stem', severity: 'hard' },
  { id: 'šílen', row: 'A.1.1#17', source: 'šílen', kind: 'stem', severity: 'hard' },
  { id: 'zaručen', row: 'A.1.1#18', source: 'zaručen', kind: 'stem', severity: 'hard' },
  // 19 — duplicate of `senzačn`; A.1.1 says drop it. Not transcribed.
  { id: 'mění-pravidla-hry', row: 'A.1.1#20', source: 'mění pravidla hry', kind: 'stem', severity: 'hard' },
  { id: 'změnil-pravidla-hry', row: 'A.1.1#20', source: 'změnil pravidla hry', kind: 'stem', severity: 'hard' },
  { id: 'změní-pravidla-hry', row: 'A.1.1#20', source: 'změní pravidla hry', kind: 'stem', severity: 'hard' },
  { id: 'zásadní-zlom', row: 'A.1.1#21', source: 'zásadní zlom', kind: 'stem', severity: 'hard' },
  { id: 'zlomový-okamžik', row: 'A.1.1#22', source: 'zlomový okamžik', kind: 'stem', severity: 'hard' },
  { id: 'zlomový-bod', row: 'A.1.1#22', source: 'zlomový bod', kind: 'stem', severity: 'hard' },
  { id: 'zlomový-moment', row: 'A.1.1#22', source: 'zlomový moment', kind: 'stem', severity: 'hard' },
  { id: 'změna-paradigmatu', row: 'A.1.1#23', source: 'změna paradigmatu', kind: 'stem', severity: 'hard' },
  { id: 'paradigmatický-posun', row: 'A.1.1#23', source: 'paradigmatický posun', kind: 'stem', severity: 'hard' },
  {
    id: 'svatý-grál',
    row: 'A.1.1#24',
    source: '(?<!\\p{L})svat\\p{L}+\\s+grál\\p{L}*(?!\\p{L})',
    kind: 'pattern',
    severity: 'hard',
    note: 'A.1.1 #24 writes this as `svat\\p{L}+ grál` so it catches svatý/svatého/svatém grál.',
  },
  { id: 'poprvé-v-historii', row: 'A.1.1#25', source: 'poprvé v historii', kind: 'stem', severity: 'hard' },
  { id: 'mění-svět', row: 'A.1.1#26', source: 'mění svět', kind: 'stem', severity: 'hard' },
  { id: 'změní-svět', row: 'A.1.1#26', source: 'změní svět', kind: 'stem', severity: 'hard' },
  { id: 'navždy-změní', row: 'A.1.1#26', source: 'navždy změní', kind: 'stem', severity: 'hard' },
  { id: 'nová-éra', row: 'A.1.1#27', source: 'nová éra', kind: 'stem', severity: 'hard' },
  { id: 'nový-věk', row: 'A.1.1#27', source: 'nový věk', kind: 'stem', severity: 'hard' },
  {
    id: 'přepisuje-učebnice',
    row: 'A.1.1#28',
    source: '(?<!\\p{L})přepis\\p{L}*\\s+učebnic\\p{L}*(?!\\p{L})',
    kind: 'pattern',
    severity: 'hard',
    note: 'A.1.1 #28, written as `přepis\\p{L}* učebnic\\p{L}*`.',
  },
  { id: 'jednou-provždy', row: 'A.1.1#29', source: 'jednou provždy', kind: 'stem', severity: 'hard' },
  { id: 'všechno-co-jsme-věděli', row: 'A.1.1#30', source: 'všechno, co jsme věděli', kind: 'stem', severity: 'hard' },
  { id: 'vše-co-víme', row: 'A.1.1#30', source: 'vše, co víme', kind: 'stem', severity: 'hard' },
  {
    id: 'raketový-růst',
    row: 'A.1.1#31',
    source: '(?<!\\p{L})raketov\\p{L}+\\s+(?:růst|nárůst)\\p{L}*(?!\\p{L})',
    kind: 'pattern',
    severity: 'hard',
    note: 'A.1.1 #31, written as `raketov\\p{L}+ (růst|nárůst)`.',
  },
  {
    id: 'explozivní-růst',
    row: 'A.1.1#32',
    source: '(?<!\\p{L})explozivn\\p{L}+\\s+(?:růst|nárůst)\\p{L}*(?!\\p{L})',
    kind: 'pattern',
    severity: 'hard',
    note: 'A.1.1 #32.',
  },
  { id: 'historický-průlom', row: 'A.1.1#33', source: 'historický průlom', kind: 'stem', severity: 'hard' },
  { id: 'historický-milník', row: 'A.1.1#33', source: 'historický milník', kind: 'stem', severity: 'hard' },
  { id: 'historický-úspěch', row: 'A.1.1#33', source: 'historický úspěch', kind: 'stem', severity: 'hard' },
  { id: 'zcela-zásadní', row: 'A.1.1#34', source: 'zcela zásadní', kind: 'stem', severity: 'hard' },
  { id: 'budoucnost-je-tady', row: 'A.1.1#35', source: 'budoucnost je tady', kind: 'stem', severity: 'hard' },
  {
    id: 'zlomov-hyped',
    row: 'A.1.1#36',
    source: 'zlomov',
    kind: 'stem',
    severity: 'hard',
    guard: { pattern: 'okamžik|bod|moment|objev', withinChars: 20, mode: 'require' },
    note:
      'A.1.1 #36. Bare `zlomov` is warn (A.1.2 #40) because *zlomová linie* is a ' +
      'geological fault and *zlomová pevnost* is engineering. It is hype only in ' +
      'the company of okamžik/bod/moment/objev.',
  },
  {
    id: 'průlom-hyped',
    row: 'A.1.2#37',
    source: 'průlom',
    kind: 'stem',
    severity: 'hard',
    guard: { pattern: 'bolest|infekc|krvácen|dávk', withinChars: 20, mode: 'reject' },
    note:
      'A.1.2 #37 lists `průlom` as warn, then says "Hard-reject only if not ' +
      'followed within 20 chars by bolest|infekc|krvácen|dávk". Those are real ' +
      'Czech medical terms — průlomová bolest, průlomová infekce, průlomové ' +
      'krvácení — so the guarded hard entry and the bare warn entry are both shipped.',
  },
];

// ===========================================================================
// A.1.2 — Czech, warn only. 18 shipped entries (#37..#54).
// ===========================================================================
export const HYPE_CS_WARN: readonly LexEntry[] = [
  {
    id: 'průlom',
    row: 'A.1.2#37',
    source: 'průlom',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #37 — see `průlom-hyped` for the hard half of this pair.',
  },
  {
    id: 'revoluc',
    row: 'A.1.2#38',
    source: 'revoluc',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #38 — průmyslová revoluce, zelená revoluce, Francouzská revoluce are ordinary nouns.',
  },
  {
    id: 'zásadní',
    row: 'A.1.2#39',
    source: 'zásadní',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #39 — zásadní otázka / zásadní rozdíl are legitimate; the phrase forms in A.1.1 catch the hype.',
  },
  {
    id: 'zlomov',
    row: 'A.1.2#40',
    source: 'zlomov',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #40 — zlomová linie (geology, Wed/Sat categories), zlomová pevnost (engineering).',
  },
  { id: 'ohromn', row: 'A.1.2#41', source: 'ohromn', kind: 'stem', severity: 'warn', note: 'A.1.2 #41 — ohromné množství is borderline but common.' },
  { id: 'mimořádn', row: 'A.1.2#42', source: 'mimořádn', kind: 'stem', severity: 'warn', note: 'A.1.2 #42 — mimořádná událost is a fixed term.' },
  { id: 'fascinující', row: 'A.1.2#43', source: 'fascinující', kind: 'stem', severity: 'warn', note: 'A.1.2 #43 — mild; too useful to ban outright.' },
  { id: 'dramatick', row: 'A.1.2#44', source: 'dramatick', kind: 'stem', severity: 'warn', note: 'A.1.2 #44 — dramaticky vzrostl is common journalism, still overheated.' },
  { id: 'masivn', row: 'A.1.2#45', source: 'masivn', kind: 'stem', severity: 'warn', note: 'A.1.2 #45 — anglicism for velký; also legitimate in physics (masivní hvězda).' },
  { id: 'obrovsk', row: 'A.1.2#46', source: 'obrovsk', kind: 'stem', severity: 'warn', note: 'A.1.2 #46 — vague magnitude word; prefer a number with an anchor.' },
  { id: 'naprosto', row: 'A.1.2#47', source: 'naprosto', kind: 'stem', severity: 'warn', note: 'A.1.2 #47 — intensifier.' },
  { id: 'zcela', row: 'A.1.2#48', source: 'zcela', kind: 'stem', severity: 'warn', note: 'A.1.2 #48 — intensifier; frequent in legitimate prose so warn only.' },
  { id: 'konečně', row: 'A.1.2#49', source: 'konečně', kind: 'stem', severity: 'warn', note: 'A.1.2 #49 — editorialising ("vědci konečně…").' },
  { id: 'slibn', row: 'A.1.2#50', source: 'slibn', kind: 'stem', severity: 'warn', note: 'A.1.2 #50 — soft hype; the honest form is "zatím jde o rané výsledky".' },
  { id: 'nadějn', row: 'A.1.2#51', source: 'nadějn', kind: 'stem', severity: 'warn', note: 'A.1.2 #51 — as #50.' },
  {
    id: 'zlatý-standard',
    row: 'A.1.2#52',
    source: 'zlatý standard',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #52 — legitimate methodological term; warn so a human notices it was used without a gloss.',
  },
  { id: 'nejvýznamnějš', row: 'A.1.2#53', source: 'nejvýznamnějš', kind: 'stem', severity: 'warn', note: 'A.1.2 #53 — superlative claim.' },
  {
    id: 'nejlepší-v-historii',
    row: 'A.1.2#54',
    source: 'nejlepší v historii',
    kind: 'stem',
    severity: 'warn',
    note: 'A.1.2 #54 — superlative claim; the design note says "treat as hard if you prefer; shipped as warn". Shipped as warn.',
  },
];

// ===========================================================================
// A.1.3 — English leak list. Matched only OUTSIDE parenthesised spans, because
// §2 legitimately puts English originals in parentheses on first use and
// `state-of-the-art` may appear there as a term being glossed.
// ===========================================================================
const EN_HARD_WORDS = [
  'revolutionary', 'revolutionise', 'revolutionize', 'breakthrough', 'game-changing',
  'game changer', 'gamechanger', 'groundbreaking', 'ground-breaking', 'unprecedented',
  'stunning', 'staggering', 'astonishing', 'astounding', 'mind-blowing', 'jaw-dropping',
  'miracle', 'miraculous', 'shocking', 'sensational', 'paradigm shift', 'holy grail',
  'silver bullet', 'world-first', 'first-ever', 'once and for all', 'rewrite the textbook',
  'rewrites the textbooks', 'skyrocket', 'skyrocketing', 'explosive growth', 'forever change',
  'changes everything', 'guaranteed to',
] as const;

const EN_WARN_WORDS = [
  'transformative', 'disruptive', 'cutting-edge', 'state-of-the-art', 'landmark', 'seismic',
  'monumental', 'remarkable', 'extraordinary', 'incredible', 'unbelievable', 'amazing',
  'massive', 'huge', 'dramatic', 'promising', 'novel', 'unparalleled', 'unmatched',
] as const;

export const HYPE_EN_HARD: readonly LexEntry[] = EN_HARD_WORDS.map((w) => ({
  id: `en:${w.replace(/\s+/gu, '-')}`,
  source: w,
  kind: 'stem' as const,
  severity: 'hard' as const,
}));

export const HYPE_EN_WARN: readonly LexEntry[] = EN_WARN_WORDS.map((w) => ({
  id: `en:${w.replace(/\s+/gu, '-')}`,
  source: w,
  kind: 'stem' as const,
  severity: 'warn' as const,
}));

// ===========================================================================
// A.4.1 — jargon term list. All entries hard unless the design note says warn.
// `englishOriginal` drives the warn-level `jargon:no_english_original` check of
// A.4.2 — it is set only where an English original genuinely helps a Czech
// reader who will meet the term elsewhere (§2), which is why `medián` and
// `placebo` do not have one.
// ===========================================================================
export interface JargonEntry {
  /** Stable id, used as `jargon:no_gloss:<id>`. */
  id: string;
  /** Human-readable Czech term, quoted back in `messageCs`. */
  termCs: string;
  /** All surface forms — Czech stem first, then the English aliases of A.4.1. */
  forms: readonly LexEntry[];
  severity: Severity;
  /** The English original §2 wants in parentheses on first use, when there is one. */
  englishOriginal?: string;
}

function stem(id: string, source: string, extra: Partial<LexEntry> = {}): LexEntry {
  return { id, source, kind: 'stem', severity: 'hard', ...extra };
}
function pat(id: string, source: string, extra: Partial<LexEntry> = {}): LexEntry {
  return { id, source, kind: 'pattern', severity: 'hard', ...extra };
}

export const JARGON_TERMS: readonly JargonEntry[] = [
  // ---- Statistics & study design ----
  {
    id: 'p-hodnota',
    termCs: 'p-hodnota',
    englishOriginal: 'p-value',
    severity: 'hard',
    forms: [
      stem('p-hodnota', 'p-hodnota'),
      stem('p-value', 'p-value'),
      // `p <` cannot be a stem: it does not end in a letter.
      pat('p-lt', '(?<!\\p{L})p\\s*[<≤=]\\s*0?[.,]\\p{N}'),
    ],
  },
  {
    id: 'statisticky-vyznamny',
    termCs: 'statisticky významný',
    englishOriginal: 'statistically significant',
    severity: 'hard',
    // A.4.1 specifies this one as a bigram "`statistick` + `významn` within 3
    // words", so it is written as one pattern with an explicit word gap rather
    // than as two independent stems.
    forms: [pat('statisticky-vyznamny', '(?<!\\p{L})statistick\\p{L}*(?:\\s+\\p{L}+){0,2}\\s+významn\\p{L}*(?!\\p{L})')],
  },
  {
    id: 'konfidencni-interval',
    termCs: 'konfidenční interval',
    englishOriginal: 'confidence interval',
    severity: 'hard',
    forms: [
      stem('konfidencni-interval', 'konfidenční interval'),
      stem('confidence-interval', 'confidence interval'),
      pat('ci-95', '(?<![\\p{L}\\p{N}])95\\s*%?\\s*CI(?!\\p{L})', { caseSensitive: true }),
    ],
  },
  { id: 'median', termCs: 'medián', severity: 'hard', forms: [stem('median', 'medián')] },
  {
    id: 'smerodatna-odchylka',
    termCs: 'směrodatná odchylka',
    englishOriginal: 'standard deviation',
    severity: 'hard',
    forms: [stem('smerodatna-odchylka', 'směrodatná odchylka')],
  },
  { id: 'korelace', termCs: 'korelace', englishOriginal: 'correlation', severity: 'hard', forms: [stem('korelac', 'korelac')] },
  { id: 'kauzalita', termCs: 'kauzalita', englishOriginal: 'causality', severity: 'hard', forms: [stem('kauzal', 'kauzal')] },
  { id: 'regrese', termCs: 'regrese', englishOriginal: 'regression', severity: 'hard', forms: [stem('regres', 'regres')] },
  {
    id: 'randomizovany',
    termCs: 'randomizovaný',
    englishOriginal: 'randomised',
    severity: 'hard',
    forms: [stem('randomizovan', 'randomizovan')],
  },
  {
    id: 'rct',
    termCs: 'randomizovaná kontrolovaná studie',
    englishOriginal: 'randomised controlled trial',
    severity: 'hard',
    forms: [
      stem('randomised-controlled-trial', 'randomised controlled trial'),
      stem('randomized-controlled-trial', 'randomized controlled trial'),
      pat('rct', '(?<!\\p{L})RCT(?!\\p{L})', { caseSensitive: true }),
    ],
  },
  {
    id: 'dvojite-zaslepeny',
    termCs: 'dvojitě zaslepený',
    englishOriginal: 'double-blind',
    severity: 'hard',
    forms: [stem('dvojite-zaslepen', 'dvojitě zaslepen'), stem('double-blind', 'double-blind')],
  },
  { id: 'placebo', termCs: 'placebo', severity: 'hard', forms: [stem('placebo', 'placebo')] },
  { id: 'kohorta', termCs: 'kohorta', englishOriginal: 'cohort', severity: 'hard', forms: [stem('kohort', 'kohort'), stem('cohort', 'cohort')] },
  {
    id: 'metaanalyza',
    termCs: 'metaanalýza',
    englishOriginal: 'meta-analysis',
    severity: 'hard',
    forms: [stem('metaanalyz', 'metaanalýz'), stem('meta-analysis', 'meta-analysis')],
  },
  {
    id: 'systematicky-prehled',
    termCs: 'systematický přehled',
    englishOriginal: 'systematic review',
    severity: 'hard',
    forms: [stem('systematicky-prehled', 'systematický přehled'), stem('systematic-review', 'systematic review')],
  },
  { id: 'longitudinalni', termCs: 'longitudinální', englishOriginal: 'longitudinal', severity: 'hard', forms: [stem('longitudinaln', 'longitudináln')] },
  {
    id: 'prurezovy',
    termCs: 'průřezová studie',
    englishOriginal: 'cross-sectional',
    severity: 'hard',
    forms: [stem('prurezov', 'průřezov')],
    // A.4.1 qualifies this one "(study sense)"; the stem also matches
    // `průřezový profil` in engineering. See the false-positive note in the report.
  },
  { id: 'kontrolni-skupina', termCs: 'kontrolní skupina', englishOriginal: 'control group', severity: 'hard', forms: [stem('kontrolni-skupin', 'kontrolní skupin')] },
  {
    id: 'velikost-ucinku',
    termCs: 'velikost účinku',
    englishOriginal: 'effect size',
    severity: 'hard',
    forms: [stem('velikost-ucinku', 'velikost účinku'), stem('effect-size', 'effect size')],
  },
  {
    id: 'pomer-sanci',
    termCs: 'poměr šancí',
    englishOriginal: 'odds ratio',
    severity: 'hard',
    forms: [
      stem('pomer-sanci', 'poměr šancí'),
      stem('odds-ratio', 'odds ratio'),
      pat('or-eq', '(?<!\\p{L})OR\\s*=', { caseSensitive: true }),
    ],
  },
  {
    id: 'hazard-ratio',
    termCs: 'poměr rizik',
    englishOriginal: 'hazard ratio',
    severity: 'hard',
    forms: [stem('hazard-ratio', 'hazard ratio'), pat('hr-eq', '(?<!\\p{L})HR\\s*=', { caseSensitive: true })],
  },
  { id: 'incidence', termCs: 'incidence', englishOriginal: 'incidence', severity: 'hard', forms: [stem('incidenc', 'incidenc')] },
  { id: 'prevalence', termCs: 'prevalence', englishOriginal: 'prevalence', severity: 'hard', forms: [stem('prevalenc', 'prevalenc')] },
  {
    id: 'statisticka-sila',
    termCs: 'statistická síla',
    englishOriginal: 'statistical power',
    severity: 'hard',
    forms: [stem('statisticka-sila', 'statistická síla'), stem('statistical-power', 'statistical power')],
  },
  { id: 'zkresleni', termCs: 'zkreslení', englishOriginal: 'bias', severity: 'hard', forms: [stem('zkreslen', 'zkreslen'), stem('bias', 'bias')] },
  {
    id: 'confounder',
    termCs: 'matoucí proměnná',
    englishOriginal: 'confounder',
    severity: 'hard',
    forms: [stem('matouci-promenn', 'matoucí proměnn'), stem('konfaunder', 'konfaunder'), stem('confounder', 'confounder')],
  },
  { id: 'reprodukovatelnost', termCs: 'reprodukovatelnost', englishOriginal: 'reproducibility', severity: 'hard', forms: [stem('reprodukovateln', 'reprodukovateln')] },
  { id: 'replikace', termCs: 'replikace', englishOriginal: 'replication', severity: 'hard', forms: [stem('replikac', 'replikac')] },
  { id: 'preprint', termCs: 'preprint', severity: 'hard', forms: [stem('preprint', 'preprint')] },
  {
    id: 'recenzni-rizeni',
    termCs: 'recenzní řízení',
    englishOriginal: 'peer review',
    severity: 'hard',
    forms: [stem('recenzni-rizeni', 'recenzní řízení'), stem('peer-review', 'peer review')],
  },
  { id: 'publikacni-zkresleni', termCs: 'publikační zkreslení', englishOriginal: 'publication bias', severity: 'hard', forms: [stem('publikacni-zkresleni', 'publikační zkreslení')] },

  // ---- Computing / AI ----
  {
    id: 'strojove-uceni',
    termCs: 'strojové učení',
    englishOriginal: 'machine learning',
    severity: 'hard',
    forms: [stem('strojove-uceni', 'strojové učení'), stem('machine-learning', 'machine learning')],
  },
  {
    id: 'neuronova-sit',
    termCs: 'neuronová síť',
    englishOriginal: 'neural network',
    severity: 'hard',
    forms: [
      // `síť` inflects irregularly (síť / sítě / sítí), so the adjective carries
      // the stem match and the noun is a short alternation.
      pat('neuronova-sit', '(?<!\\p{L})neuronov\\p{L}*\\s+sí(?:ť|t)\\p{L}*(?!\\p{L})'),
      stem('neural-network', 'neural network'),
    ],
  },
  {
    id: 'hluboke-uceni',
    termCs: 'hluboké učení',
    englishOriginal: 'deep learning',
    severity: 'hard',
    forms: [stem('hluboke-uceni', 'hluboké učení'), stem('deep-learning', 'deep learning')],
  },
  {
    id: 'velky-jazykovy-model',
    termCs: 'velký jazykový model',
    englishOriginal: 'large language model',
    severity: 'hard',
    forms: [
      pat('velky-jazykovy-model', '(?<!\\p{L})velk\\p{L}*\\s+jazykov\\p{L}*\\s+model\\p{L}*(?!\\p{L})'),
      stem('large-language-model', 'large language model'),
      pat('llm', '(?<!\\p{L})LLM(?!\\p{L})', { caseSensitive: true }),
    ],
  },
  { id: 'transformer', termCs: 'transformer', severity: 'hard', forms: [stem('transformer', 'transformer')] },
  {
    id: 'doladeni',
    termCs: 'doladění',
    englishOriginal: 'fine-tuning',
    severity: 'hard',
    forms: [stem('doladeni', 'doladění'), stem('fine-tuning', 'fine-tuning'), stem('fine-tuned', 'fine-tuned')],
  },
  { id: 'benchmark', termCs: 'benchmark', severity: 'hard', forms: [stem('benchmark', 'benchmark')] },
  {
    id: 'datova-sada',
    termCs: 'datová sada',
    englishOriginal: 'dataset',
    severity: 'hard',
    forms: [pat('datova-sada', '(?<!\\p{L})datov\\p{L}*\\s+sad\\p{L}*(?!\\p{L})'), stem('dataset', 'dataset')],
  },
  { id: 'algoritmus', termCs: 'algoritmus', englishOriginal: 'algorithm', severity: 'hard', forms: [stem('algoritm', 'algoritm')] },
  {
    id: 'trenovaci-data',
    termCs: 'trénovací data',
    englishOriginal: 'training data',
    severity: 'hard',
    forms: [stem('trenovaci-data', 'trénovací data'), stem('training-data', 'training data')],
  },
  {
    id: 'parametr',
    termCs: 'parametr',
    severity: 'hard',
    forms: [stem('parametr', 'parametr')],
    // A.4.1 qualifies this "(model sense)". The stem cannot tell the model sense
    // from the ordinary one; see the false-positive note in the report.
  },
  { id: 'inference', termCs: 'inference', englishOriginal: 'inference', severity: 'hard', forms: [stem('inferenc', 'inferenc')] },
  { id: 'token', termCs: 'token', severity: 'hard', forms: [stem('token', 'token')] },
  { id: 'latence', termCs: 'latence', englishOriginal: 'latency', severity: 'hard', forms: [stem('latenc', 'latenc')] },
  {
    id: 'qubit',
    termCs: 'kvantový bit',
    englishOriginal: 'qubit',
    severity: 'hard',
    forms: [pat('kvantovy-bit', '(?<!\\p{L})kvantov\\p{L}*\\s+bit\\p{L}*(?!\\p{L})'), stem('qubit', 'qubit')],
  },
  { id: 'superpozice', termCs: 'superpozice', englishOriginal: 'superposition', severity: 'hard', forms: [stem('superpozic', 'superpozic')] },
  {
    id: 'entanglement',
    termCs: 'kvantové provázání',
    englishOriginal: 'entanglement',
    severity: 'hard',
    forms: [pat('kvantove-provazani', '(?<!\\p{L})kvantov\\p{L}*\\s+provázán\\p{L}*(?!\\p{L})'), stem('entanglement', 'entanglement')],
  },
  { id: 'heuristika', termCs: 'heuristika', englishOriginal: 'heuristic', severity: 'hard', forms: [stem('heuristik', 'heuristik')] },

  // ---- Life sciences & medicine ----
  { id: 'genom', termCs: 'genom', englishOriginal: 'genome', severity: 'hard', forms: [stem('genom', 'genom')] },
  {
    id: 'exprese-genu',
    termCs: 'exprese genů',
    englishOriginal: 'gene expression',
    severity: 'hard',
    forms: [stem('exprese-genu', 'exprese genů'), stem('gene-expression', 'gene expression')],
  },
  { id: 'crispr', termCs: 'CRISPR', severity: 'hard', forms: [pat('crispr', '(?<!\\p{L})CRISPR(?!\\p{L})', { caseSensitive: true })] },
  { id: 'rna', termCs: 'RNA', severity: 'hard', forms: [pat('rna', '(?<![\\p{L}])RNA(?!\\p{L})', { caseSensitive: true })] },
  { id: 'mrna', termCs: 'mRNA', severity: 'hard', forms: [pat('mrna', '(?<!\\p{L})mRNA(?!\\p{L})', { caseSensitive: true })] },
  {
    id: 'sekvenovani',
    termCs: 'sekvenování',
    englishOriginal: 'sequencing',
    severity: 'hard',
    forms: [stem('sekvenovan', 'sekvenován'), stem('sequencing', 'sequencing')],
  },
  { id: 'biomarker', termCs: 'biomarker', severity: 'hard', forms: [stem('biomarker', 'biomarker')] },
  { id: 'protilatka', termCs: 'protilátka', englishOriginal: 'antibody', severity: 'hard', forms: [stem('protilatk', 'protilátk'), stem('antibody', 'antibody')] },
  { id: 'receptor', termCs: 'receptor', severity: 'hard', forms: [stem('receptor', 'receptor')] },
  { id: 'enzym', termCs: 'enzym', severity: 'hard', forms: [stem('enzym', 'enzym')] },
  { id: 'metabolismus', termCs: 'metabolismus', englishOriginal: 'metabolism', severity: 'hard', forms: [stem('metabolism', 'metabolism')] },
  { id: 'mikrobiom', termCs: 'mikrobiom', englishOriginal: 'microbiome', severity: 'hard', forms: [stem('mikrobiom', 'mikrobiom'), stem('microbiome', 'microbiome')] },
  { id: 'epigenetika', termCs: 'epigenetika', englishOriginal: 'epigenetics', severity: 'hard', forms: [stem('epigenetik', 'epigenetik')] },
  { id: 'in-vitro', termCs: 'in vitro', severity: 'hard', forms: [stem('in-vitro', 'in vitro')] },
  { id: 'in-vivo', termCs: 'in vivo', severity: 'hard', forms: [stem('in-vivo', 'in vivo')] },
  { id: 'patogen', termCs: 'patogen', severity: 'hard', forms: [stem('patogen', 'patogen')] },
  {
    id: 'imunita',
    termCs: 'imunita',
    severity: 'hard',
    forms: [stem('imunit', 'imunit')],
    // A.4.1 qualifies this "(technical sense)"; `imunitní systém` is arguably
    // everyday Czech. See the false-positive note in the report.
  },
  { id: 'kortizol', termCs: 'kortizol', severity: 'warn', forms: [stem('kortizol', 'kortizol', { severity: 'warn' })] },
  { id: 'inzulin', termCs: 'inzulin', severity: 'warn', forms: [stem('inzulin', 'inzulin', { severity: 'warn' })] },

  // ---- Physics / earth / engineering ----
  { id: 'izotop', termCs: 'izotop', severity: 'hard', forms: [stem('izotop', 'izotop')] },
  {
    id: 'polocas-rozpadu',
    termCs: 'poločas rozpadu',
    englishOriginal: 'half-life',
    severity: 'hard',
    forms: [stem('polocas-rozpadu', 'poločas rozpadu'), stem('half-life', 'half-life')],
  },
  { id: 'spektroskopie', termCs: 'spektroskopie', englishOriginal: 'spectroscopy', severity: 'hard', forms: [stem('spektroskopi', 'spektroskopi')] },
  { id: 'katalyzator', termCs: 'katalyzátor', englishOriginal: 'catalyst', severity: 'hard', forms: [stem('katalyzator', 'katalyzátor')] },
  { id: 'elektrolyt', termCs: 'elektrolyt', severity: 'hard', forms: [stem('elektrolyt', 'elektrolyt')] },
  {
    id: 'fotovoltaika',
    termCs: 'fotovoltaika',
    severity: 'warn',
    forms: [stem('fotovoltaik', 'fotovoltaik', { severity: 'warn' })],
    // A.4.1 writes "`fotovoltaik` — **warn**, `COP` / `topný faktor`". The em
    // dash binds the warn to `fotovoltaik` only; `COP` is a separate hard entry.
  },
  {
    id: 'cop',
    termCs: 'topný faktor',
    englishOriginal: 'COP',
    severity: 'hard',
    forms: [
      pat('cop', '(?<!\\p{L})COP(?!\\p{L})', { caseSensitive: true }),
      stem('topny-faktor', 'topný faktor'),
    ],
  },
  {
    id: 'sedimentarni-jadro',
    termCs: 'sedimentární jádro',
    englishOriginal: 'sediment core',
    severity: 'hard',
    forms: [stem('sedimentarni-jadro', 'sedimentární jádro'), stem('sediment-core', 'sediment core')],
  },
  {
    id: 'monte-carlo',
    termCs: 'modelování metodou Monte Carlo',
    englishOriginal: 'Monte Carlo',
    severity: 'hard',
    forms: [stem('monte-carlo', 'monte carlo')],
  },
  {
    id: 'emisni-scenar',
    termCs: 'emisní scénář',
    englishOriginal: 'emission scenario',
    severity: 'hard',
    forms: [
      stem('emisni-scenar', 'emisní scénář'),
      pat('rcp', '(?<!\\p{L})RCP(?![\\p{L}])', { caseSensitive: true }),
      pat('ssp', '(?<!\\p{L})SSP(?![\\p{L}])', { caseSensitive: true }),
    ],
  },
  { id: 'aerosol', termCs: 'aerosol', severity: 'hard', forms: [stem('aerosol', 'aerosol')] },

  // ---- Economics / social ----
  { id: 'elasticita', termCs: 'elasticita', englishOriginal: 'elasticity', severity: 'hard', forms: [stem('elasticit', 'elasticit')] },
  {
    id: 'kvazi-experiment',
    termCs: 'kvazi-experiment',
    englishOriginal: 'difference-in-differences',
    severity: 'hard',
    forms: [stem('kvazi-experiment', 'kvazi-experiment'), stem('difference-in-differences', 'difference-in-differences')],
  },
  {
    id: 'instrumentalni-promenna',
    termCs: 'instrumentální proměnná',
    englishOriginal: 'instrumental variable',
    severity: 'hard',
    forms: [stem('instrumentalni-promenn', 'instrumentální proměnn')],
  },
  {
    id: 'giniho-koeficient',
    termCs: 'Giniho koeficient',
    englishOriginal: 'Gini coefficient',
    severity: 'hard',
    forms: [stem('giniho-koeficient', 'giniho koeficient')],
  },
  { id: 'realna-mzda', termCs: 'reálná mzda', englishOriginal: 'real wage', severity: 'hard', forms: [stem('realna-mzda', 'reálná mzda')] },
  { id: 'median-prijmu', termCs: 'medián příjmu', severity: 'warn', forms: [stem('median-prijmu', 'medián příjmu', { severity: 'warn' })] },
  {
    id: 'kvalitativni-analyza',
    termCs: 'kvalitativní analýza',
    severity: 'warn',
    forms: [stem('kvalitativni-analyz', 'kvalitativní analýz', { severity: 'warn' })],
  },
];

// ===========================================================================
// A.2.3 — function-word lists for the English-likelihood score.
// ===========================================================================

/**
 * Excluded from BOTH counters. These are frequent in Czech and in English and
 * would otherwise poison the score in whichever direction the sentence happens
 * to lean. A.2.3 gives a draft list and then a "final list"; the final list is
 * what ships.
 */
export const AMBIGUOUS_TOKENS: ReadonlySet<string> = new Set([
  'a', 'i', 'o', 'u', 'v', 's', 'k', 'z', 'to', 'ten', 'ta', 'no', 'on', 'do', 'by', 'be',
  'my', 'se', 'si', 'za', 'pro', 'pod', 'nad',
]);

/** A.2.3's EN_FUNCTION list, verbatim. */
export const EN_FUNCTION: ReadonlySet<string> = new Set([
  'the', 'an', 'and', 'or', 'but', 'of', 'in', 'at', 'to', 'for', 'with', 'without', 'from',
  'as', 'into', 'over', 'under', 'between', 'among', 'about', 'after', 'before', 'during',
  'through', 'per', 'both', 'each', 'other', 'some', 'any', 'all', 'is', 'are', 'was', 'were',
  'been', 'being', 'has', 'have', 'had', 'does', 'did', 'this', 'that', 'these', 'those', 'it',
  'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her',
  'which', 'who', 'whom', 'whose', 'when', 'where', 'while', 'than', 'then', 'there', 'here',
  'not', 'can', 'could', 'may', 'might', 'will', 'would', 'should', 'must', 'more', 'most',
  'less', 'also', 'however', 'therefore', 'because', 'if', 'so', 'such', 'very', 'just',
  'only', 'what', 'how', 'why', 'every', 'another',
]);

/** A.2.3's CS_FUNCTION list, verbatim. `při` is listed twice there; a Set dedupes it. */
export const CS_FUNCTION: ReadonlySet<string> = new Set([
  'ale', 'nebo', 'že', 'jsou', 'jsem', 'jsme', 'jste', 'byl', 'byla', 'bylo', 'byly', 'byli',
  'být', 'není', 'nebyl', 'nebyla', 'na', 'od', 'po', 'při', 'před', 've', 'ke', 'ze', 'jako',
  'který', 'která', 'které', 'kteří', 'kterou', 'kterého', 'když', 'protože', 'aby', 'tedy',
  'také', 'však', 'ještě', 'už', 'jen', 'více', 'méně', 'mezi', 'podle', 'kolem', 'díky',
  'tento', 'tato', 'toto', 'tyto', 'tomu', 'této', 'těchto', 'jejich', 'jeho', 'její', 'oni',
  'ony', 'nás', 'jim', 'jej', 'ji', 'mu', 'jsemli', 'nikoli', 'velmi', 'právě', 'zatímco',
  'proto', 'tam', 'tady', 'kde', 'jak', 'proč', 'každý', 'další', 'jiný', 'stejný', 'takže',
]);

/** A.2.3's Czech morphological suffixes (counter `Msuf`). */
export const CZECH_SUFFIX_RE =
  /(?:ých|ém|ému|ost|ostí|ovat|ování|ání|ení|ěji|ější|ových|ovým|ám|ami|ách|ku|ce|ci)$/u;

/** A.2.3's English-only suffixes (counter `Esuf`). */
export const ENGLISH_SUFFIX_RE =
  /(?:ing|tion|tions|ment|ments|ness|ity|ities|ously|edly|ally|ical|ized|ised|ization)$/u;
