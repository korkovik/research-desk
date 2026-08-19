/**
 * Candidate factory for the §6 selection tests.
 *
 * Hand-written literals were the alternative and they hide the thing under
 * test: a scenario that says "8 papers in subfield A, 2 in B" should read that
 * way in the test, not as 200 lines of abstracts. Every default here is chosen
 * to be *unremarkable* — fresh, peer-reviewed, open access, an abstract long
 * enough to pass B.1 rule 3 — so that a test only has to state its one
 * deviation and the reader knows everything else is neutral.
 */
import { loadConfig, type Config } from '../../src/config.js';
import type { SeenLookup, SeenMatchKind } from '../../src/select/exclude.js';
import {
  candidateIdentity,
  isWithinDedupWindow,
  normaliseArxivId,
  normaliseDoi,
  normaliseOpenAlexId,
  titleKey,
  TITLE_SIMILARITY_THRESHOLD,
  trigramJaccard,
} from '../../src/select/identity.js';
import type { SelectOptions } from '../../src/select/select.js';
import { optionsFromConfig } from '../../src/select/select.js';
import type { EnrichedCandidate } from '../../src/types.js';
import { shiftISODate } from '../../src/util/dates.js';

/** Frozen run date. Every test date is expressed relative to this. */
export const TEST_TODAY = '2026-08-19';

export const REPO_ROOT = new URL('../../', import.meta.url).pathname;

/** The project's real `config.json`, so the tests exercise the shipped knobs. */
export function testConfig(): Config {
  return loadConfig(REPO_ROOT);
}

/**
 * The neutral default abstract: >400 characters, states an `n`, names a
 * percentage, and contains no B.3.2 theoretical marker and no word long enough
 * to move the jargon-density penalty.
 */
export const DEFAULT_ABSTRACT =
  'We studied whether free school breakfasts change how often children come to class. ' +
  'Over one school year we followed 1240 pupils in 40 schools and compared attendance ' +
  'before and after the meals were offered. Attendance increased by 12 % in the schools ' +
  'that offered breakfast, and the effect was largest among pupils from low income homes. ' +
  'Teachers also reported fewer late arrivals. The study was observational, so we cannot ' +
  'rule out other causes, but the pattern held across every school in the sample (n = 1240).';

export const DEFAULT_TITLE = 'Free school breakfasts increased attendance among students in 40 schools';

/**
 * A paper that is explainable (concrete verb, recognisable subjects, a number)
 * but touches only one everyday domain, so it ranks well below the default.
 * Used wherever a test needs a *lower*-scoring but still eligible candidate.
 */
export const MODEST_TITLE = 'Wheat plants reduced salt uptake in saltier soil';
export const MODEST_ABSTRACT =
  'We grew wheat plants in soil with three levels of salt and measured how much salt reached ' +
  'the grain. Plants given a single dose of a common mineral additive took up 18 % less salt ' +
  'than untreated plants, and their roots stayed longer. The effect was the same in all three ' +
  'levels of salt, and it did not change the size of the grain. We repeated the whole ' +
  'experiment twice with the same seed batch and saw the same pattern both times.';

/** A candidate scoring below the everyday-relevance ceiling but above the gate. */
export function makeModestCandidate(spec: CandidateSpec = {}): EnrichedCandidate {
  return makeCandidate({ title: MODEST_TITLE, abstract: MODEST_ABSTRACT, ...spec });
}

/**
 * B.2's whole reason for existing: a paper that scores well on everyday
 * relevance, freshness and credibility — which together outweigh explainability
 * 0.60 to 0.40 — while being close to unexplainable. Methods-about-methods
 * title, a taxonomy subtitle, theoretical markers, no concrete outcome.
 */
export const METHODS_TITLE = 'A framework for modelling domestic energy demand: a taxonomy of estimators';
export const METHODS_ABSTRACT =
  'This paper sets out a way to compare estimators of domestic energy demand. We derive the ' +
  'asymptotic behaviour of three common estimators and give the convergence rate of each. ' +
  'The data covers 20000 homes (n = 20000) with hourly electricity and heating readings, ' +
  'together with the cost of each bill and the prices paid per unit. Housing stock varies ' +
  'across the sample. We report which estimator has the smallest error under each assumption ' +
  'about missing readings.';

/** A high-total, sub-gate candidate. */
export function makeUngatedCandidate(spec: CandidateSpec = {}): EnrichedCandidate {
  return makeCandidate({
    title: METHODS_TITLE,
    abstract: METHODS_ABSTRACT,
    ageDays: 0,
    ...spec,
  });
}

export interface CandidateSpec extends Partial<EnrichedCandidate> {
  /** Days before `TEST_TODAY`. Sets `date` and `indexedDate` together. */
  ageDays?: number;
  /** Shorthand for `subfield: { id, name: id }`. */
  subfieldId?: string;
  /**
   * Keeps `title` exactly as given, without the uniquifying tag. For the tests
   * that are ABOUT titles — dedup against `seen.json`, near-duplicate matching —
   * where the tag would be the thing under test rather than scaffolding.
   */
  verbatimTitle?: boolean;
}

let sequence = 0;

/**
 * A tag that makes two generated titles genuinely different papers.
 *
 * The obvious approach — one fixed word plus a serial — does not work: title
 * similarity is trigram Jaccard, and two titles differing only in four digits
 * still score above the 0.90 threshold, so every candidate collapsed into one.
 * Each digit is mapped to a distinct syllable instead, so consecutive serials
 * share almost no trigrams. The syllables carry none of the concrete-outcome
 * verbs or subject nouns the explainability score reads, so scores are unmoved.
 */
