/**
 * The source layer's front door (§10).
 *
 * Adding a source is a new file that exports an `AdapterRegistration` plus one
 * line in `DEFAULT_SOURCES`. Nothing downstream of here names a source: the
 * pipeline asks for "the adapters for today's category" and gets back one merged
 * candidate list plus whatever degraded (§9).
 *
 * The merge exists because arXiv and OpenAlex overlap. A preprint that has since
 * been published appears in both, and publishing it twice in one digest would be
 * a visible bug on the page.
 */
import type { Candidate, CategoryConfig, Degradation, SourceAdapter, SourceName } from '../types.js';
import { HttpError } from '../util/http.js';
import { stringsFor } from '../render/strings.js';
import type { StringTable } from '../render/stringTable.js';
import { arxivSource } from './arxiv.js';
import type { AdapterDeps, AdapterRegistration } from './deps.js';
import { openAlexSource } from './openalex.js';

/** Every source this project knows about. One line per source — that is §10. */
export const DEFAULT_SOURCES: readonly AdapterRegistration[] = [openAlexSource, arxivSource];

/**
 * `sources` is a parameter rather than a module constant so a test — or a later
 * market/industry phase — can prove a new source flows through end to end
 * without editing anything a consumer imports.
 */
export function adaptersForCategory(
  category: CategoryConfig,
  deps: AdapterDeps,
  sources: readonly AdapterRegistration[] = DEFAULT_SOURCES,
): SourceAdapter[] {
  return sources.filter((s) => s.appliesTo(category)).map((s) => s.create(deps));
}

export interface DiscoveryResult {
  candidates: Candidate[];
  /** §9 — a source that failed, in words the page footer can carry. */
  degradations: Degradation[];
}

/**
 * §9's footer sentence for a dead source, resolved from the one string table
 * rather than written here. The reader never learns which API fell over —
 * "OpenAlex" means nothing to the family reading this — only what they lost.
 */
function degradationMessage(source: SourceName, strings: StringTable): string {
  switch (source) {
    case 'openalex':
      return strings.degradationOpenAlex;
    case 'arxiv':
      return strings.degradationArxiv;
    default:
      return strings.degradationOpenAlex;
  }
}

/**
 * §4.1 makes the key mandatory. A run that keeps going on a rejected key would
 * publish a thinner page every morning and never say why, so an authentication
 * failure is not a degradation — it takes the run down (DESIGN-NOTES D.2).
 */
