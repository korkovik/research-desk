/**
 * The day page (§8, §11 step 9): one `DayDigest` in, one self-contained HTML
 * document out.
 *
 * Rules this file exists to keep:
 * - Nothing is hidden. The §3 shortfall notice sits in the body above the
 *   papers and the §9 degradation list sits in the footer; both render whenever
 *   the digest carries them. A reader who gets four papers instead of five is
 *   told why on the page, not in a log they will never open.
 * - Nothing is invented. Every visible word is either a locale string, a value
 *   from the digest, or a date formatted from one.
 * - Nothing is loaded. The only URLs on the page are `<a href>`s in the
 *   reference block of §7.6 — links a reader clicks, never resources the
 *   document fetches. See `layout.ts`.
 */
import { relative, sep } from 'node:path';
import type { Config } from '../config.js';
import { displayName } from '../config.js';
import type { DayDigest, Degradation, DigestEntry } from '../types.js';
import { normaliseDoi, normaliseOpenAlexId } from '../state/seen.js';

import {
  escapeHtml,
  externalLink,
  fillHtml,
  formatAuthors,
  formatDateText,
  paragraphsHtml,
} from './html.js';
import { renderDocument } from './layout.js';
import { stringsFor } from './strings.js';
import type { StringTable } from './stringTable.js';

/** Every real DOI is `10.<registrant>/<suffix>`; anything else cannot resolve. */
const RESOLVABLE_DOI = /^10\.\d{4,9}\/\S+$/;

export function renderDayPage(digest: DayDigest, config: Config): string {
  // §2 — the page's language is the configured one, not the one baked into the
  // renderer. `digest.language` records what the summariser produced; if the
  // two ever disagree the config wins, because it also decides these labels.
  const language = config.output.language;
  const strings = stringsFor(language);
  const site = displayName(config);
  const dateText = formatDateText(digest.date, strings);

  const body = [
    renderNav(strings, config),
    renderMasthead(digest, strings, site, dateText),
    renderShortfall(digest, strings),
    renderPapers(digest, strings),
    renderFooter(digest, strings, config, dateText),
  ]
    .filter((part) => part !== '')
    .join('\n');

  return renderDocument({
    lang: language,
    title: fillTitle(strings.dayPageTitle, { site, category: digest.categoryLabel, date: dateText }),
    body,
  });
}

