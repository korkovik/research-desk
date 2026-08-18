/**
 * Static analysis of a rendered page (RISK-HTML-01/02/03).
 *
 * The distinction these helpers exist to enforce: a page may not LOAD anything
 * from the network, but it must LINK to the original papers (§7.6). So a
 * `https://doi.org/…` inside an `<a href>` is required, and the identical
 * string inside `src`, `<link>`, `@import` or a CSS `url()` is a bug — the
 * first is a click the reader chooses, the second is a request the browser
 * makes on its own, which is what "opens offline" forbids.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../../src/config.js';
import { createLogger, type Logger } from '../../src/util/log.js';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function testConfig(): Config {
  return loadConfig(REPO_ROOT);
}

/** A logger that keeps quiet and keeps receipts. */
export function testLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const logger = createLogger((level, message) => messages.push(`${level}: ${message}`));
  return { logger, messages };
}

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'research-desk-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Anything that makes the browser fetch something. None of it may appear. */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/<link\b/i, '<link> element'],
  [/<script\b/i, '<script> element'],
  [/\bsrc\s*=/i, 'src attribute'],
  [/\bsrcset\s*=/i, 'srcset attribute'],
  [/<img\b/i, '<img> element'],
  [/<iframe\b/i, '<iframe> element'],
  [/<video\b/i, '<video> element'],
  [/<audio\b/i, '<audio> element'],
  [/<object\b/i, '<object> element'],
  [/<embed\b/i, '<embed> element'],
  [/<source\b/i, '<source> element'],
  [/<base\b/i, '<base> element'],
  [/@import/i, 'CSS @import'],
  [/url\s*\(/i, 'CSS url()'],
  [/@font-face/i, 'CSS @font-face'],
  [/\bpreconnect\b|\bdns-prefetch\b|\bprefetch\b/i, 'resource hint'],
  [/localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|caches\./i, 'client-side storage'],
  [/\bon[a-z]+\s*=\s*"/i, 'inline event handler'],
];

const ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
const HREF = /<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi;

/** Every `<a href>` on the page, in document order. */
export function anchorHrefs(html: string): string[] {
  return [...html.matchAll(HREF)].map((match) => match[1] ?? '');
}

/** The contents of every `<style>` block. */
export function styleBlocks(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '');
}

export function assertSelfContained(html: string, label: string): void {
  for (const [pattern, what] of FORBIDDEN) {
    assert.equal(pattern.test(html), false, `${label}: ${what} must not appear in a self-contained page`);
  }

  // Whatever is left once the anchors are removed is the page's own machinery.
  // No absolute URL may survive there: if one does, something other than a
  // reader's click would reach for the network.
  const withoutAnchors = html.replace(ANCHOR, '');
  const leftovers = [...withoutAnchors.matchAll(/https?:\/\/[^\s"'<>]*/gi)].map((m) => m[0]);
  assert.deepEqual(leftovers, [], `${label}: absolute URLs outside <a> elements`);
  assert.equal(/\/\/[a-z0-9-]+\.[a-z]{2,}/i.test(withoutAnchors), false, `${label}: protocol-relative URL`);

  // All styling is inline, in a <style> block, so there is nothing to fetch.
  assert.ok(styleBlocks(html).length > 0, `${label}: expected an inline <style> block`);

  // Links are allowed, but only ordinary web links and relative paths.
  for (const href of anchorHrefs(html)) {
    const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(href);
    assert.ok(
      isRelative || /^https?:\/\//i.test(href),
      `${label}: anchor href must be relative or http(s), got ${href}`,
    );
    assert.equal(
      /^file:/i.test(href),
      false,
      `${label}: absolute file:// paths break the moment the archive is copied`,
    );
  }
}
