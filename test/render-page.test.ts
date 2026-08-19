/**
 * §8 / §11 step 9 — the day page.
 *
 * These are static-analysis tests: they prove the page cannot reach the
 * network, that every block the spec requires is present in the spec's order,
 * and that untrusted text cannot become markup. What they cannot prove is that
 * the page LOOKS right; RISK-HTML-01b/03 need a real browser and a human.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDayPage } from '../src/render/page.js';
import { stringsCs } from '../src/render/strings.cs.js';
import {
  anchorHrefs,
  assertSelfContained,
  styleBlocks,
  testConfig,
} from './support/htmlAssertions.js';
import { makeDegradation, makeDigest, makeEntry } from './support/digestFixture.js';

const config = testConfig();

/**
 * The block headings the page renders, in the order §7 fixes.
 *
 * Five, not six: block 1 is the plain-language headline and carries no label.
 * It had a small "Nadpis" kicker until the first real page was looked at on a
 * phone, where a label reading "Headline" above a headline was the one element
 * that told the reader nothing.
 */
const BLOCK_HEADINGS = [stringsCs.blockDetail, stringsCs.blockWhyItMatters, stringsCs.blockReferences];

function articles(html: string): string[] {
  return html.split('<article').slice(1);
}

test('day page loads nothing from the network and stores nothing client-side', () => {
  const html = renderDayPage(makeDigest(), config);
  assertSelfContained(html, 'day page');
});

test('the only absolute URLs on the page are reference-block links the reader clicks', () => {
  const digest = makeDigest({
    entries: [
      makeEntry({
        candidate: {
          index: 1,
          doi: '10.1234/example.1',
          openAlexId: 'W1001',
          oaPdfUrl: 'https://example.org/pdf/1.pdf',
          url: 'https://example.org/paper/1',
        },
      }),
    ],
  });
  const html = renderDayPage(digest, config);
  const external = anchorHrefs(html).filter((href) => /^https?:/i.test(href));
  assert.deepEqual(external, [
    'https://doi.org/10.1234/example.1',
    'https://openalex.org/W1001',
    'https://example.org/pdf/1.pdf',
    'https://example.org/paper/1',
  ]);
  // …and the way back to the index is a relative path, so the archive survives
  // being copied to a phone or a Drive folder (RISK-HTML-11).
  assert.ok(anchorHrefs(html).includes('../index.html'));
});

