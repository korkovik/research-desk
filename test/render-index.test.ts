/**
 * §8 / §11 step 9 — `index.html`: every archived day, newest first, previewed
 * by its plain-language titles, rebuilt from the JSON twins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { regenerateIndex, readArchivedDays, renderIndexPage } from '../src/render/index.js';
import { writeDayOutputs } from '../src/render/archive.js';
import { stringsCs } from '../src/render/strings.cs.js';
import { assertSelfContained, makeTempDir, testConfig, testLogger } from './support/htmlAssertions.js';
import { makeDigest, makeEntry } from './support/digestFixture.js';

/** Dates deliberately written out of order, with a gap between the months. */
const DATES = [
  '2026-07-29',
  '2026-08-03',
  '2026-08-19',
  '2026-08-04',
  '2026-07-30',
  '2026-08-17',
] as const;

function seedArchive(dir: string, dates: readonly string[] = DATES): void {
  const config = testConfig();
  const { logger } = testLogger();
  for (const [index, date] of dates.entries()) {
    writeDayOutputs({
      digest: makeDigest({
        date,
        categoryLabel: index % 2 === 0 ? 'Psychologie a chování' : 'Příroda a klima',
        entries: Array.from({ length: 5 }, (_, i) =>
          makeEntry({ candidate: { index: i + 1 }, summary: { souhrn: `${date} — studie ${i + 1}` } }),
        ),
      }),
      config,
      repoRoot: dir,
      logger,
    });
  }
}

test('the index lists every archived day exactly once, newest first', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir);
  const config = testConfig();
  const { logger } = testLogger();

  const result = regenerateIndex({ config, repoRoot: dir, logger });
  assert.equal(result.days, DATES.length);

  const html = readFileSync(result.path, 'utf8');
  const listed = [...html.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map((m) => m[1]);
  assert.deepEqual(listed, [...DATES].sort().reverse());
});

test('each index entry shows the date, the Czech category label and the five titles', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir, ['2026-08-19']);
  const config = testConfig();
  const { logger } = testLogger();

  const html = readFileSync(regenerateIndex({ config, repoRoot: dir, logger }).path, 'utf8');

  assert.ok(html.includes('19. srpna 2026'));
  assert.ok(html.includes('Psychologie a chování'));
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(html.includes(`2026-08-19 — studie ${i}`), `title ${i} is missing from the preview`);
  }
  assert.ok(html.includes('href="archive/2026-08-19.html"'));
});

test('a day with four papers previews four titles', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();
  writeDayOutputs({
    digest: makeDigest({
      date: '2026-08-18',
      entries: Array.from({ length: 4 }, (_, i) =>
        makeEntry({ candidate: { index: i + 1 }, summary: { souhrn: `Studie ${i + 1}` } }),
      ),
    }),
    config,
    repoRoot: dir,
    logger,
  });

  const days = readArchivedDays(join(dir, 'archive'), logger);
  assert.equal(days.length, 1);
  assert.deepEqual(days[0]?.titles, ['Studie 1', 'Studie 2', 'Studie 3', 'Studie 4']);
});

test('an empty archive still produces a readable index', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  const config = testConfig();
  const { logger } = testLogger();

  const result = regenerateIndex({ config, repoRoot: dir, logger });
  assert.equal(result.days, 0);

  const html = readFileSync(result.path, 'utf8');
  assert.ok(html.includes(stringsCs.indexEmpty));
  assert.equal(html.includes('<ol class="days">'), false);
  assertSelfContained(html, 'empty index');
});

test('regenerating the index twice produces byte-identical output', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir);
  const config = testConfig();
  const { logger } = testLogger();

  const first = readFileSync(regenerateIndex({ config, repoRoot: dir, logger }).path, 'utf8');
  const second = readFileSync(regenerateIndex({ config, repoRoot: dir, logger }).path, 'utf8');
  assert.equal(first, second);
});

