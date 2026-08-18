/**
 * Semantic Scholar — the plain-language seed (§4.2).
 *
 * Three rules from the spec drive everything here.
 *
 * One request per second, sequential. The `Throttle` is taken before every
 * request and there is no `Promise.all` anywhere in this file on purpose: a fan
 * out would get the whole run rate-limited, and the shortlist is small enough
 * that 20 × 1.1 s is a cheap price for never being throttled.
 *
 * Only the shortlist is enriched. Anything past `shortlist.size` comes back
 * untouched rather than queued, so a candidate list that grows never turns into
 * a five-minute run.
 *
 * A missing `tldr` is not a reason to drop a paper (§4.2, last line). Neither is
 * a 404 or a rate limit (§9) — this returns candidates in every path and reports
 * what went wrong instead of throwing.
 */
import { z } from 'zod';
import type { AdapterDeps } from '../adapters/deps.js';
import { httpPolicy, requestOptions } from '../adapters/deps.js';
import type { Candidate, Degradation, EnrichedCandidate } from '../types.js';
import { fetchJson, HttpError } from '../util/http.js';
import { Throttle } from '../util/throttle.js';
import { stringsFor } from '../render/strings.js';

const FIELDS =
  'paperId,title,abstract,tldr,externalIds,openAccessPdf,publicationDate,venue,isOpenAccess';

const PaperSchema = z.object({
  paperId: z.string().nullish(),
  title: z.string().nullish(),
  abstract: z.string().nullish(),
  tldr: z.object({ text: z.string().nullish() }).nullish(),
  externalIds: z.object({ DOI: z.string().nullish(), ArXiv: z.string().nullish() }).nullish(),
  openAccessPdf: z.object({ url: z.string().nullish() }).nullish(),
  publicationDate: z.string().nullish(),
  venue: z.string().nullish(),
  isOpenAccess: z.boolean().nullish(),
});

/**
 * The adapter dependency bundle plus a clock. The clock is injected so the
 * throttle can be *proven* in a test — 20 lookups must span ≥ 19 × 1.1 s — with
 * simulated time instead of 22 real seconds in the suite.
 */
export interface EnrichDeps extends AdapterDeps {
  readonly clock?:
    | { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> }
    | undefined;
}

export interface EnrichmentResult {
  enriched: EnrichedCandidate[];
  /** §9 — set when enrichment stopped early. The caller puts it in the footer. */
  degradation: Degradation | null;
}

/** What S2 can be asked about: a DOI, or an arXiv id for a preprint. */
export function lookupKey(candidate: Candidate): string | null {
  if (candidate.doi && candidate.doi.trim() !== '') return `DOI:${candidate.doi.trim()}`;
  if (candidate.id.startsWith('arxiv:')) {
    const id = candidate.id.slice('arxiv:'.length).trim();
    if (id !== '') return `arXiv:${id}`;
  }
  return null;
}

/**
 * S2 takes the id in the path, and DOIs contain slashes and colons that it wants
 * left alone — verified live. Everything else is percent-encoded so a DOI with a
 * space or a `#` cannot forge a path segment or a query string.
 */
function encodeId(key: string): string {
  return encodeURIComponent(key).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}

