/**
 * arXiv — freshness for the AI/computing day (§4.3).
 *
 * Free, no key, one query per run. The response is Atom XML rather than JSON,
 * which is the only reason this adapter looks different from the OpenAlex one;
 * everything after the parse produces the same §10 `Candidate`.
 *
 * Every candidate from here is a preprint. §4.3 requires the page to say so in
 * plain words, and the flag is what the renderer keys that sentence on — so it
 * is set unconditionally rather than inferred.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import type { Candidate, CategoryConfig, SourceAdapter } from '../types.js';
import { arxivStamp, isISODate } from '../util/dates.js';
import { fetchText, HttpError } from '../util/http.js';
import { bareDoi } from './openalex.js';
import type { AdapterDeps, AdapterRegistration } from './deps.js';
import { httpPolicy, nowOf, requestOptions } from './deps.js';

/**
 * arXiv grants itself a non-exclusive licence to distribute; the author keeps
 * copyright unless they picked a CC licence, which the Atom API does not report.
 * So this is the honest default, overridden only if a feed ever does say more.
 */
const DEFAULT_ARXIV_LICENCE = 'arxiv-nonexclusive';

// ---------------------------------------------------------------------------
// Atom shape
// ---------------------------------------------------------------------------

const Link = z.object({
  '@_href': z.string().nullish(),
  '@_rel': z.string().nullish(),
  '@_title': z.string().nullish(),
});

const Author = z.union([
  z.string(),
  z.object({ name: z.union([z.string(), z.number()]).nullish() }),
]);

const Category = z.object({ '@_term': z.string().nullish() });

const EntrySchema = z.object({
  id: z.string().nullish(),
  title: z.union([z.string(), z.number()]).nullish(),
  summary: z.union([z.string(), z.number()]).nullish(),
  published: z.string().nullish(),
  updated: z.string().nullish(),
  link: z.array(Link).nullish(),
  author: z.array(Author).nullish(),
  category: z.array(Category).nullish(),
  'arxiv:primary_category': Category.nullish(),
  'arxiv:doi': z.union([z.string(), z.number()]).nullish(),
});

const FeedSchema = z.object({
  feed: z.object({ entry: z.array(z.unknown()).nullish() }).nullish(),
});

export type ArxivEntry = z.infer<typeof EntrySchema>;

/**
 * `<author>`, `<category>` and `<link>` appear once or many times depending on
 * the paper, and a parser that collapses a single occurrence to an object turns
 * "one author" into a different code path from "two authors". Forcing arrays
 * removes that whole class of bug.
 *
 * `parseTagValue: false` keeps a title like "2024" a string instead of a number.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (_name, jpath) =>
    jpath === 'feed.entry' ||
    jpath === 'feed.entry.author' ||
    jpath === 'feed.entry.category' ||
    jpath === 'feed.entry.link',
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** arXiv wraps abstracts and long titles at ~80 columns; the HTML must not. */
function collapse(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOrNull(value: string | number | null | undefined): string | null {
  const text = collapse(value);
  return text === '' ? null : text;
}

/** `http://arxiv.org/abs/2608.16889v1` → `2608.16889`. */
export function arxivIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /arxiv\.org\/abs\/(.+)$/i.exec(url.trim());
  const raw = match?.[1] ?? url.trim();
  if (raw === '') return null;
  // The version suffix is dropped: §8's dedup must treat v1 and v2 of the same
  // preprint as the same paper, and Semantic Scholar resolves the bare id.
  return raw.replace(/v\d+$/, '');
}

function linkHref(links: z.infer<typeof Link>[] | null | undefined, match: (l: z.infer<typeof Link>) => boolean): string | null {
  const found = (links ?? []).find(match);
  const href = found?.['@_href'];
  return href && href.trim() !== '' ? href.trim() : null;
}