test('the JSON twins are the source of truth — deleting the pages does not lose a day', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir, ['2026-08-19']);
  const config = testConfig();
  const { logger } = testLogger();

  // A twin with no HTML sibling still lists: the index reads the machine copies.
  writeFileSync(
    join(dir, 'archive', '2026-08-20.json'),
    JSON.stringify(makeDigest({ date: '2026-08-20', categoryLabel: 'Zdraví a medicína' })),
  );

  const html = readFileSync(regenerateIndex({ config, repoRoot: dir, logger }).path, 'utf8');
  assert.ok(html.includes('Zdraví a medicína'));
  assert.ok(html.includes('href="archive/2026-08-20.html"'));
});

test('an unreadable twin is skipped with a warning, not allowed to lose the archive', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir, ['2026-08-19']);
  const archiveDir = join(dir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, '2026-08-20.json'), '{ this is not json');
  writeFileSync(join(archiveDir, '2026-08-21.json'), JSON.stringify({ entries: [] }));
  writeFileSync(join(archiveDir, 'notes.json'), JSON.stringify({ ignore: true }));

  const { logger, messages } = testLogger();
  const days = readArchivedDays(archiveDir, logger);

  assert.deepEqual(
    days.map((day) => day.date),
    ['2026-08-19'],
  );
  assert.equal(messages.filter((m) => m.startsWith('warn:')).length, 2);
});

test('the index is self-contained and declares the configured language', (t) => {
  const { dir, cleanup } = makeTempDir();
  t.after(cleanup);
  seedArchive(dir);
  const config = testConfig();
  const { logger } = testLogger();

  const html = readFileSync(regenerateIndex({ config, repoRoot: dir, logger }).path, 'utf8');
  assertSelfContained(html, 'index');
  assert.ok(html.includes('<html lang="cs">'));
  assert.ok(html.includes('<title>Research Desk – přehled všech dní</title>'));
});

test('a day title containing markup is escaped in the index preview', () => {
  const config = testConfig();
  const html = renderIndexPage(
    [{ date: '2026-08-19', categoryLabel: 'Psychologie & chování', categoryKey: 'psychology-behaviour', titles: ['<script>x</script>'] }],
    config,
  );
  assert.equal(/<script/i.test(html), false);
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('Psychologie &amp; chování'));
});

test('the index filters by category with no script anywhere on the page', () => {
  const config = testConfig();
  const html = renderIndexPage(
    [
      { date: '2026-08-19', categoryLabel: 'Příroda a klima', categoryKey: 'nature-climate', titles: ['A'] },
      { date: '2026-08-18', categoryLabel: 'Zdraví a medicína', categoryKey: 'health-medicine', titles: ['B'] },
    ],
    config,
  );

  // §8 forbids loading a script and layout.ts refuses to emit one, so the whole
  // filter is :checked plus a sibling selector.
  assert.equal(/<script/i.test(html), false);

  // A chip for every category in the rotation, not only the ones with editions:
  // a missing chip reads as a missing feature, an empty one reads as "not yet".
  for (const category of config.categories) {
    assert.ok(html.includes(`id="cat-${category.key}"`), `no chip for ${category.key}`);
    assert.ok(
      html.includes(`#cat-${category.key}:checked ~ .days .day:not([data-cat="${category.key}"])`),
      `no filter rule for ${category.key}`,
    );
  }

  // The two days present are tagged, and the six empty categories explain
  // themselves rather than showing a blank page.
  assert.ok(html.includes('data-cat="nature-climate"'));
  assert.ok(html.includes('data-cat="health-medicine"'));
  assert.ok(html.includes('class="cat-empty" data-cat="psychology-behaviour"'));
  assert.equal(html.includes('class="cat-empty" data-cat="nature-climate"'), false);

  // The radios must stay focusable — clipped, never display:none — or the chips
  // stop working from a keyboard.
  assert.equal(/\.cat-input\s*\{[^}]*display:\s*none/.test(html), false);
});
