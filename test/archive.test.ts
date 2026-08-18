/**
 * §8 — the archive: `archive/YYYY-MM-DD.html`, its JSON twin, and the index
 * regenerated from the twins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dayOutputPaths, writeDayOutputs } from '../src/render/archive.js';
import type { DayDigest } from '../src/types.js';
import { assertSelfContained, makeTempDir, testConfig, testLogger } from './support/htmlAssertions.js';
import { makeDegradation, makeDigest, makeEntry } from './support/digestFixture.js';

test('a day writes its page and its JSON twin, and the twin round-trips exactly', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();
  const digest = makeDigest({
    date: '2026-08-19',
    shortfall: { expected: 5, produced: 2, reason: 'diversity cap' },
    degradations: [makeDegradation('openalex')],
    entries: [makeEntry({ summary: { prikladJeMotivace: true } }), makeEntry({ candidate: { index: 2 } })],
  });

  const result = writeDayOutputs({ digest, config, repoRoot: dir, logger });

  assert.equal(result.htmlPath, join(dir, 'archive', '2026-08-19.html'));
  assert.equal(result.jsonPath, join(dir, 'archive', '2026-08-19.json'));
  assert.ok(existsSync(result.htmlPath));
  assert.ok(existsSync(result.indexPath));

  const twin = JSON.parse(readFileSync(result.jsonPath, 'utf8')) as DayDigest;
  assert.deepEqual(twin, digest, 'the twin must parse back to the same DayDigest');
});

test('the JSON twin carries paper ids, DOIs, scores and all six text blocks (§8)', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();
  const digest = makeDigest({ entryCount: 5 });

  const { jsonPath } = writeDayOutputs({ digest, config, repoRoot: dir, logger });
  const twin = JSON.parse(readFileSync(jsonPath, 'utf8')) as DayDigest;

  assert.equal(twin.schemaVersion, 1);
  assert.equal(twin.categoryKey, 'psychology-behaviour');
  assert.equal(twin.entries.length, 5);
  for (const entry of twin.entries) {
    assert.match(entry.candidate.id, /^openalex:W\d+$/);
    assert.match(entry.candidate.doi ?? '', /^10\./);
    assert.match(entry.candidate.openAlexId ?? '', /^W\d+$/);
    assert.equal(typeof entry.candidate.score.total, 'number');
    assert.ok(Array.isArray(entry.candidate.score.evidence));
    for (const block of [
      entry.summary.nadpis,
      entry.summary.oCoJde,
      entry.summary.podrobneVysvetleni,
      entry.summary.prikladZeZivota,
      entry.summary.procJeToDulezite,
      entry.summary.poznamkaKOmezenim,
    ]) {
      assert.equal(typeof block, 'string');
      assert.notEqual(block.trim(), '');
    }
    assert.equal(typeof entry.summary.prikladJeMotivace, 'boolean');
  }
});

test('the six rendered blocks are the same strings the twin stores', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();
  const digest = makeDigest({ entryCount: 2 });

  const { htmlPath, jsonPath } = writeDayOutputs({ digest, config, repoRoot: dir, logger });
  const html = readFileSync(htmlPath, 'utf8');
  const twin = JSON.parse(readFileSync(jsonPath, 'utf8')) as DayDigest;

  for (const entry of twin.entries) {
    for (const block of [
      entry.summary.nadpis,
      entry.summary.oCoJde,
      entry.summary.podrobneVysvetleni,
      entry.summary.prikladZeZivota,
      entry.summary.procJeToDulezite,
      entry.summary.poznamkaKOmezenim,
    ]) {
      assert.ok(html.includes(block), `the page is missing a block the twin records: ${block}`);
    }
  }
});

test('re-running the same day overwrites its two files instead of adding variants', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();

  writeDayOutputs({ digest: makeDigest({ entryCount: 5 }), config, repoRoot: dir, logger });
  const second = writeDayOutputs({
    digest: makeDigest({ entryCount: 4 }),
    config,
    repoRoot: dir,
    logger,
  });

  const files = readdirSync(join(dir, 'archive')).sort();
  assert.deepEqual(files, ['2026-08-19.html', '2026-08-19.json']);
  assert.equal(second.indexedDays, 1);
});

test('archive paths come from config, so moving the archive moves the files', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  config.paths.archiveDir = 'archiv/dny';
  config.paths.indexFile = 'archiv/prehled.html';
  const { logger } = testLogger();

  const result = writeDayOutputs({ digest: makeDigest(), config, repoRoot: dir, logger });

  assert.equal(result.htmlPath, join(dir, 'archiv', 'dny', '2026-08-19.html'));
  assert.equal(result.indexPath, join(dir, 'archiv', 'prehled.html'));
  // The index sits beside the day folder here, so the links stay relative.
  const index = readFileSync(result.indexPath, 'utf8');
  assert.ok(index.includes('href="dny/2026-08-19.html"'));
  const page = readFileSync(result.htmlPath, 'utf8');
  assert.ok(page.includes('href="../prehled.html"'));
});

test('a digest whose date is not a plain ISO date never becomes a path', () => {
  const config = testConfig();
  assert.throws(() => dayOutputPaths(config, '/tmp', '../../etc/passwd'), /YYYY-MM-DD/);
  assert.throws(() => dayOutputPaths(config, '/tmp', '2026-8-9'), /YYYY-MM-DD/);
});

test('the written page and index are both self-contained on disk', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();

  const result = writeDayOutputs({ digest: makeDigest(), config, repoRoot: dir, logger });
  assertSelfContained(readFileSync(result.htmlPath, 'utf8'), 'archived day page');
  assertSelfContained(readFileSync(result.indexPath, 'utf8'), 'index.html');
});