function isAuthFailure(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

/**
 * Runs every adapter for the day and merges the results.
 *
 * Sequential rather than parallel: two sources are not worth the concurrency,
 * and a serial loop keeps each source's failure attributable to that source.
 * §9 is the whole point of the try/catch — one dead API degrades the page, it
 * does not take the run down.
 */
export async function fetchCandidates(
  category: CategoryConfig,
  since: string,
  deps: AdapterDeps,
  sources: readonly AdapterRegistration[] = DEFAULT_SOURCES,
): Promise<DiscoveryResult> {
  const adapters = adaptersForCategory(category, deps, sources);
  const lists: Candidate[][] = [];
  const degradations: Degradation[] = [];

  for (const adapter of adapters) {
    try {
      lists.push(await adapter.fetch(category, since));
    } catch (error) {
      const detail = error instanceof HttpError ? error.message : (error as Error).message;
      deps.logger.error(`${adapter.name}: fetch failed — ${detail}`);
      if (isAuthFailure(error)) throw error;
      degradations.push({
        source: adapter.name,
        message: degradationMessage(adapter.name, stringsFor(deps.config.output.language)),
        detail,
      });
    }
  }

  return { candidates: mergeCandidates(lists), degradations };
}

// ---------------------------------------------------------------------------
// De-duplication across sources
// ---------------------------------------------------------------------------

/**
 * Titles are compared with punctuation, spacing, case and accents removed:
 * arXiv and OpenAlex disagree about LaTeX, hyphens and capitalisation on the
 * same paper often enough that an exact match would miss most duplicates.
 */
export function normaliseTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A type guard, so a "fill the gap" merge does not need a cast to satisfy
 * `exactOptionalPropertyTypes` when it copies an optional field across. */
function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function blank(value: string | null | undefined): boolean {
  return !present(value);
}

/** How much this record knows. Decides which of two duplicates leads the merge. */
function metadataScore(candidate: Candidate): number {
  let score = 0;
  if (!blank(candidate.abstract)) score++;
  if (!blank(candidate.doi)) score++;
  if (!blank(candidate.openAlexId)) score++;
  if (!blank(candidate.licence)) score++;
  if (!blank(candidate.venue)) score++;
  if (!blank(candidate.oaPdfUrl)) score++;
  if (candidate.subfield) score++;
  if (candidate.field) score++;
  if (candidate.topic) score++;
  if (candidate.citedByCount !== undefined) score++;
  if (candidate.referencedWorksCount !== undefined) score++;
  if ((candidate.authors?.length ?? 0) > 0) score++;
  return score;
}

/**
 * The richer record leads and the other one only fills its gaps, with two
 * exceptions that are deliberately not "prefer the richer record":
 *
 * `isPreprint` is OR-ed. If either source says this is a preprint, the page says
 * "zatím neprošlo recenzním řízením" (§4.3). Being told a peer-reviewed paper is
 * a preprint is a small cost; the reverse is a false claim about peer review.
 * The consequence is worth stating: a merged record can carry `source:
 * 'openalex'` and `isPreprint: true` at once, and the renderer must key that
 * sentence on the flag, never on the source name.
 *
 * `isRetracted` is OR-ed for the same reason — §6 excludes retracted work, and
 * a disagreement between sources must resolve towards excluding it.
 */
function mergeDuplicates(a: Candidate, b: Candidate): Candidate {
  const [preferred, other] = metadataScore(a) >= metadataScore(b) ? [a, b] : [b, a];
  const merged: Candidate = { ...preferred };

  if (blank(merged.abstract) && present(other.abstract)) merged.abstract = other.abstract;
  if (blank(merged.licence) && present(other.licence)) merged.licence = other.licence;
  if (blank(merged.doi) && present(other.doi)) merged.doi = other.doi;
  if (blank(merged.openAlexId) && present(other.openAlexId)) merged.openAlexId = other.openAlexId;
  if (blank(merged.oaPdfUrl) && present(other.oaPdfUrl)) merged.oaPdfUrl = other.oaPdfUrl;
  if (blank(merged.venue) && present(other.venue)) merged.venue = other.venue;
  if (blank(merged.indexedDate) && present(other.indexedDate)) merged.indexedDate = other.indexedDate;
  if (!merged.subfield && other.subfield) merged.subfield = other.subfield;
  if (!merged.field && other.field) merged.field = other.field;
  if (!merged.topic && other.topic) merged.topic = other.topic;
  const otherAuthors = other.authors ?? [];
  if ((merged.authors?.length ?? 0) === 0 && otherAuthors.length > 0) merged.authors = otherAuthors;
  if (merged.citedByCount === undefined && other.citedByCount !== undefined) {
    merged.citedByCount = other.citedByCount;
  }
  if (merged.referencedWorksCount === undefined && other.referencedWorksCount !== undefined) {
    merged.referencedWorksCount = other.referencedWorksCount;
  }
  if (merged.isOpenAccess !== true && other.isOpenAccess === true) merged.isOpenAccess = true;

  merged.isPreprint = (a.isPreprint ?? false) || (b.isPreprint ?? false);
  merged.isRetracted = (a.isRetracted ?? false) || (b.isRetracted ?? false);
  return merged;
}

/**
 * Merges several adapters' output into one list, collapsing the same paper seen
 * twice. DOI decides when both records have one — two different DOIs are two
 * different records however alike the titles look — and a normalised title
 * decides otherwise, which is the only key an arXiv-only preprint has.
 *
 * Order is the order sources were listed, first occurrence wins its position, so
 * the same inputs always produce the same output (RISK-SELECT-13).
 */
export function mergeCandidates(lists: readonly (readonly Candidate[])[]): Candidate[] {
  const merged: Candidate[] = [];
  const byDoi = new Map<string, number>();
  const byTitle = new Map<string, number>();

  for (const list of lists) {
    for (const candidate of list) {
      const titleKey = normaliseTitle(candidate.title);
      const doiKey = candidate.doi ?? null;

      let at = doiKey !== null ? byDoi.get(doiKey) : undefined;
      if (at === undefined && titleKey !== '') {
        const titleMatch = byTitle.get(titleKey);
        const existing = titleMatch === undefined ? undefined : merged[titleMatch];
        // Same title, two different DOIs: an erratum, a reprint or a coincidence
        // — not the same record. Only merge on title when at most one side has
        // a DOI to disagree with.
        if (existing && !(existing.doi && doiKey && existing.doi !== doiKey)) at = titleMatch;
      }

      if (at !== undefined) {
        const existing = merged[at];
        if (existing) {
          const combined = mergeDuplicates(existing, candidate);
          merged[at] = combined;
          // Index the keys this record contributed, so a third source matching
          // either spelling still lands on the same slot.
          if (combined.doi) byDoi.set(combined.doi, at);
          if (titleKey !== '' && !byTitle.has(titleKey)) byTitle.set(titleKey, at);
          continue;
        }
      }

      const index = merged.length;
      merged.push(candidate);
      if (doiKey !== null) byDoi.set(doiKey, index);
      if (titleKey !== '' && !byTitle.has(titleKey)) byTitle.set(titleKey, index);
    }
  }
  return merged;
}

/** Re-exported so a caller needs one import to build the source layer. */
export type { AdapterDeps, AdapterRegistration } from './deps.js';
