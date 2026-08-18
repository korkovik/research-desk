/**
 * `index.html` — regenerated from scratch on every run (§8).
 *
 * Its source of truth is the JSON twins in `archive/`, never the rendered HTML.
 * §8 calls the twins "what makes the archive reprocessable later"; reading them
 * here is the first thing that proves it. It also means the index can be
 * rebuilt after any change to this file — or after the HTML pages are deleted —
 * by re-running the renderer over the machine copies.
 *
 * The page carries no timestamp of its own on purpose: regenerating it twice
 * with an unchanged archive must produce byte-identical output, so `git status`
 * on the archive folder shows real changes only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { displayName } from '../config.js';
import { atomicWriteFile } from '../util/atomicWrite.js';
import type { Logger } from '../util/log.js';
import { escapeHtml, formatDateText } from './html.js';
import { renderDocument } from './layout.js';
import { stringsFor } from './strings.js';
import type { StringTable } from './stringTable.js';

/** What the index needs from one archived day. A deliberately small slice. */
export interface ArchivedDay {
  /** `YYYY-MM-DD`, taken from the filename — it is what the link resolves to. */
  date: string;
  categoryLabel: string;
  /** The day's plain-language titles (§7.1), in publication order. */
  titles: string[];
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Only the fields the index shows. Reading loosely on purpose: a twin written
 * by a future schema version must still list on the index rather than vanish
 * from the archive because a field it never had was missing.
 */
const TwinSchema = z.object({
  date: z.string().optional(),
  categoryLabel: z.string(),
  entries: z
    .array(z.object({ summary: z.object({ nadpis: z.string() }) }))
    .default([]),
});

export function readArchivedDays(archiveDir: string, logger: Logger): ArchivedDay[] {
  if (!existsSync(archiveDir)) return [];
  const days: ArchivedDay[] = [];

  for (const filename of readdirSync(archiveDir).sort()) {
    const match = DAY_FILE.exec(filename);
    if (!match) continue;
    const date = match[1];
    if (date === undefined) continue;
    const file = join(archiveDir, filename);

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      // One unreadable twin must not cost the reader the other 200 days.
      logger.warn(`index: skipping ${file} — not valid JSON (${(error as Error).message})`);
      continue;
    }
    const parsed = TwinSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(`index: skipping ${file} — unexpected shape (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      continue;
    }
    if (parsed.data.date !== undefined && parsed.data.date !== date) {
      logger.warn(`index: ${file} says date=${parsed.data.date}; using the filename date ${date}`);
    }
    days.push({
      date,
      categoryLabel: parsed.data.categoryLabel,
      titles: parsed.data.entries.map((entry) => entry.summary.nadpis),
    });
  }

  // Reverse-chronological by the date itself, not by file order or mtime: a day
  // re-rendered later must not jump to the top of the list.
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

export function renderIndexPage(days: readonly ArchivedDay[], config: Config): string {
  const language = config.output.language;
  const strings = stringsFor(language);
  const site = displayName(config);

  const body = [
    `<header class="masthead">
<h1>${escapeHtml(site)}</h1>
<p class="lede">${escapeHtml(strings.siteIntro)}</p>
<p>${escapeHtml(strings.indexIntro)}</p>
</header>`,
    `<main>
<h2>${escapeHtml(strings.indexDaysHeading)}</h2>
${days.length === 0 ? renderEmpty(strings) : renderDays(days, strings, config)}
</main>`,
    `<footer>
<p>${escapeHtml(strings.footerHowItWorks)}</p>
</footer>`,
  ].join('\n');

  return renderDocument({
    lang: language,
    title: strings.indexPageTitle.replace(/\{site\}/g, site),
    body,
  });
}

function renderEmpty(strings: StringTable): string {
  return `<p class="empty">${escapeHtml(strings.indexEmpty)}</p>`;
}

function renderDays(
  days: readonly ArchivedDay[],
  strings: StringTable,
  config: Config,
): string {
  const items = days.map((day) => {
    const href = escapeHtml(dayHref(config, day.date));
    const titles =
      day.titles.length === 0
        ? ''
        : `<ul class="day-titles">\n${day.titles
            .map((title) => `<li>${escapeHtml(title)}</li>`)
            .join('\n')}\n</ul>`;
    return `<li class="day">
<p class="day-date"><a href="${href}"><time datetime="${escapeHtml(day.date)}">${escapeHtml(
      formatDateText(day.date, strings),
    )}</time></a></p>
<p class="day-category">${escapeHtml(day.categoryLabel)}</p>
${titles}
<p class="day-link"><a href="${href}">${escapeHtml(strings.indexOpenDay)}</a></p>
</li>`;
  });
  return `<ol class="days">\n${items.join('\n')}\n</ol>`;
}

/**
 * Relative, so the archive survives being copied or synced elsewhere (§12).
 * Both inputs are repo-relative, and `relative` resolves both against the same
 * base, so the result is the path from the index to that day's page.
 */
function dayHref(config: Config, date: string): string {
  const from = dirname(config.paths.indexFile);
  const target = join(config.paths.archiveDir, `${date}.html`);
  return relative(from, target).split(sep).join('/');
}

export interface RegenerateIndexOptions {
  readonly config: Config;
  /** Everything in `config.paths` is relative to this. */
  readonly repoRoot: string;
  readonly logger: Logger;
}

export interface RegenerateIndexResult {
  /** Absolute path written. */
  path: string;
  /** How many archived days the index lists. */
  days: number;
}

export function regenerateIndex(options: RegenerateIndexOptions): RegenerateIndexResult {
  const { config, repoRoot, logger } = options;
  const archiveDir = resolve(repoRoot, config.paths.archiveDir);
  const indexPath = resolve(repoRoot, config.paths.indexFile);
  const days = readArchivedDays(archiveDir, logger);
  atomicWriteFile(indexPath, renderIndexPage(days, config));
  return { path: indexPath, days: days.length };
}