export function paperUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/paper/${encodeId(key)}?fields=${FIELDS}`;
}

function unenriched(candidate: Candidate, note?: string): EnrichedCandidate {
  return {
    ...candidate,
    tldr: null,
    abstractSource: candidate.abstract ? 'source' : 'none',
    ...(note === undefined ? {} : { enrichmentNote: note }),
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * §9: "Semantic Scholar rate limited: fall back to abstracts, do not fail the
 * run." A 429 that survived the retries means the quota is gone for now, so the
 * remaining lookups are abandoned rather than attempted one by one — every one
 * of them would fail the same way, 1.1 s apart. Network and 5xx failures are
 * treated the same: the service is not answering, so stop asking.
 */
function isFatalForEnrichment(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

export async function enrichWithTldr(
  candidates: readonly Candidate[],
  deps: EnrichDeps,
): Promise<EnrichmentResult> {
  const settings = deps.config.sources.semanticScholar;
  const limit = deps.config.shortlist.size;
  const clock = deps.clock;
  const throttle = clock
    ? new Throttle(settings.throttleMs, clock.now, clock.sleep)
    : new Throttle(settings.throttleMs);

  const key = deps.secrets.semanticScholarApiKey;
  const headers = key ? { 'x-api-key': key } : {};

  const enriched: EnrichedCandidate[] = [];
  let degradation: Degradation | null = null;

  if (candidates.length > limit) {
    deps.logger.warn(
      `Semantic Scholar: ${candidates.length} candidates offered, enriching the first ${limit} (§4.2)`,
    );
  }

  for (const [position, candidate] of candidates.entries()) {
    if (position >= limit) {
      enriched.push(unenriched(candidate, `beyond the shortlist of ${limit}, not enriched (§4.2)`));
      continue;
    }
    if (degradation) {
      enriched.push(unenriched(candidate, 'enrichment stopped earlier this run (§9)'));
      continue;
    }

    const id = lookupKey(candidate);
    if (!id) {
      enriched.push(unenriched(candidate, 'no DOI and no arXiv id to look up'));
      continue;
    }

    const url = paperUrl(settings.baseUrl, id);
    await throttle.take();

    let raw: unknown;
    try {
      raw = await fetchJson<unknown>(url, httpPolicy(deps.config), requestOptions(deps, headers));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (error.status === 404) {
        // Normal, not a failure: S2 simply does not have this paper (§4.2).
        enriched.push(unenriched(candidate, `not known to Semantic Scholar (${id})`));
        continue;
      }
      if (isFatalForEnrichment(error.status)) {
        degradation = {
          source: 'semantic-scholar',
          // Resolved from the one string table rather than written here: every
          // word a reader sees lives in a single reviewable file, and the
          // footer says what the reader lost, not which API failed.
          message: stringsFor(deps.config.output.language).degradationSemanticScholar,
          detail: error.message,
        };
        deps.logger.warn(`Semantic Scholar: stopping enrichment — ${error.message}`);
        enriched.push(unenriched(candidate, 'Semantic Scholar unavailable (§9)'));
        continue;
      }
      enriched.push(unenriched(candidate, `Semantic Scholar returned HTTP ${String(error.status)}`));
      continue;
    }

    const parsed = PaperSchema.safeParse(raw);
    if (!parsed.success) {
      enriched.push(unenriched(candidate, 'Semantic Scholar returned an unrecognised record'));
      continue;
    }
    enriched.push(applyPaper(candidate, parsed.data));
  }

  return { enriched, degradation };
}

/**
 * Merges one S2 record into a candidate. S2 only ever fills gaps: the discovery
 * source decided what this paper is, and its own abstract wins over S2's copy so
 * the §11-step-8 verifier checks the example against the text the summariser
 * actually read.
 */
export function applyPaper(candidate: Candidate, paper: z.infer<typeof PaperSchema>): EnrichedCandidate {
  const tldr = nonEmpty(paper.tldr?.text);
  const ownAbstract = nonEmpty(candidate.abstract);
  const s2Abstract = nonEmpty(paper.abstract);
  const abstract = ownAbstract ?? s2Abstract;

  const abstractSource: EnrichedCandidate['abstractSource'] = ownAbstract
    ? 'source'
    : s2Abstract
      ? 'semantic-scholar'
      : 'none';

  const note =
    tldr === null
      ? abstract === null
        ? 'no tldr and no abstract anywhere'
        : `no tldr; falling back to the ${abstractSource === 'source' ? 'source' : 'Semantic Scholar'} abstract (§4.2)`
      : undefined;

  // §7.6 renders the DOI, the venue and the OA PDF link. S2 fills in whichever
  // of them the discovery source did not have, and overwrites none of them.
  const gaps: Partial<Candidate> = {};
  const s2Doi = nonEmpty(paper.externalIds?.DOI);
  const s2Pdf = nonEmpty(paper.openAccessPdf?.url);
  const s2Venue = nonEmpty(paper.venue);
  if (!nonEmpty(candidate.doi) && s2Doi) gaps.doi = s2Doi.toLowerCase();
  if (!nonEmpty(candidate.oaPdfUrl) && s2Pdf) gaps.oaPdfUrl = s2Pdf;
  if (!nonEmpty(candidate.venue) && s2Venue) gaps.venue = s2Venue;
  if (candidate.isOpenAccess !== true && paper.isOpenAccess === true) gaps.isOpenAccess = true;

  return {
    ...candidate,
    ...gaps,
    abstract,
    tldr,
    abstractSource,
    ...(note === undefined ? {} : { enrichmentNote: note }),
  };
}
