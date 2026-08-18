/**
 * The literal word lists behind §6's ranking — DESIGN-NOTES B.3.1, B.3.2, B.4.
 *
 * ============================================================================
 * THESE LISTS ARE ENGLISH, AND THEY MATCH ENGLISH SOURCE TEXT ONLY.
 * ============================================================================
 *
 * Ranking runs *before* summarisation (B.0): at this point in the pipeline the
 * only text that exists is the paper's own `title`, `abstract` and `tldr`, all
 * of them English. The Czech output does not exist yet, and no Czech word list
 * belongs in this file. The mirror-image mistake — matching Czech hype words
 * against an English abstract — lives in the *style* checker (Section A) and is
 * the single easiest thing to get backwards when reading the two side by side.
 *
 * Why here and not in `config.json`: §8 says config holds "nothing that a
 * future change would plausibly touch", meaning knobs — weights, windows, caps.
 * These are corpora: ~700 terms whose individual membership is a lexicographic
 * judgement, not an operational setting. Putting them in config would make the
 * file unreadable and would invite editing a ranking corpus without a test run.
 * The weights that *combine* them stay in `config.ranking.weights`.
 *
 * Matching (see `matchTerms`): the source text is lower-cased and its
 * whitespace normalised; boundaries are `(?<!\p{L})` / `(?!\p{L})` rather than
 * `\b`, because JS `\b` and `\w` are ASCII-only and English abstracts carry
 * accented author names, `naïve`, `Poincaré`, µ and °C (DESIGN-NOTES A.0.1).
 * Every regex in this file therefore has the `u` flag.
 */

// ---------------------------------------------------------------------------
// B.3.1 (v) — concrete-outcome verbs
// ---------------------------------------------------------------------------

/**
 * A paper that *did something measurable* says so with one of these. The list
 * is deliberately surface-level: no stemmer, both tenses spelled out, because a
 * stemmer would also collapse `modelled`/`model` and destroy the distinction
 * B.3 exists to draw.
 */
export const OUTCOME_VERBS: readonly string[] = [
  'reduced',
  'reduces',
  'reduction',
  'increased',
  'increases',
  'improved',
  'improves',
  'improvement',
  'lowered',
  'lowers',
  'raised',
  'raises',
  'prevented',
  'prevents',
  'prevention',
  'cured',
  'cures',
  'slowed',
  'slows',
  'accelerated',
  'doubled',
  'halved',
  'tripled',
  'predicted',
  'predicts',
  'detected',
  'detects',
  'detection',
  'restored',
  'restores',
  'protected',
  'protects',
  'delayed',
  'delays',
  'boosted',
  'boosts',
  'cut',
  'shortened',
  'shortens',
  'extended',
  'extends',
  'decreased',
  'decreases',
  'eliminated',
  'eliminates',
  'outperformed',
  'enabled',
  'enables',
  'caused',
  'causes',
  'triggered',
  'led to',
  'resulted in',
  'associated with',
  'linked to',
  'correlated with',
  'was followed by',
];

// ---------------------------------------------------------------------------
// B.3.1 (s) — recognisable subject nouns
// ---------------------------------------------------------------------------

/**
 * Who or what the finding is *about*. A reader with no scientific background
 * can picture every entry here without help, which is exactly the test §6
 * factor 1 applies.
 */
export const SUBJECT_NOUNS: readonly string[] = [
  'participants',
  'patients',
  'volunteers',
  'subjects',
  'children',
  'kids',
  'adolescents',
  'teenagers',
  'students',
  'pupils',
  'adults',
  'women',
  'men',
  'mothers',
  'infants',
  'babies',
  'elderly',
  'older adults',
  'workers',
  'employees',
  'drivers',
  'households',
  'families',
  'consumers',
  'farmers',
  'nurses',
  'teachers',
  'residents',
  'mice',
  'rats',
  'dogs',
  'cats',
  'bees',
  'birds',
  'fish',
  'cattle',
  'pigs',
  'plants',
  'crops',
  'wheat',
  'maize',
  'soil',
  'rivers',
  'lakes',
  'forests',
  'cities',
  'towns',
  'schools',
  'hospitals',
  'homes',
  'buildings',
  'roads',
  'cars',
  'batteries',
  'phones',
];

