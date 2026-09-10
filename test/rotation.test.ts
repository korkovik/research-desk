import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, categoryForDate, ROTATION_EPOCH } from '../src/config.js';
import { shiftISODate } from '../src/util/dates.js';

/**
 * One edition a week, so the category is chosen by the week, not the weekday.
 * On a Tuesday-only schedule a weekday rotation would publish the Tuesday
 * category forever, and AI & computing — the only arXiv day — would never run.
 */
const ROOT = new URL('..', import.meta.url).pathname;
const config = loadConfig(ROOT);
const slotOn = (date: string): number => categoryForDate(config, date).slot;

test('the first weekly Tuesday, 2026-09-15, takes slot 1', () => {
  assert.equal(slotOn('2026-09-15'), 1);
  assert.equal(categoryForDate(config, '2026-09-15').key, 'ai-computing');
});

test('every day of one week gets the same category, so a run by hand stays on theme', () => {
  const monday = ROTATION_EPOCH;
  const slots = Array.from({ length: 7 }, (_, d) => slotOn(shiftISODate(monday, d)));
  assert.deepEqual(new Set(slots), new Set([1]));
});

test('seven consecutive weeks visit all seven categories once, then start again', () => {
  const tuesdays = Array.from({ length: 8 }, (_, w) => shiftISODate('2026-09-15', w * 7));
  const slots = tuesdays.map(slotOn);
  assert.deepEqual(slots.slice(0, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(slots[7], 1, 'week eight wraps round to slot 1');
});

test('a date before the epoch still lands on a real slot', () => {
  // The Sunday just before is the last day of the previous week: slot 7.
  assert.equal(slotOn('2026-09-13'), 7);
  assert.equal(slotOn('2026-08-18'), 4);
});

test('the rotation does not jump at New Year, as an ISO week number would', () => {
  // ISO years have 52 or 53 weeks, so `isoWeek % 7` repeats or skips a category
  // at the turn of the year. Whole weeks from a fixed Monday cannot.
  for (const tuesday of ['2026-12-22', '2026-12-29', '2027-01-05', '2027-12-28']) {
    const next = shiftISODate(tuesday, 7);
    assert.equal(slotOn(next), (slotOn(tuesday) % 7) + 1, `${tuesday} → ${next}`);
  }
});
