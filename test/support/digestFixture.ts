/**
 * Sample data for the renderer, archive and dedup tests.
 *
 * Everything is built from small option objects rather than hand-written
 * literals: a `DayDigest` carries four nested types and about forty fields, and
 * a test that spells all of them out stops saying which two fields it is about.
 * Each factory fills a plausible default and lets a test override only what it
 * is testing.
 */
import type {
  DayDigest,
  Degradation,
  DigestEntry,
  LanguageCheckResult,
  PaperSummary,
  ScoredCandidate,
  Shortfall,
  SourceName,
  VerificationOutcome,
} from '../../src/types.js';

export interface SummaryOptions {
  nadpis?: string;
  oCoJde?: string;
  podrobneVysvetleni?: string;
  prikladZeZivota?: string;
  prikladJeMotivace?: boolean;
  procJeToDulezite?: string;
  poznamkaKOmezenim?: string;
}

export function makeSummary(options: SummaryOptions = {}): PaperSummary {
  return {
    nadpis: options.nadpis ?? 'Krátký spánek zhoršuje pozornost řidičů',
    oCoJde:
      options.oCoJde ??
      'Vědci sledovali, jak se řidiči chovají po krátké noci. Zjistili, že déle reagují na náhlé překážky.',
    podrobneVysvetleni:
      options.podrobneVysvetleni ??
      'Do studie se přihlásilo dvě stě řidičů, kteří jezdili na trenažéru. Polovina z nich spala jen pět hodin.',
    prikladZeZivota:
      options.prikladZeZivota ?? 'Na trenažéru měli řidiči zabrzdit, když jim do cesty vběhlo dítě.',
    prikladTyp: 'ze-studie',
    prikladJeMotivace: options.prikladJeMotivace ?? false,
    procJeToDulezite:
      options.procJeToDulezite ?? 'Krátký spánek před cestou zvyšuje riziko nehody.',
    poznamkaKOmezenim:
      options.poznamkaKOmezenim ?? 'Šlo o jízdu na trenažéru, ne o skutečný provoz.',
  };
}

export interface CandidateOptions {
  index?: number;
  id?: string;
  title?: string;
  date?: string;
  url?: string;
  source?: SourceName;
  doi?: string | null;
  openAlexId?: string | null;
  oaPdfUrl?: string | null;
  venue?: string | null;
  authors?: string[];
  isPreprint?: boolean;
  subfieldId?: string;
  score?: number;
}

export function makeCandidate(options: CandidateOptions = {}): ScoredCandidate {
  const index = options.index ?? 1;
  const source = options.source ?? 'openalex';
  return {
    id: options.id ?? `${source}:W${1000 + index}`,
    title: options.title ?? `Sleep restriction and reaction time, study ${index}`,
    abstract: 'Two hundred drivers completed a simulated drive after restricted sleep.',
    date: options.date ?? '2026-08-17',
    url: options.url ?? `https://example.org/paper/${index}`,
    licence: 'cc-by',
    source,
    doi: options.doi === undefined ? `10.1234/example.${index}` : options.doi,
    openAlexId: options.openAlexId === undefined ? `W${1000 + index}` : options.openAlexId,
    subfield: { id: options.subfieldId ?? 'subfields/3206', name: 'Neuropsychology' },
    field: { id: 'fields/32', name: 'Psychology' },
    citedByCount: 3,
    isOpenAccess: true,
    oaPdfUrl: options.oaPdfUrl === undefined ? `https://example.org/pdf/${index}.pdf` : options.oaPdfUrl,
    isPreprint: options.isPreprint ?? false,
    isRetracted: false,
    authors: options.authors ?? ['Jana Nováková', 'Petr Svoboda'],
    venue: options.venue === undefined ? 'Journal of Sleep Research' : options.venue,
    tldr: 'Short sleep slows drivers down.',
    abstractSource: 'source',
    score: {
      explainability: 0.8,
      everydayRelevance: 0.7,
      freshness: 0.9,
      credibility: 0.6,
      total: options.score ?? 0.76,
      evidence: ['concrete everyday effect', 'published two days ago'],
      explainDetail: { v: 0.8, s: 0.7, q: 1, c: 0.6, t: 0.1, j: 0.2 },
      everydayDomains: ['sleep', 'transport'],
      subfieldKey: options.subfieldId ?? 'subfields/3206',
    },
  };
}

export function makeVerification(): VerificationOutcome {
  return { verdict: 'supported', attempts: 1, rejections: [], resolution: 'accepted' };
}

export function makeChecks(): LanguageCheckResult {
  return { ok: true, status: 'pass', hard: [], soft: [] };
}

export interface EntryOptions {
  candidate?: CandidateOptions;
  summary?: SummaryOptions;
}

export function makeEntry(options: EntryOptions = {}): DigestEntry {
  return {
    candidate: makeCandidate(options.candidate ?? {}),
    summary: makeSummary(options.summary ?? {}),
    verification: makeVerification(),
    checks: makeChecks(),
  };
}

export interface DigestOptions {
  date?: string;
  categoryKey?: string;
  categoryLabel?: string;
  language?: string;
  entries?: DigestEntry[];
  /** Ignored when `entries` is given. */
  entryCount?: number;
  shortfall?: Shortfall | null;
  degradations?: Degradation[];
  generatedAt?: string;
  generatedOn?: string;
}

export function makeDigest(options: DigestOptions = {}): DayDigest {
  const date = options.date ?? '2026-08-19';
  const entries =
    options.entries ??
    Array.from({ length: options.entryCount ?? 5 }, (_, i) =>
      makeEntry({
        candidate: { index: i + 1 },
        summary: { nadpis: `Plain-language title ${i + 1}` },
      }),
    );
  return {
    date,
    categoryKey: options.categoryKey ?? 'psychology-behaviour',
    categoryLabel: options.categoryLabel ?? 'Psychologie a chování',
    language: options.language ?? 'cs',
    entries,
    shortfall: options.shortfall ?? null,
    degradations: options.degradations ?? [],
    generatedAt: options.generatedAt ?? `${date}T04:12:00.000Z`,
    generatedOn: options.generatedOn ?? date,
    schemaVersion: 1,
  };
}

export function makeDegradation(
  source: Degradation['source'],
  detail = 'HTTP 503 after 2 retries',
): Degradation {
  return { source, message: 'Zdroj neodpovídal.', detail };
}