/** `<title>` needs plain text, not escaped HTML — `renderDocument` escapes it. */
function fillTitle(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

function renderNav(strings: StringTable, config: Config): string {
  return `<p class="nav"><a href="${escapeHtml(indexHref(config))}">${escapeHtml(strings.backToIndex)}</a></p>`;
}

/**
 * A relative path, computed from the configured paths, so the archive keeps
 * working when the whole folder is copied to a phone or a Drive share (§12 is
 * still open on where it lives). An absolute `file:///Users/...` would break on
 * the first move.
 */
function indexHref(config: Config): string {
  const path = relative(config.paths.archiveDir, config.paths.indexFile);
  return path.split(sep).join('/');
}

function renderMasthead(
  digest: DayDigest,
  strings: StringTable,
  site: string,
  dateText: string,
): string {
  return `<header class="masthead">
<p class="site-name">${escapeHtml(site)}</p>
<p class="topic-label">${escapeHtml(strings.dayTopicLabel)}</p>
<h1>${escapeHtml(digest.categoryLabel)}</h1>
<p class="dateline"><time datetime="${escapeHtml(digest.date)}">${escapeHtml(dateText)}</time></p>
<p class="lede">${escapeHtml(strings.siteIntro)}</p>
</header>`;
}

/**
 * §3 — "publishes with however many it found and notes the shortfall on the
 * page". `Shortfall.reason` is not rendered: it is the pipeline's own wording
 * for the log, in whatever language the code was written in, and the page is
 * strictly locale-layer text (§2).
 */
function renderShortfall(digest: DayDigest, strings: StringTable): string {
  const shortfall = digest.shortfall;
  if (!shortfall) return '';
  return `<section class="notice" aria-labelledby="shortfall">
<h2 id="shortfall">${escapeHtml(strings.shortfallHeading)}</h2>
<p>${fillHtml(strings.shortfallNotice, {
    produced: String(shortfall.produced),
    expected: String(shortfall.expected),
  })}</p>
</section>`;
}

function renderPapers(digest: DayDigest, strings: StringTable): string {
  const total = digest.entries.length;
  const papers = digest.entries.map((entry, index) => renderPaper(entry, index + 1, total, strings));
  return `<main>\n${papers.join('\n')}\n</main>`;
}

/** The six blocks of §7, in the spec's order. The order here IS the contract. */
function renderPaper(
  entry: DigestEntry,
  position: number,
  total: number,
  strings: StringTable,
): string {
  const { candidate, summary } = entry;
  const parts: string[] = [
    `<article class="paper" id="paper-${position}">`,
    `<p class="paper-counter">${fillHtml(strings.paperCounter, {
      n: String(position),
      total: String(total),
    })}</p>`,
    // The summary paragraph is the paper's opening and has no heading of its
    // own — it replaced a headline plus a two-sentence preamble that were two
    // ways of saying the same thing before the reader reached anything new.
    //
    // Its first sentence is emphasised, which is typography rather than a
    // second block: on a phone the paragraph fills the screen, and without
    // something for the eye to land on the reader cannot tell what the paper is
    // about without reading all of it. One rule in the stylesheet reverts it.
    `<div class="summary">${leadingSentenceHtml(summary.souhrn)}</div>`,
  ];

  // §4.3 — a preprint says so in plain words, next to the title where nobody
  // can miss it, not buried in the reference block.
  if (candidate.isPreprint === true) {
    parts.push(`<p class="preprint">${escapeHtml(strings.preprintNotice)}</p>`);
  }

  parts.push(
    `<h3>${escapeHtml(strings.blockDetail)}</h3>`,
    paragraphsHtml(summary.podrobneVysvetleni),
    `<h3>${escapeHtml(strings.blockWhyItMatters)}</h3>`,
    paragraphsHtml(summary.procJeToDulezite),
    `<h3>${escapeHtml(strings.blockReferences)}</h3>`,
    renderReferences(entry, strings),
    '</article>',
  );

  return parts.filter((part) => part !== '').join('\n');
}

/** §7.6 — authors, venue, date, DOI, OpenAlex, OA PDF where one exists, limits. */
function renderReferences(entry: DigestEntry, strings: StringTable): string {
  const { candidate, summary } = entry;
  const rows: string[] = [];

  rows.push(row(strings.refAuthors, escapeHtml(formatAuthors(candidate.authors, strings))));

  const venueLabel = candidate.isPreprint === true ? strings.refPreprintServer : strings.refJournal;
  rows.push(row(venueLabel, escapeHtml(candidate.venue?.trim() || strings.refVenueUnknown)));

  rows.push(
    row(
      strings.refPublished,
      `<time datetime="${escapeHtml(candidate.date)}">${escapeHtml(
        formatDateText(candidate.date, strings),
      )}</time>`,
    ),
  );

  // The normaliser of B.7 is built for MATCHING, so it keeps whatever a source
  // called a DOI. A link, unlike a dedup key, has to resolve, so the shape is
  // checked again here — `https://doi.org/n/a` would be worse than saying we
  // have no DOI.
  const doi = normaliseDoi(candidate.doi);
  const doiLink = doi !== null && RESOLVABLE_DOI.test(doi) ? externalLink(doiUrl(doi), doi) : null;
  rows.push(row(strings.refDoi, doiLink ?? escapeHtml(strings.refDoiMissing)));

  const openAlexId = normaliseOpenAlexId(candidate.openAlexId);
  if (openAlexId !== null) {
    const link = externalLink(`https://openalex.org/${openAlexId}`, strings.refOpenAlexLinkText);
    if (link) rows.push(row(strings.refOpenAlex, link));
  }

  // Only when one actually exists (§7.6) — an empty or broken link would be
  // worse than no row at all.
  const pdfLink = externalLink(candidate.oaPdfUrl, strings.refOpenAccessPdfLinkText);
  if (pdfLink) rows.push(row(strings.refOpenAccessPdf, pdfLink));

  // Always present, and the defined way through to a paper that has no DOI.
  const pageLink = externalLink(candidate.url, strings.refPaperPageLinkText);
  if (pageLink) rows.push(row(strings.refPaperPage, pageLink));

  const limitation = summary.poznamkaKOmezenim.trim();
  if (limitation !== '') rows.push(row(strings.refLimitations, escapeHtml(limitation)));

  return `<dl class="reference">\n${rows.join('\n')}\n</dl>`;
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt>\n<dd>${valueHtml}</dd>`;
}

/**
 * A DOI suffix may legally contain characters that mean something else in a
 * URL, so it is percent-encoded before it becomes an href; `#` and `?` survive
 * `encodeURI` and would silently truncate the link.
 */
function doiUrl(bareDoi: string): string {
  const encoded = encodeURI(bareDoi).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `https://doi.org/${encoded}`;
}

function renderFooter(
  digest: DayDigest,
  strings: StringTable,
  config: Config,
  dateText: string,
): string {
  const parts: string[] = ['<footer>'];

  // §9 — degradations are stated, never swallowed.
  if (digest.degradations.length > 0) {
    const items = digest.degradations
      .map((degradation) => `<li>${escapeHtml(degradationMessage(degradation, strings))}</li>`)
      .join('\n');
    parts.push(
      `<h2>${escapeHtml(strings.degradationHeading)}</h2>`,
      `<ul class="degradations">\n${items}\n</ul>`,
    );
  }

  parts.push(
    `<p>${escapeHtml(strings.footerHowItWorks)}</p>`,
    `<p>${fillHtml(strings.footerGenerated, { date: generatedDateText(digest, dateText, strings) })}</p>`,
    `<p class="nav"><a href="${escapeHtml(indexHref(config))}">${escapeHtml(strings.backToIndex)}</a></p>`,
    '</footer>',
  );
  return parts.join('\n');
}

/**
 * `generatedOn` is the run's calendar date in the configured timezone, already
 * resolved by the orchestrator — `generatedAt`'s date part is UTC and would
 * print yesterday for a run that finishes after midnight Prague time.
 * Falls back to the digest's own date when the instant is unparseable, so the
 * footer never reads "Invalid Date".
 */
function generatedDateText(digest: DayDigest, dayDateText: string, strings: StringTable): string {
  const iso = digest.generatedOn;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDateText(iso, strings) : dayDateText;
}

/**
 * One notice per source. A `switch` rather than a lookup table so that adding a
 * source to `SourceName` fails to compile until its Czech sentence exists —
 * §9's footer is only honest if it can name every source that can fail.
 *
 * `Degradation.message` is deliberately NOT rendered here. The page resolves
 * its own wording from the string table for `config.output.language`, so an
 * English page cannot end up carrying a Czech sentence, and so every word a
 * reader sees lives in the one file a reviewer reads. The `message` field
 * carries the same sentence into the JSON twin and the log, where it is
 * convenience rather than presentation.
 */
function degradationMessage(degradation: Degradation, strings: StringTable): string {
  switch (degradation.source) {
    case 'openalex':
      return strings.degradationOpenAlex;
    case 'arxiv':
      return strings.degradationArxiv;
    case 'semantic-scholar':
      return strings.degradationSemanticScholar;
    case 'anthropic':
      return strings.degradationAnthropic;
    case 'translation':
      return strings.degradationTranslation;
    case 'budget':
      return strings.degradationBudget;
  }
}

/**
 * Exposed for the index, which previews a day by its papers.
 *
 * There is no headline field any more, so the preview is the summary's first
 * sentence — which is what the generator is told to lead with. Falls back to a
 * clipped opening when the paragraph has no sentence break near the start.
 */
/**
 * The summary paragraph with its opening sentence marked up for emphasis.
 *
 * Falls back to the plain paragraph when there is no sentence break in the
 * first 180 characters — an unbroken opening is exactly the case where an
 * arbitrary cut would read worse than none.
 */
function leadingSentenceHtml(souhrn: string): string {
  const trimmed = souhrn.trim();
  const match = /^[\s\S]{20,180}?[.!?](?=\s)/u.exec(trimmed);
  if (!match) return paragraphsHtml(trimmed);
  const lead = match[0];
  const rest = trimmed.slice(lead.length).trim();
  return `<p><span class="lead">${escapeHtml(lead)}</span> ${escapeHtml(rest)}</p>`;
}

export function paperTitles(entries: readonly DigestEntry[]): string[] {
  return entries.map((entry) => entry.summary.souhrn);
}


