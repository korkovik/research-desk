/**
 * §11 step 1 — "config loads, all directories exist" — plus the guards that
 * make a bad config fail at start-up rather than at 06:00 in the dark.
 *
 * Scenario IDs refer to docs/TEST-SCENARIOS.md (S11-01a/b).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, categoryForWeekday, displayName, ConfigSchema } from '../src/config.js';
import { parseEnvFile, readSecrets } from '../src/env.js';
import { localDateISO, localWeekday, shiftISODate, daysBetween, arxivStamp } from '../src/util/dates.js';

const ROOT = new URL('..', import.meta.url).pathname;

test('S11-01a: config.json loads and validates', () => {
  const config = loadConfig(ROOT);
  assert.equal(config.categories.length, 7);
  assert.equal(config.output.papersPerDay, 5);
  assert.equal(config.output.minPapersToPublish, 3);
  assert.equal(config.windows.freshnessDays, 7);
  assert.equal(config.windows.dedupDays, 180);
});

test('S11-01b: every directory the pipeline writes to exists', () => {
  for (const dir of ['archive', 'logs', 'state', 'src', 'test', 'docs', 'scripts']) {
    const path = join(ROOT, dir);
    assert.ok(existsSync(path), `${dir}/ is missing`);
    assert.ok(statSync(path).isDirectory(), `${dir} is not a directory`);
  }
});

test('every weekday 1..7 resolves to a category with real OpenAlex field IDs', () => {
  const config = loadConfig(ROOT);
  for (let weekday = 1; weekday <= 7; weekday++) {
    const category = categoryForWeekday(config, weekday);
    assert.ok(category.labelCs.length > 0);
    assert.ok(category.openalex.fieldIds.length > 0);
    for (const id of category.openalex.fieldIds) {
      // §11 step 3: no nulls, and the shape OpenAlex actually returns.
      assert.match(id, /^fields\/\d+$/, `${category.key} has a malformed field ID: ${id}`);
    }
    assert.equal(
      category.openalex.fieldIds.length,
      category.openalex.fieldNames.length,
      `${category.key} has a name/ID count mismatch`,
    );
  }
});

test('the config refuses weights that reorder §6\'s fixed importance ranking', () => {
  const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const broken = structuredClone(raw) as Record<string, Record<string, Record<string, number>>>;
  // Freshness promoted above everyday relevance — still sums to 1, still a
  // silent change to what the project is for. It must not load.
  broken.ranking!.weights = {
    explainability: 0.4,
    everydayRelevance: 0.18,
    freshness: 0.28,
    credibility: 0.14,
  };
  const parsed = ConfigSchema.safeParse(broken);
  assert.equal(parsed.success, false);
});

test('the config refuses weights that do not sum to 1', () => {
  const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const broken = structuredClone(raw) as Record<string, Record<string, Record<string, number>>>;
  broken.ranking!.weights = {
    explainability: 0.5,
    everydayRelevance: 0.28,
    freshness: 0.18,
    credibility: 0.14,
  };
  assert.equal(ConfigSchema.safeParse(broken).success, false);
});

test('while the Czech-facing name is unset, pages carry the working name', () => {
  const config = loadConfig(ROOT);
  // §12 leaves the name open; assumption A4 keeps it visible rather than blank.
  assert.equal(displayName(config), config.output.siteName ?? config.output.workingName);
  assert.ok(displayName(config).length > 0);
});

test('the env parser takes a value verbatim after the first equals sign', () => {
  const parsed = parseEnvFile(
    [
      '# a comment',
      '',
      'SIMPLE=value',
      'export EXPORTED=also-fine',
      'WITH_HASH=abc#def',
      'WITH_EQUALS=a=b=c',
      'QUOTED="  padded  "',
    ].join('\n'),
    'test',
  );
  assert.equal(parsed.get('SIMPLE'), 'value');
  assert.equal(parsed.get('EXPORTED'), 'also-fine');
  // A key containing a '#' must survive: no comment stripping inside a value.
  assert.equal(parsed.get('WITH_HASH'), 'abc#def');
  assert.equal(parsed.get('WITH_EQUALS'), 'a=b=c');
  assert.equal(parsed.get('QUOTED'), '  padded  ');
});

test('a line without an equals sign stops the process instead of being dropped', () => {
  // A key silently dropped and then believed set is the failure this prevents.
  assert.throws(() => parseEnvFile('GOOD=1\nBROKEN_LINE\n', 'file'), /file:2/);
});

test('secrets read as null when unset or blank, never as an empty string', () => {
  const secrets = readSecrets({ OPENALEX_API_KEY: '', ANTHROPIC_API_KEY: '  ', SEMANTIC_SCHOLAR_API_KEY: 'x' });
  assert.equal(secrets.openAlexApiKey, null);
  assert.equal(secrets.anthropicApiKey, null);
  assert.equal(secrets.semanticScholarApiKey, 'x');
});

test('the archive date is the configured timezone\'s date, not the host\'s', () => {
  // 22:30 UTC on 18 August is already 19 August in Prague. The page must be
  // filed under the day the family will read it.
  const lateEvening = new Date('2026-08-18T22:30:00Z');
  assert.equal(localDateISO(lateEvening, 'Europe/Prague'), '2026-08-19');
  assert.equal(localDateISO(lateEvening, 'UTC'), '2026-08-18');
  assert.equal(localWeekday(lateEvening, 'Europe/Prague'), 3); // Wednesday
  assert.equal(localWeekday(lateEvening, 'UTC'), 2); // Tuesday
});

test('date arithmetic is timezone-free and inclusive at the boundary', () => {
  assert.equal(shiftISODate('2026-08-19', -7), '2026-08-12');
  assert.equal(shiftISODate('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-08-12', '2026-08-19'), 7);
  assert.equal(arxivStamp(new Date('2026-08-18T22:30:00Z')), '202608182230');
});