const SYLLABLES = ['zoxq', 'kirv', 'vumj', 'peld', 'gawb', 'tynf', 'qufh', 'hibz', 'mosk', 'redw'];

function uniqueTag(n: number): string {
  // Scrambled before encoding: consecutive serials would otherwise differ in a
  // single digit, hence a single syllable, and against a 70-character title
  // that still leaves the two above the 0.90 similarity threshold.
  const scrambled = String(((n * 7919) % 10000) + 10000).slice(1);
  return scrambled
    .split('')
    .map((digit) => SYLLABLES[Number(digit)] ?? 'zzzz')
    .join('');
}

/** Resets the id counter so a test's ids are predictable. Call it in `beforeEach`. */
export function resetCandidateSequence(): void {
  sequence = 0;
}

export function makeCandidate(spec: CandidateSpec = {}): EnrichedCandidate {
  const { ageDays, subfieldId, title: titleOverride, verbatimTitle, ...overrides } = spec;
  sequence += 1;
  const serial = String(1000 + sequence);
  const date = shiftISODate(TEST_TODAY, -(ageDays ?? 1));

  const base: EnrichedCandidate = {
    id: `openalex:W${serial}`,
    // Distinct per candidate, because the selector now collapses two records in
    // one day's pool that are the same paper (trigram Jaccard >= 0.90 on the
    // title). A factory that minted the same title every time was handing every
    // test five copies of one study, which is not what a real pool looks like.
    // The suffix is deliberately meaningless: it carries none of the
    // concrete-outcome verbs or subject nouns the explainability score reads,
    // so scores are unchanged, and it is long enough to drop the similarity
    // well below the threshold.
    title:
      verbatimTitle === true && titleOverride !== undefined
        ? titleOverride
        : `${titleOverride ?? DEFAULT_TITLE} [${uniqueTag(sequence)}]`,
    abstract: DEFAULT_ABSTRACT,
    date,
    url: `https://example.org/works/${serial}`,
    licence: 'cc-by',
    source: 'openalex',
    doi: `10.1234/test.${serial}`,
    openAlexId: `W${serial}`,
    subfield: { id: subfieldId ?? 'subfields/3206', name: subfieldId ?? 'Test Subfield' },
    field: { id: 'fields/32', name: 'Psychology' },
    topic: { id: 'T10001', name: 'Test Topic' },
    citedByCount: 0,
    isOpenAccess: true,
    oaPdfUrl: null,
    isPreprint: false,
    sourceType: 'article',
    isRetracted: false,
    authors: ['A. Novak', 'B. Svoboda'],
    venue: 'Journal of Test Studies',
    indexedDate: date,
    referencedWorksCount: 30,
    tldr: null,
    abstractSource: 'source',
  };

  return { ...base, ...overrides };
}

/** `n` candidates, all in `subfieldId`, ranked by age: index 0 is the freshest. */
export function makeSubfieldRun(
  subfieldId: string,
  count: number,
  startAgeDays = 0,
): EnrichedCandidate[] {
  const made: EnrichedCandidate[] = [];
  for (let i = 0; i < count; i++) {
    made.push(makeCandidate({ subfieldId, ageDays: startAgeDays + i }));
  }
  return made;
}

// ---------------------------------------------------------------------------
// Dedup stub — `src/state/seen.ts` is another module's responsibility
// ---------------------------------------------------------------------------

/** One `state/seen.json` row, as B.7 shapes it. */
export interface SeenEntryStub {
  openalexId?: string;
  doi?: string;
  arxivId?: string;
  /** Either a raw title (keyed here) or a pre-computed `titleKey`. */
  title?: string;
  titleKey?: string;
  publishedOn: string;
}

/**
 * A stand-in for the real dedup lookup, built from the same pure helpers
 * `src/state/seen.ts` will use. It is a stub for the *storage*, not for the
 * matching rules — matching those in a test double would prove nothing.
 */
export function stubSeenLookup(
  entries: readonly SeenEntryStub[],
  today: string = TEST_TODAY,
  dedupDays = 180,
): SeenLookup {
  return (candidate): SeenMatchKind | null => {
    const identity = candidateIdentity(candidate);
    for (const entry of entries) {
      if (!isWithinDedupWindow(entry.publishedOn, today, dedupDays)) continue;
      if (identity.openAlexId !== null && normaliseOpenAlexId(entry.openalexId) === identity.openAlexId) {
        return 'openalex-id';
      }
      if (identity.doi !== null && normaliseDoi(entry.doi) === identity.doi) return 'doi';
      if (identity.arxivId !== null && normaliseArxivId(entry.arxivId) === identity.arxivId) {
        return 'arxiv-id';
      }
      const key = entry.titleKey ?? (entry.title === undefined ? null : titleKey(entry.title));
      if (key !== null && trigramJaccard(key, identity.titleKey) >= TITLE_SIMILARITY_THRESHOLD) {
        return 'title';
      }
    }
    return null;
  };
}

/** The negative control: nothing has ever been published. */
export const neverSeen: SeenLookup = () => null;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** `selectForDay` options from the real config, with per-test overrides. */
export function selectOptions(overrides: Partial<SelectOptions> = {}): SelectOptions {
  return { ...optionsFromConfig(testConfig(), TEST_TODAY, neverSeen), ...overrides };
}