// ---------------------------------------------------------------------------
// B.3.1 (q) — quantified effect present
// ---------------------------------------------------------------------------

/** One labelled pattern, so the run log can say *which* number it found. */
export interface QuantifiedEffectPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * B.3.1 writes these with `\b`. They are rebuilt here with explicit Unicode
 * boundaries (A.0.1) and, unlike the rest of this module, they run against the
 * text in its **original case**: `OR = 1.8` (an odds ratio) and the English
 * word "or" are the same string once lower-cased, and only the case tells them
 * apart. The remaining patterns are case-insensitive because `N = 400`,
 * `95% CI` and `Cohen's d` all appear in both casings in real abstracts.
 */
export const QUANTIFIED_EFFECT_PATTERNS: readonly QuantifiedEffectPattern[] = [
  { label: 'percentage', pattern: /\d+(?:\.\d+)?\s?%/u },
  { label: 'p-value', pattern: /(?<!\p{L})p\s?[<=]\s?0?\.\d+/iu },
  // Case-sensitive on purpose — see the note above.
  { label: 'effect ratio', pattern: /(?<!\p{L})(?:OR|RR|HR|SMD|IRR)\s?[=:]\s?\d/u },
  { label: '95% CI', pattern: /95\s?%\s?CI/iu },
  { label: 'sample size', pattern: /(?<![\p{L}\p{N}])n\s?=\s?\d{2,}/iu },
  { label: 'fold change', pattern: /(?<![\p{L}\p{N}])\d+(?:\.\d+)?[-\s]fold(?!\p{L})/iu },
  {
    label: 'times higher/lower',
    pattern:
      /(?<![\p{L}\p{N}])\d+(?:\.\d+)?\s?times\s+(?:higher|lower|more|less|greater|faster|slower)(?!\p{L})/iu,
  },
  {
    label: 'increase/decrease of n',
    pattern: /(?<!\p{L})(?:increase|decrease|reduction|improvement)\s+of\s+\d/iu,
  },
  { label: "Cohen's d", pattern: /(?<!\p{L})cohen['’]?s\s?d\s?[=:]/iu },
];

// ---------------------------------------------------------------------------
// B.3.1 (c) — title concreteness penalties
// ---------------------------------------------------------------------------

/**
 * "Something: A Framework for Something" is the shape of a paper about a
 * method rather than about a result. The words themselves are innocent — the
 * penalty needs the colon, which is why it is a pattern and not a word list.
 */
export const TITLE_METHOD_NOUNS: readonly string[] = [
  'framework',
  'architecture',
  'network',
  'model',
  'approach',
  'method',
  'methodology',
  'algorithm',
  'toolkit',
  'pipeline',
  'benchmark',
  'dataset',
  'corpus',
  'library',
  'formalism',
  'taxonomy',
];

/** B.3.1 c, first bullet: `:\s.*\b(framework|architecture|…)\b` → −0.4. */
export const TITLE_METHOD_SUBTITLE = new RegExp(
  `:\\s.*(?<!\\p{L})(?:${TITLE_METHOD_NOUNS.join('|')})(?!\\p{L})`,
  'u',
);

/** B.3.1 c, fourth bullet: chemical and technical strings, e.g. `Li6PS5Cl-based`. */
export const TITLE_LONG_TOKEN_MIN_CHARS = 15;
export const TITLE_LONG_TOKEN_MIN_COUNT = 2;
/** B.3.1 c, third bullet. */
export const TITLE_MAX_WORDS = 18;

// ---------------------------------------------------------------------------
// B.3.2 (t) — theoretical / methods-about-methods markers
// ---------------------------------------------------------------------------

/**
 * The negative image of `OUTCOME_VERBS`: a paper that proves a theorem, extends
 * an estimator or releases a benchmark may be excellent work and still have no
 * sentence a 15-year-old can be told. §6 ranks it below a measurable effect
 * "even if the latter is more cited", and this is the operational form of that.
 */
export const THEORETICAL_MARKERS: readonly string[] = [
  'we propose a framework',
  'we present a framework',
  'theoretical analysis',
  'we prove',
  'we derive',
  'theorem',
  'lemma',
  'corollary',
  'proof of',
  'asymptotic',
  'complexity bound',
  'convergence rate',
  'closed-form',
  'we formalise',
  'we formalize',
  'formalism',
  'axiom',
  'ablation study',
  'we introduce a novel architecture',
  'state-of-the-art results',
  'sota',
  'leaderboard',
  'benchmark suite',
  'we release a dataset',
  'taxonomy of',
  'position paper',
  'scoping review',
  'bibliometric analysis',
  'we survey',
  'this survey',
  'simulation study of estimators',
  'monte carlo simulation study',
  'we extend the model of',
  'methodological note',
  'protocol for a',
  'study protocol',
  'registered report protocol',
  'we compare estimators',
  'sensitivity analysis of methods',
  'in silico only',
];

// ---------------------------------------------------------------------------
// B.3.2 (j) — jargon density
// ---------------------------------------------------------------------------

/** A token this long is, in an English abstract, almost always terminology. */
export const JARGON_TOKEN_MIN_CHARS = 14;
/** B.3.2: 10 % of such tokens saturates the penalty. */
export const JARGON_SATURATION_SHARE = 0.1;

// ---------------------------------------------------------------------------
// B.4 — everyday-relevance domains
// ---------------------------------------------------------------------------

export interface EverydayDomain {
  readonly key: string;
  readonly terms: readonly string[];
}

/**
 * §6 factor 2, made literal: "does it touch something the reader recognises:
 * food, sleep, schools, phones, energy, health, prices, weather?" — the spec
 * names eight, B.4 expands them to sixteen so that the Wednesday (climate) and
 * Sunday (agriculture) categories are not scored against a list built for the
 * Tuesday (health) one.
 *
 * Each domain scores **at most once** however many of its terms hit, so a paper
 * that says "sleep" forty times does not out-rank one that connects sleep to
 * school results.
 */
export const EVERYDAY_DOMAINS: readonly EverydayDomain[] = [
  {
    key: 'food',
    terms: [
      'food',
      'diet',
      'dietary',
      'nutrition',
      'nutrient',
      'eating',
      'meal',
      'meals',
      'sugar',
      'salt',
      'sodium',
      'fat',
      'protein',
      'vegetable',
      'fruit',
      'meat',
      'dairy',
      'milk',
      'bread',
      'coffee',
      'tea',
      'alcohol',
      'obesity',
      'overweight',
      'calorie',
      'calories',
      'supplement',
      'cooking',
      'appetite',
      'ultra-processed',
      'breakfast',
    ],
  },
  {
    key: 'sleep',
    terms: [
      'sleep',
      'sleeping',
      'insomnia',
      'nap',
      'napping',
      'bedtime',
      'circadian',
      'drowsiness',
      'sleepiness',
      'sleep quality',
      'sleep duration',
    ],
  },
  {
    key: 'school',
    terms: [
      'school',
      'schools',
      'student',
      'students',
      'pupil',
      'pupils',
      'classroom',
      'teacher',
      'teachers',
      'learning outcomes',
      'homework',
      'exam',
      'exams',
      'test scores',
      'literacy',
      'numeracy',
      'curriculum',
      'university',
      'tuition',
      'dropout',
    ],
  },
  {
    key: 'screens',
    terms: [
      'smartphone',
      'smartphones',
      'mobile phone',
      'screen time',
      'social media',
      'app',
      'apps',
      'internet use',
      'online',
      'tiktok',
      'instagram',
      'facebook',
      'notification',
      'notifications',
      'video game',
      'gaming',
      'chatbot',
    ],
  },
  {
    key: 'energy',
    terms: [
      'energy',
      'electricity',
      'heating',
      'cooling',
      'heat pump',
      'insulation',
      'solar',
      'photovoltaic',
      'wind power',
      'battery',
      'batteries',
      'fuel',
      'gasoline',
      'petrol',
      'diesel',
      'power grid',
      'energy bill',
      'energy efficiency',
      'blackout',
    ],
  },
  {
    key: 'health',
    terms: [
      'health',
      'patient',
      'patients',
      'disease',
      'illness',
      'cancer',
      'diabetes',
      'infection',
      'vaccine',
      'vaccination',
      'influenza',
      'covid',
      'blood pressure',
      'cholesterol',
      'depression',
      'anxiety',
      'dementia',
      'alzheimer',
      'allergy',
      'asthma',
      'antibiotic',
      'pain',
      'mortality',
      'hospital',
      'clinic',
      'therapy',
      'treatment',
      'drug',
      'medication',
      'screening',
    ],
  },
  {
    key: 'money',
    terms: [
      'price',
      'prices',
      'cost',
      'costs',
      'inflation',
      'wage',
      'wages',
      'salary',
      'income',
      'poverty',
      'tax',
      'taxes',
      'mortgage',
      'rent',
      'spending',
      'unemployment',
      'insurance',
      'savings',
      'debt',
      'subsidy',
    ],
  },
  {
    key: 'weather',
    terms: [
      'weather',
      'climate',
      'heatwave',
      'heat wave',
      'drought',
      'flood',
      'flooding',
      'rainfall',
      'snow',
      'storm',
      'temperature rise',
      'warming',
      'wildfire',
      'air quality',
      'air pollution',
      'smog',
      'particulate',
    ],
  },
  {
    key: 'transport',
    terms: [
      'car',
      'cars',
      'driving',
      'driver',
      'traffic',
      'commute',
      'commuting',
      'cycling',
      'bicycle',
      'pedestrian',
      'bus',
      'train',
      'rail',
      'road safety',
      'crash',
      'collision',
      'electric vehicle',
      'ev charging',
    ],
  },
  {
    key: 'water',
    terms: [
      'drinking water',
      'tap water',
      'groundwater',
      'river',
      'rivers',
      'lake',
      'water quality',
      'wastewater',
      'sewage',
      'irrigation',
    ],
  },
  {
    key: 'body',
    terms: [
      'exercise',
      'physical activity',
      'walking',
      'running',
      'fitness',
      'body weight',
      'weight loss',
      'muscle',
      'steps per day',
      'sedentary',
      'standing desk',
      'posture',
    ],
  },
  {
    key: 'work',
    terms: [
      'work',
      'workplace',
      'worker',
      'employee',
      'remote work',
      'working from home',
      'burnout',
      'productivity',
      'job',
      'jobs',
      'shift work',
      'automation of jobs',
    ],
  },
  {
    key: 'housing',
    terms: [
      'housing',
      'home',
      'homes',
      'apartment',
      'indoor air',
      'mould',
      'mold',
      'damp',
      'noise exposure',
      'neighbourhood',
      'neighborhood',
      'green space',
    ],
  },
  {
    key: 'family',
    terms: [
      'child',
      'children',
      'parent',
      'parents',
      'parenting',
      'baby',
      'babies',
      'pregnancy',
      'pregnant',
      'elderly',
      'older adults',
      'caregiver',
      'family',
      'families',
      'dog',
      'dogs',
      'cat',
      'cats',
      'pet',
      'pets',
    ],
  },
  {
    key: 'mind',
    terms: [
      'memory',
      'attention',
      'concentration',
      'focus',
      'stress',
      'mood',
      'happiness',
      'wellbeing',
      'well-being',
      'loneliness',
      'motivation',
      'decision making',
      'habit',
    ],
  },
  {
    key: 'ageing',
    terms: ['ageing', 'aging', 'longevity', 'lifespan', 'retirement', 'frailty', 'falls in older'],
  },
];

/** B.4: three domains is already maximally relatable; beyond that we would be rewarding keyword stuffing. */
export const EVERYDAY_DOMAIN_CAP = 3;
/** B.4: the secondary, finer-grained signal. */
export const EVERYDAY_TERM_CAP = 6;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Every separator a term may be written with. Abstracts spell the same compound
 * three ways — `ultra-processed`, `ultra processed`, `ultra‑processed` (U+2011)
 * — and the ASCII hyphen is the least common of the three in typeset text.
 */
const SEPARATOR = '[\\s\\u2010-\\u2015\\u2212-]+';

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Plural tolerance on the final word only.
 *
 * B.3.2's own worked example needs it: the title says "adolescent sleep", the
 * list says `adolescents`, and the example counts that as a hit. So a listed
 * term matches its singular, and a listed singular matches its plural.
 *
 * The stem is only stripped when what remains is still a word: `bus` must not
 * become `bu`, and `analysis` must not become `analysi`.
 */
function finalWordPattern(word: string): string {
  const strippable = word.length >= 5 && word.endsWith('s') && !/(?:ss|us|is)$/u.test(word);
  const stem = strippable ? word.slice(0, -1) : word;
  return `${escapeLiteral(stem)}(?:s|es)?`;
}

/** Compiles one term into the bounded, separator-tolerant form of A.0.1. */
export function compileTerm(term: string): RegExp {
  const words = term.split(/[\s\u2010-\u2015\u2212-]+/u).filter((w) => w !== '');
  if (words.length === 0) throw new Error(`empty lexicon term: ${JSON.stringify(term)}`);
  const last = words[words.length - 1] as string;
  const body = [...words.slice(0, -1).map(escapeLiteral), finalWordPattern(last)].join(SEPARATOR);
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L})`, 'u');
}

/**
 * Compiled patterns are memoised per list. There are ~700 terms and up to 300
 * candidates per run; recompiling per candidate would be 200 000 needless
 * `RegExp` constructions, and the lists never change at runtime.
 */
const compiledCache = new WeakMap<readonly string[], readonly (readonly [string, RegExp])[]>();

function compiled(terms: readonly string[]): readonly (readonly [string, RegExp])[] {
  const cached = compiledCache.get(terms);
  if (cached) return cached;
  const built = terms.map((term) => [term, compileTerm(term)] as const);
  compiledCache.set(terms, built);
  return built;
}

/** One matched lexicon term, and whether it was the *title* that matched it. */
export interface TermHit {
  readonly term: string;
  readonly inTitle: boolean;
}

/**
 * Distinct terms from `terms` occurring anywhere in `title` or `body`.
 *
 * Both arguments must already be lower-cased and whitespace-normalised — the
 * caller does that once per candidate rather than once per term.
 */
export function matchTerms(
  terms: readonly string[],
  title: string,
  body: string,
): readonly TermHit[] {
  const hits: TermHit[] = [];
  for (const [term, pattern] of compiled(terms)) {
    const inTitle = pattern.test(title);
    if (inTitle || pattern.test(body)) hits.push({ term, inTitle });
  }
  return hits;
}

/**
 * B.3: "Hits in the title count double (a concrete title is strong evidence)."
 *
 * Applied to every distinct-hit count in B.3 — the positive `v`/`s` counts of
 * B.3.1, whose arithmetic the worked example pins down, and the `t` penalty of
 * B.3.2, where the same reasoning holds in reverse: a title that announces
 * "We propose a framework" is stronger evidence of a methods paper than the
 * same phrase buried in an abstract. B.3.2 does not say so explicitly; see the
 * ambiguity note in the module header of `score.ts`.
 */
export function weightedHitCount(hits: readonly TermHit[]): number {
  return hits.reduce((total, hit) => total + (hit.inTitle ? 2 : 1), 0);
}