test('every block heading appears, in order, for every paper', () => {
  const html = renderDayPage(makeDigest({ entryCount: 5 }), config);
  const segments = articles(html);
  assert.equal(segments.length, 5);
  for (const [index, segment] of segments.entries()) {
    const positions = BLOCK_HEADINGS.map((heading) => segment.indexOf(heading));
    for (const [i, position] of positions.entries()) {
      assert.notEqual(position, -1, `paper ${index + 1} is missing block "${BLOCK_HEADINGS[i]}"`);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    assert.deepEqual(positions, sorted, `paper ${index + 1} renders the blocks out of order`);
  }
});

test('hostile summary text renders as visible text, never as markup', () => {
  const digest = makeDigest({
    entries: [
      makeEntry({
        summary: {
          souhrn:
            '<script>alert(1)</script> Uvozovky "takto" a apostrof \'takto\', plus <div> bez konce.',
          procJeToDulezite: 'Nedostatek spánku &amp; spánek dohromady.',
          poznamkaKOmezenim: 'Vzorek < 30 lidí & jen jedno město.',
        },
        candidate: { authors: ['<b>Jana</b> Nováková & spol.'] },
      }),
    ],
  });
  const html = renderDayPage(digest, config);

  assert.equal(/<script/i.test(html), false, 'a <script> tag reached the document');
  assert.equal(html.includes('<div> bez konce'), false, 'an unbalanced <div> reached the document');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp;amp; spánek'));
  assert.ok(html.includes('&quot;takto&quot;'));
  assert.ok(html.includes('&#39;takto&#39;'));
  assert.ok(html.includes('&lt;b&gt;Jana&lt;/b&gt; Nováková &amp; spol.'));
  assert.ok(html.includes('Vzorek &lt; 30 lidí &amp; jen jedno město.'));
});

test('§4.3 preprint notice appears when and only when the paper is a preprint', () => {
  const preprint = renderDayPage(
    makeDigest({
      entries: [
        makeEntry({ candidate: { isPreprint: true, venue: 'arXiv', source: 'arxiv', doi: null } }),
      ],
    }),
    config,
  );
  const peerReviewed = renderDayPage(makeDigest({ entries: [makeEntry()] }), config);

  assert.ok(preprint.includes('zatím neprošlo recenzním řízením'));
  assert.equal(peerReviewed.includes('zatím neprošlo recenzním řízením'), false);

  // §7.6 — a preprint's block 6 names the server, a journal paper's the journal.
  assert.ok(preprint.includes(stringsCs.refPreprintServer));
  assert.equal(preprint.includes(`<dt>${stringsCs.refJournal}</dt>`), false);
  assert.ok(peerReviewed.includes(stringsCs.refJournal));
});

test('a paper without a DOI renders the defined alternative, not an empty link', () => {
  const html = renderDayPage(
    makeDigest({
      entries: [
        makeEntry({
          candidate: { doi: null, openAlexId: null, oaPdfUrl: null, url: 'https://arxiv.org/abs/2608.16889' },
        }),
      ],
    }),
    config,
  );
  assert.ok(html.includes(stringsCs.refDoiMissing));
  assert.equal(html.includes('href=""'), false);
  assert.equal(html.includes('undefined'), false);
  assert.ok(anchorHrefs(html).includes('https://arxiv.org/abs/2608.16889'));
  // No OpenAlex or PDF row when there is nothing to link to.
  assert.equal(html.includes(stringsCs.refOpenAlex), false);
  assert.equal(html.includes(stringsCs.refOpenAccessPdf), false);
});

test('a DOI field holding something that is not a DOI does not become a dead link', () => {
  const html = renderDayPage(
    makeDigest({ entries: [makeEntry({ candidate: { doi: 'n/a' } })] }),
    config,
  );
  assert.ok(html.includes(stringsCs.refDoiMissing));
  assert.equal(html.includes('doi.org/n/a'), false);
});

test('a javascript: URL from a source record never becomes a link', () => {
  const html = renderDayPage(
    makeDigest({
      entries: [makeEntry({ candidate: { url: 'javascript:alert(1)', oaPdfUrl: 'data:text/html,<b>x' } })],
    }),
    config,
  );
  assert.equal(/javascript:/i.test(html), false);
  assert.equal(/data:text\/html/i.test(html), false);
});

test('§3 shortfall notice renders when present and is absent when not', () => {
  const short = renderDayPage(
    makeDigest({
      entryCount: 3,
      shortfall: { expected: 5, produced: 3, reason: 'only 3 candidates survived filtering' },
    }),
    config,
  );
  const full = renderDayPage(makeDigest({ entryCount: 5 }), config);

  assert.ok(short.includes(stringsCs.shortfallHeading));
  assert.ok(short.includes('jen 3 studie'));
  // The pipeline's own reason string is for the log, not for the reader.
  assert.equal(short.includes('only 3 candidates survived filtering'), false);
  assert.equal(full.includes(stringsCs.shortfallHeading), false);
});

test('§9 degradation notices render in the footer, one plain sentence per source', () => {
  const degraded = renderDayPage(
    makeDigest({
      degradations: [makeDegradation('semantic-scholar'), makeDegradation('arxiv')],
    }),
    config,
  );
  const healthy = renderDayPage(makeDigest(), config);

  assert.ok(degraded.includes(stringsCs.degradationHeading));
  assert.ok(degraded.includes(stringsCs.degradationSemanticScholar));
  assert.ok(degraded.includes(stringsCs.degradationArxiv));
  assert.equal(degraded.includes(stringsCs.degradationOpenAlex), false);
  assert.ok(degraded.indexOf('<footer>') < degraded.indexOf(stringsCs.degradationHeading));

  assert.equal(healthy.includes(stringsCs.degradationHeading), false);
  assert.equal(healthy.includes(stringsCs.degradationSemanticScholar), false);
});

test('the page names the day and the category, and declares the configured language', () => {
  const html = renderDayPage(makeDigest({ date: '2026-08-19' }), config);
  assert.ok(html.startsWith('<!doctype html>\n<html lang="cs">'));
  assert.ok(html.includes('<title>Psychologie a chování – 19. srpna 2026 – Research Desk</title>'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<time datetime="2026-08-19">19. srpna 2026</time>'));
  assert.ok(html.includes('Psychologie a chování'));
});

test('papers render in the digest order, numbered for a phone reader', () => {
  const digest = makeDigest({
    entries: [
      makeEntry({ candidate: { index: 1 }, summary: { souhrn: 'První studie' } }),
      makeEntry({ candidate: { index: 2 }, summary: { souhrn: 'Druhá studie' } }),
    ],
  });
  const html = renderDayPage(digest, config);
  assert.ok(html.indexOf('První studie') < html.indexOf('Druhá studie'));
  assert.ok(html.includes('Studie 1 z 2'));
  assert.ok(html.includes('Studie 2 z 2'));
});

/**
 * RISK-HTML-03, as far as static analysis reaches. A real 390px phone check
 * still needs a browser and a pair of eyes — this only rules out the mistakes
 * that are visible in the stylesheet: a container wider than the screen, text
 * that refuses to wrap, and a missing viewport tag.
 */
test('nothing in the stylesheet can force a 390px screen to scroll sideways', () => {
  const html = renderDayPage(makeDigest(), config);
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));

  const css = styleBlocks(html).join('\n');
  const pixelWidths = [...css.matchAll(/(?:^|[\s;{])(?:max-|min-)?width\s*:\s*([\d.]+)px/gi)].map(
    (match) => Number(match[1]),
  );
  for (const width of pixelWidths) {
    assert.ok(width <= 390, `a fixed width of ${width}px is wider than a 390px phone`);
  }
  assert.equal(/white-space\s*:\s*nowrap/i.test(css), false, 'body text must be allowed to wrap');
  assert.ok(/overflow-wrap\s*:\s*break-word/i.test(css), 'long DOIs must wrap');
  assert.ok(/max-width\s*:\s*[\d.]+rem/i.test(css), 'the text column is capped in rem, not px');
});
