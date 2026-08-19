/**
 * OpenAlex — the discovery backbone (§4.1).
 *
 * Two decisions here are worth knowing before reading the code.
 *
 * The key travels in an `Authorization: Bearer` header and never in the query
 * string: OpenAlex logs and echoes the request URL back inside `meta.x_query`,
 * and this project writes URLs into a run log that a human reads.
 *
 * The adapter normalises but does not judge. §6's hard exclusions (retracted, no
 * abstract) are the selector's job, so a retracted work that slips past the
 * server-side filter comes back flagged rather than dropped — `types.ts` fixes
 * that division of labour. The only records dropped here are the ones that
 * cannot satisfy §10's seven-field contract at all.
 */
import { z } from 'zod';
import type { Candidate, CategoryConfig, SourceAdapter, TopicRef } from '../types.js';
import { isISODate, localDateISO } from '../util/dates.js';
import { fetchJson, HttpError } from '../util/http.js';
import { nowOf, type AdapterDeps, type AdapterRegistration } from './deps.js';
import { httpPolicy, requestOptions } from './deps.js';

const OPENALEX_URL_PREFIX = 'https://openalex.org/';
const DOI_URL_PREFIX = 'https://doi.org/';

/**
 * Filter terms that are the same on every run, so they live next to the code
 * that explains them rather than in `config.json`:
 *  - `type:article` — §6 prefers peer-reviewed work, and the AI day gets its
 *    preprints from arXiv (§4.3) rather than from OpenAlex.
 *  - `language:en` — the *source* language, unrelated to `output.language`. The
 *    summariser reads English abstracts and writes Czech (§2).
 *  - `has_abstract` / `is_retracted` — §6 hard exclusions, applied server-side
 *    so the 100-credit unkeyed allowance is not spent on records we would throw
 *    away. The selector re-checks them; this is the belt, not the braces.
 */
const CONSTANT_FILTERS = [
  'has_abstract:true',
  'is_retracted:false',
  'language:en',
  'type:article',
] as const;

/** Everything the ranker and §7.6's reference block need, and nothing else. */
const SELECT_FIELDS = [
  'id',
  'doi',
  'title',
  'display_name',
  'publication_date',
  'type',
  'primary_topic',
  'open_access',
  'best_oa_location',
  'primary_location',
  'cited_by_count',
  'authorships',
  'is_retracted',
  'abstract_inverted_index',
  'referenced_works_count',
  'created_date',
].join(',');

// ---------------------------------------------------------------------------
// Response shape. Lenient on purpose: OpenAlex adds fields freely and nulls
// anything it does not know, so every field is optional and a single unparsable
// work is skipped instead of failing the page (§9).
// ---------------------------------------------------------------------------

const TopicNode = z
  .object({ id: z.string().nullish(), display_name: z.string().nullish() })
  .nullish();

