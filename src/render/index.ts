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
  /** The rotation key (`nature-climate`, …). What the index filter groups on. */
  categoryKey: string;
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
  categoryKey: z.string().optional(),
  entries: z
    // `souhrn` for anything written since the restructure, `nadpis` for the
    // editions that predate it. Reading both is what keeps the older days on
    // the index instead of quietly dropping them.
    .array(z.object({ summary: z.object({ souhrn: z.string().optional(), nadpis: z.string().optional() }) }))
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
      categoryKey: parsed.data.categoryKey ?? '',
      titles: parsed.data.entries.map((entry) =>
        previewOf(entry.summary.souhrn ?? entry.summary.nadpis ?? ''),
      ),
    });
  }

  // Reverse-chronological by the date itself, not by file order or mtime: a day
  // re-rendered later must not jump to the top of the list.
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

/**
 * What the index shows for one paper.
 *
 * There is no headline field any more, so the preview is the summary's first
 * sentence — which is what the generator is told to lead with. An old edition's
 * `nadpis` is already one line and passes through unchanged.
 */
function previewOf(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]{20,180}?[.!?](?=\s|$)/u.exec(trimmed);
  if (match) return match[0].trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trimEnd()}…` : trimmed;
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
${days.length === 0 ? renderEmpty(strings) : renderFilter(days, strings, config) + '\n' + renderDays(days, strings, config)}
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

/**
 * Category chips, as radio inputs a stylesheet rule reacts to.
 *
 * No JavaScript: `layout.ts` refuses to emit a script and §8 refuses to load
 * one, so the filter is `:checked` plus a sibling selector. The inputs are
 * visually hidden but focusable, and each chip is a `<label>` bound to one, so
 * the whole thing works from a keyboard and from a screen reader.
 *
 * Chips are the seven rotation categories, not the days present — a category
 * with nothing in it yet still gets a chip and an explanation, because a
 * missing chip reads as a missing feature while an empty one reads as "not yet".
 */
function renderFilter(
  days: readonly ArchivedDay[],
  strings: StringTable,
  config: Config,
): string {
  const counts = new Map<string, number>();
  for (const day of days) counts.set(day.categoryKey, (counts.get(day.categoryKey) ?? 0) + 1);

  const inputs = [`<input type="radio" name="cat" id="cat-all" class="cat-input" checked>`];
  const chips = [`<label class="chip" for="cat-all">${escapeHtml(strings.filterAll)}</label>`];
  const empties: string[] = [];

  for (const category of config.categories) {
    const id = `cat-${category.key}`;
    inputs.push(`<input type="radio" name="cat" id="${escapeHtml(id)}" class="cat-input">`);
    const count = counts.get(category.key) ?? 0;
    chips.push(
      `<label class="chip" for="${escapeHtml(id)}">${escapeHtml(category.labelCs)}` +
        (count === 0 ? '' : ` <span class="chip-count">${String(count)}</span>`) +
        `</label>`,
    );
    if (count === 0) {
      empties.push(
        `<p class="cat-empty" data-cat="${escapeHtml(category.key)}">` +
          `${escapeHtml(strings.filterEmpty.replace(/\{category\}/g, category.labelCs))}</p>`,
      );
    }
  }

  // One pair of rules per category, generated because the categories are config.
  const rules = config.categories
    .map(
      (c) =>
        `#cat-${c.key}:checked ~ .days .day:not([data-cat="${c.key}"]) { display: none; }\n` +
        `#cat-${c.key}:checked ~ .cat-empty[data-cat="${c.key}"] { display: block; }\n` +
        `#cat-${c.key}:checked ~ .chips label[for="cat-${c.key}"] { background: #1a1a1a; border-color: #1a1a1a; color: #fbfaf7; }`,
    )
    .join('\n');

  return [
    inputs.join('\n'),
    `<style>\n#cat-all:checked ~ .chips label[for="cat-all"] { background: #1a1a1a; border-color: #1a1a1a; color: #fbfaf7; }\n${rules}\n</style>`,
    `<nav class="chips" aria-label="${escapeHtml(strings.filterHeading)}">\n${chips.join('\n')}\n</nav>`,
    ...empties,
  ].join('\n');
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
    return `<li class="day" data-cat="${escapeHtml(day.categoryKey)}">
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