/** `null` when the entry cannot satisfy §10's contract; the caller counts it. */
export function entryToCandidate(raw: unknown): Candidate | null {
  const parsed = EntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const entry = parsed.data;

  const arxivId = arxivIdFromUrl(entry.id);
  const title = collapse(entry.title);
  const date = (entry.published ?? entry.updated ?? '').slice(0, 10);
  if (!arxivId || title === '' || !isISODate(date)) return null;

  const absUrl =
    linkHref(entry.link, (l) => l['@_rel'] === 'alternate') ??
    (entry.id ?? '').replace(/^http:/, 'https:');
  const pdfUrl = linkHref(entry.link, (l) => l['@_title'] === 'pdf');
  const licence = linkHref(entry.link, (l) => l['@_rel'] === 'license');

  const authors = (entry.author ?? [])
    .map((a) => (typeof a === 'string' ? a : collapse(a.name)))
    .map((name) => collapse(name))
    .filter((name) => name !== '');

  // arXiv has no OpenAlex topic hierarchy, but §6's diversity constraint is
  // keyed on `subfield.id` and would silently degrade to "everything is one
  // subfield" without a key. The arXiv primary category is the closest real
  // equivalent — it is the author-declared subject area — so it is namespaced
  // (`arxiv:cs.RO`) to make clear it is not an OpenAlex subfield ID.
  const primaryCategory =
    entry['arxiv:primary_category']?.['@_term'] ?? entry.category?.[0]?.['@_term'] ?? null;

  const abstract = collapse(entry.summary);

  return {
    id: `arxiv:${arxivId}`,
    title,
    abstract: abstract === '' ? null : abstract,
    date,
    url: absUrl,
    licence: licence ?? DEFAULT_ARXIV_LICENCE,
    source: 'arxiv',
    // Present only when the preprint has already been published somewhere;
    // it is what lets the registry recognise the OpenAlex record as the same
    // paper (§10 merge).
    doi: bareDoi(textOrNull(entry['arxiv:doi'])),
    openAlexId: null,
    subfield: primaryCategory ? { id: `arxiv:${primaryCategory}`, name: primaryCategory } : null,
    field: null,
    topic: null,
    isOpenAccess: true,
    oaPdfUrl: pdfUrl,
    isPreprint: true,
    isRetracted: false,
    authors,
    venue: 'arXiv',
    indexedDate: date,
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function buildQueryUrl(
  deps: AdapterDeps,
  category: CategoryConfig,
  since: string,
): string {
  const settings = deps.config.sources.arxiv;
  const categories = category.arxiv?.categories ?? [];
  const catClause = categories.map((c) => `cat:${c}`).join(' OR ');
  const from = arxivStamp(new Date(`${since}T00:00:00Z`));
  const to = arxivStamp(nowOf(deps));

  const searchQuery = `(${catClause}) AND submittedDate:[${from} TO ${to}]`;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: '0',
    max_results: String(settings.maxResults),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  return `${settings.baseUrl}?${params.toString()}`;
}

/** Exported so tests can parse a fixture without an HTTP round trip. */
export function parseFeed(xml: string, urlForErrors: string): unknown[] {
  // The parser itself is forgiving and would hand back the first few entries of
  // a connection that died mid-feed. Half a day's candidates that look complete
  // is worse than a source that visibly failed and degrades under §9.
  const validity = XMLValidator.validate(xml);
  if (validity !== true) {
    throw new HttpError(
      `arXiv response was not well-formed XML: ${validity.err.msg} (line ${String(validity.err.line)})`,
      null,
      urlForErrors,
      xml.slice(0, 300),
    );
  }

  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new HttpError(
      `arXiv response was not parsable XML: ${(error as Error).message}`,
      null,
      urlForErrors,
      xml.slice(0, 300),
    );
  }
  const parsed = FeedSchema.safeParse(document);
  if (!parsed.success) {
    throw new HttpError('arXiv response was not an Atom feed', null, urlForErrors, xml.slice(0, 300));
  }
  return parsed.data.feed?.entry ?? [];
}

export function createArxivAdapter(deps: AdapterDeps): SourceAdapter {
  return {
    name: 'arxiv',
    async fetch(category: CategoryConfig, since: string): Promise<Candidate[]> {
      if (!category.arxiv || category.arxiv.categories.length === 0) {
        // §5 — arXiv only covers the AI/computing day. The registry already
        // filters on this; the guard keeps a direct caller from sending arXiv a
        // query with an empty category clause, which matches everything.
        return [];
      }
      const url = buildQueryUrl(deps, category, since);
      const xml = await fetchText(url, httpPolicy(deps.config), requestOptions(deps, { Accept: 'application/atom+xml' }));
      const entries = parseFeed(xml, url);

      const candidates: Candidate[] = [];
      let skipped = 0;
      for (const entry of entries) {
        const candidate = entryToCandidate(entry);
        if (candidate) candidates.push(candidate);
        else skipped++;
      }
      if (skipped > 0) {
        deps.logger.warn(`arXiv: skipped ${skipped} entr(ies) missing an id, title or date`);
      }
      deps.logger.info(`arXiv: ${candidates.length} candidate(s) for ${category.key} since ${since}`);
      return candidates;
    },
  };
}

/** §10 — the one thing `registry.ts` imports. */
export const arxivSource: AdapterRegistration = {
  name: 'arxiv',
  // §5: only the days whose config carries an `arxiv` block, i.e. Monday.
  appliesTo: (category) => (category.arxiv?.categories.length ?? 0) > 0,
  create: createArxivAdapter,
};