const WorkSchema = z.object({
  id: z.string().nullish(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  display_name: z.string().nullish(),
  publication_date: z.string().nullish(),
  type: z.string().nullish(),
  primary_topic: z
    .object({
      id: z.string().nullish(),
      display_name: z.string().nullish(),
      subfield: TopicNode,
      field: TopicNode,
    })
    .nullish(),
  open_access: z.object({ is_oa: z.boolean().nullish(), oa_url: z.string().nullish() }).nullish(),
  best_oa_location: z.object({ pdf_url: z.string().nullish() }).nullish(),
  primary_location: z
    .object({
      landing_page_url: z.string().nullish(),
      license: z.string().nullish(),
      source: z.object({ display_name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  cited_by_count: z.number().nullish(),
  authorships: z
    .array(z.object({ author: z.object({ display_name: z.string().nullish() }).nullish() }))
    .nullish(),
  is_retracted: z.boolean().nullish(),
  // word -> every position it occupies. Positions are 0-based and may repeat.
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullish(),
  referenced_works_count: z.number().nullish(),
  created_date: z.string().nullish(),
});

export type OpenAlexWork = z.infer<typeof WorkSchema>;

const PageSchema = z.object({
  meta: z.object({ count: z.number().nullish(), page: z.number().nullish() }).nullish(),
  results: z.array(z.unknown()).nullish(),
});

// ---------------------------------------------------------------------------
// Abstract reconstruction
// ---------------------------------------------------------------------------

/**
 * OpenAlex ships abstracts as an inverted index (§4.1) — publishers allow the
 * word→positions map where they would not allow the running text.
 *
 * Two things real data does that a naive `array[position] = word` gets wrong:
 * positions can be sparse (a gap where a word was withheld), and two words can
 * claim the same position. A Map keyed by position handles the first without
 * allocating an array as large as the biggest index, and first-writer-wins makes
 * the second deterministic rather than dependent on key order luck.
 */
export function reconstructAbstract(
  index: Record<string, number[] | undefined> | null | undefined,
): string | null {
  if (!index) return null;
  const byPosition = new Map<number, string>();
  for (const [word, positions] of Object.entries(index)) {
    if (!positions) continue;
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0) continue;
      if (!byPosition.has(position)) byPosition.set(position, word);
    }
  }
  if (byPosition.size === 0) return null;
  const text = [...byPosition.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function bareOpenAlexId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.startsWith(OPENALEX_URL_PREFIX) ? id.slice(OPENALEX_URL_PREFIX.length) : id;
}

/**
 * OpenAlex reports the DOI as a resolver URL; §7.6 and the dedup state want the
 * bare form. Lower-cased because DOIs are case-insensitive and `seen.json` needs
 * two spellings of the same paper to collide.
 */
export function bareDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const trimmed = doi.trim();
  if (trimmed === '') return null;
  const withoutPrefix = trimmed.toLowerCase().startsWith(DOI_URL_PREFIX)
    ? trimmed.slice(DOI_URL_PREFIX.length)
    : trimmed;
  return withoutPrefix.toLowerCase();
}

function topicRef(
  node: { id?: string | null | undefined; display_name?: string | null | undefined } | null | undefined,
): TopicRef | null {
  const id = bareOpenAlexId(node?.id);
  const name = node?.display_name ?? null;
  if (!id || !name) return null;
  return { id, name };
}

/** `null` when the record cannot satisfy §10's contract; the caller logs it. */
export function workToCandidate(raw: unknown): Candidate | null {
  const parsed = WorkSchema.safeParse(raw);
  if (!parsed.success) return null;
  const work = parsed.data;

  const openAlexId = bareOpenAlexId(work.id);
  const title = (work.title ?? work.display_name ?? '').trim();
  const date = work.publication_date ?? '';
  if (!openAlexId || title === '' || !isISODate(date)) return null;

  const doi = bareDoi(work.doi);
  // §10 wants the page a human reads. The publisher landing page is that page;
  // the DOI resolver is the same destination one redirect earlier, and the
  // OpenAlex record is the last resort — never a PDF.
  const url =
    work.primary_location?.landing_page_url ??
    (doi ? `${DOI_URL_PREFIX}${doi}` : null) ??
    `${OPENALEX_URL_PREFIX}${openAlexId}`;

  const authors = (work.authorships ?? [])
    .map((a) => a.author?.display_name ?? null)
    .filter((name): name is string => name !== null && name.trim() !== '');

  return {
    id: `openalex:${openAlexId}`,
    title,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    date,
    url,
    licence: work.primary_location?.license ?? null,
    source: 'openalex',
    doi,
    openAlexId,
    subfield: topicRef(work.primary_topic?.subfield),
    field: topicRef(work.primary_topic?.field),
    topic: topicRef(work.primary_topic),
    citedByCount: work.cited_by_count ?? 0,
    isOpenAccess: work.open_access?.is_oa ?? false,
    oaPdfUrl: work.best_oa_location?.pdf_url ?? null,
    isPreprint: work.type === 'preprint',
    // Verbatim, because `isPreprint` is two-state and §6 needs to tell an
    // article from an editorial or an erratum.
    sourceType: work.type ?? null,
    isRetracted: work.is_retracted ?? false,
    authors,
    venue: work.primary_location?.source?.display_name ?? null,
    // `created_date` is when OpenAlex indexed the work — §6 factor 3's fallback
    // when `publication_date` is an issue date months behind the real one.
    indexedDate: work.created_date ? work.created_date.slice(0, 10) : null,
    referencedWorksCount: work.referenced_works_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function buildWorksUrl(
  deps: AdapterDeps,
  category: CategoryConfig,
  since: string,
  page: number,
  until: string,
): string {
  const settings = deps.config.sources.openalex;
  // `|` is OR inside one filter term, `,` is AND between terms (§4.1).
  //
  // The window is bounded at BOTH ends. `from_publication_date` alone lets
  // through records whose publication date is in the future — a live probe of
  // the Computer Science field returned works dated 2030-01-01 and 2050-02-21,
  // which are metadata errors rather than papers, and which the freshness
  // factor would otherwise score as the newest work of the week.
  const filter = [
    `primary_topic.field.id:${category.openalex.fieldIds.join('|')}`,
    `from_publication_date:${since}`,
    `to_publication_date:${until}`,
    ...CONSTANT_FILTERS,
  ].join(',');

  const params = new URLSearchParams({
    filter,
    'per-page': String(settings.perPage),
    page: String(page),
    sort: 'publication_date:desc',
    select: SELECT_FIELDS,
    // The polite-pool convention. Not a credential — the key is a header.
    mailto: settings.mailto,
  });
  return `${settings.baseUrl.replace(/\/$/, '')}/works?${params.toString()}`;
}

/**
 * §4.1: the key is mandatory in practice. Without one OpenAlex still answers on
 * the 100-credits/day allowance, which is enough to smoke-test and not enough to
 * run daily — so an unkeyed run is loud in the log, and `requireApiKey` turns it
 * into a hard failure for the unattended 06:00 job.
 */
function authHeaders(deps: AdapterDeps): Record<string, string> {
  const key = deps.secrets.openAlexApiKey;
  if (key) return { Authorization: `Bearer ${key}` };
  if (deps.config.sources.openalex.requireApiKey) {
    // Thrown as a 401 rather than a plain Error on purpose. The registry
    // catches everything an adapter throws and turns it into a degradation —
    // which would make `requireApiKey: true` do the silent thing it exists to
    // prevent (A5). Only auth failures are re-thrown, so this is how a missing
    // key takes the run down instead of quietly shrinking the page.
    throw new HttpError(
      'OPENALEX_API_KEY is not set and sources.openalex.requireApiKey is true (§4.1)',
      401,
      deps.config.sources.openalex.baseUrl,
    );
  }
  deps.logger.warn(
    'OpenAlex: no OPENALEX_API_KEY — running on the unkeyed 100 credits/day allowance (§4.1)',
  );
  return {};
}

export function createOpenAlexAdapter(deps: AdapterDeps): SourceAdapter {
  return {
    name: 'openalex',
    async fetch(category: CategoryConfig, since: string): Promise<Candidate[]> {
      const settings = deps.config.sources.openalex;
      const headers = authHeaders(deps);
      const candidates: Candidate[] = [];
      let skipped = 0;
      // The window's upper bound is the run's own day in the configured
      // timezone, so a record dated in the future never counts as this week's.
      const until = localDateISO(nowOf(deps), deps.config.output.timezone);

      for (let page = 1; page <= settings.maxPages; page++) {
        const url = buildWorksUrl(deps, category, since, page, until);
        const body = await fetchJson<unknown>(url, httpPolicy(deps.config), requestOptions(deps, headers));
        const parsed = PageSchema.safeParse(body);
        if (!parsed.success) {
          deps.logger.warn(`OpenAlex: page ${page} was not a works list, stopping`);
          break;
        }
        const results = parsed.data.results ?? [];
        for (const raw of results) {
          const candidate = workToCandidate(raw);
          if (candidate) candidates.push(candidate);
          else skipped++;
        }
        // A short page is the last page. Asking for the next one would spend a
        // 10-credit list query to learn nothing (§4.1).
        if (results.length < settings.perPage) break;
      }

      if (skipped > 0) {
        deps.logger.warn(`OpenAlex: skipped ${skipped} record(s) missing an id, title or date`);
      }
      deps.logger.info(
        `OpenAlex: ${candidates.length} candidate(s) for ${category.key} since ${since}`,
      );
      return candidates;
    },
  };
}

/** §10 — the one thing `registry.ts` imports. */
export const openAlexSource: AdapterRegistration = {
  name: 'openalex',
  // The discovery backbone runs on every category (§4.1).
  appliesTo: () => true,
  create: createOpenAlexAdapter,
};
