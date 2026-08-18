/**
 * §11 step 3 — resolve the seven categories' OpenAlex field names to real field
 * IDs and persist them in `config.json`.
 *
 * §5: "Category → OpenAlex field/subfield IDs must be resolved once at build
 * time and stored in a config file, not looked up on every run." This script is
 * that build step, and it is deliberately not importable by the pipeline — the
 * daily run must make zero resolution requests.
 *
 * It makes exactly ONE live request (`/fields`, a 10-credit list query): the
 * whole field vocabulary is 26 entries, so a per-category loop would spend the
 * unkeyed 100-credit daily allowance to learn the same thing seven times.
 *
 * It validates `config.json` against its own minimal schema rather than through
 * `loadConfig`, because the runtime schema requires `fieldIds` to be populated —
 * which is precisely what is not yet true when someone empties them to force a
 * re-resolution.
 *
 *   npm run resolve:categories            # resolve and rewrite config.json
 *   npm run resolve:categories -- --dry-run
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadEnvFile, readSecrets } from '../src/env.js';
import { atomicWriteFile } from '../src/util/atomicWrite.js';
import { fetchJson } from '../src/util/http.js';

const repoRoot = resolve(import.meta.dirname, '..');
const configPath = resolve(repoRoot, 'config.json');
const dryRun = process.argv.includes('--dry-run');

/** Only the parts this script reads. `fieldIds` may legitimately be empty here. */
const ScriptConfig = z.object({
  sources: z.object({
    openalex: z.object({
      baseUrl: z.string().url(),
      mailto: z.string().min(3),
      requireApiKey: z.boolean(),
    }),
  }),
  http: z.object({
    retries: z.number().int().min(0),
    backoffMs: z.array(z.number().int().min(0)).min(1),
    timeoutMs: z.number().int().min(1000),
    userAgent: z.string().min(1),
  }),
  categories: z
    .array(
      z.object({
        key: z.string().min(1),
        openalex: z.object({ fieldNames: z.array(z.string().min(1)).min(1) }),
      }),
    )
    .min(1),
});

const FieldsResponse = z.object({
  results: z
    .array(z.object({ id: z.string().nullish(), display_name: z.string().nullish() }))
    .nullish(),
});

/** OpenAlex reports IDs as URLs; `config.json` stores the bare `fields/32`. */
function bareId(id: string): string {
  const prefix = 'https://openalex.org/';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const raw: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
const configured = ScriptConfig.safeParse(raw);
if (!configured.success) {
  console.error(`${configPath} is missing what this script needs:`);
  for (const issue of configured.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}
const { sources, http, categories } = configured.data;

loadEnvFile(repoRoot);
const secrets = readSecrets();
if (!secrets.openAlexApiKey) {
  if (sources.openalex.requireApiKey) {
    console.error('OPENALEX_API_KEY is not set and sources.openalex.requireApiKey is true (§4.1)');
    process.exit(1);
  }
  console.warn('[warn] no OPENALEX_API_KEY — using the unkeyed 100 credits/day allowance (§4.1)');
}

const url = `${sources.openalex.baseUrl.replace(/\/$/, '')}/fields?per-page=50&select=id,display_name&mailto=${encodeURIComponent(sources.openalex.mailto)}`;
console.log(`GET ${url}`);

const body = await fetchJson<unknown>(url, http, {
  // The key is a header, never a query parameter (§4.1).
  headers: secrets.openAlexApiKey ? { Authorization: `Bearer ${secrets.openAlexApiKey}` } : {},
});

const parsed = FieldsResponse.safeParse(body);
if (!parsed.success) {
  console.error('OpenAlex /fields did not return a list of fields');
  process.exit(1);
}

const byName = new Map<string, string>();
for (const field of parsed.data.results ?? []) {
  if (field.id && field.display_name) byName.set(normalise(field.display_name), bareId(field.id));
}
console.log(`resolved vocabulary: ${byName.size} OpenAlex fields\n`);

interface Row {
  category: string;
  fieldName: string;
  id: string | null;
}

const rows: Row[] = [];
const resolvedByCategory = new Map<string, string[]>();

for (const category of categories) {
  const ids: string[] = [];
  for (const fieldName of category.openalex.fieldNames) {
    const id = byName.get(normalise(fieldName)) ?? null;
    rows.push({ category: category.key, fieldName, id });
    if (id) ids.push(id);
  }
  resolvedByCategory.set(category.key, ids);
}

const width = (pick: (row: Row) => string): number =>
  rows.reduce((max, row) => Math.max(max, pick(row).length), 0);
const categoryWidth = Math.max(width((r) => r.category), 'category'.length);
const nameWidth = Math.max(width((r) => r.fieldName), 'field name'.length);

console.log(`${'category'.padEnd(categoryWidth)}  ${'field name'.padEnd(nameWidth)}  id`);
console.log(`${'-'.repeat(categoryWidth)}  ${'-'.repeat(nameWidth)}  ${'-'.repeat(12)}`);
for (const row of rows) {
  console.log(
    `${row.category.padEnd(categoryWidth)}  ${row.fieldName.padEnd(nameWidth)}  ${row.id ?? 'UNRESOLVED'}`,
  );
}

const failures = rows.filter((row) => row.id === null);
if (failures.length > 0) {
  console.error(
    `\n${failures.length} field name(s) did not resolve; config.json left untouched (§11 step 3 requires no nulls).`,
  );
  process.exit(1);
}

// The raw object is mutated in place rather than rebuilt from the parsed one: a
// zod parse returns a copy, and this file's `_readme` keys are its comments.
if (!isRecord(raw) || !Array.isArray(raw.categories)) {
  console.error('config.json is not in the expected shape; refusing to rewrite it');
  process.exit(1);
}

let changed = false;
for (const entry of raw.categories) {
  if (!isRecord(entry) || typeof entry.key !== 'string' || !isRecord(entry.openalex)) {
    console.error('config.json has a category without a key or an openalex block; refusing to rewrite it');
    process.exit(1);
  }
  const ids = resolvedByCategory.get(entry.key) ?? [];
  if (JSON.stringify(entry.openalex.fieldIds) !== JSON.stringify(ids)) {
    console.log(
      `\n${entry.key}: ${JSON.stringify(entry.openalex.fieldIds ?? null)} -> ${JSON.stringify(ids)}`,
    );
    entry.openalex.fieldIds = ids;
    changed = true;
  }
}

if (!changed) {
  console.log('\nAll categories already carry the resolved IDs. config.json unchanged.');
} else if (dryRun) {
  console.log('\n--dry-run: not writing.');
} else {
  atomicWriteFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`\nWrote resolved field IDs to ${configPath}`);
}
