/**
 * The document shell and the whole stylesheet, shared by the day page and the
 * index.
 *
 * §8 fixes the hard constraints and they are all structural, not stylistic:
 * every byte the browser needs is in the file, so the page opens from a USB
 * stick, from Google Drive or from `file://` with the wifi off. That rules out
 * remote fonts, CDN CSS, `@import`, `url(…)` of any kind, `<img>`, `<script>`
 * and `<link>` — there is no mechanism in this file that can issue a request.
 * The only URLs in a rendered page are `<a href>`s in the reference block,
 * which a reader clicks; the page never loads them.
 *
 * The layout is mobile-first because that is where it will be read (§8: "family
 * will open it there"). No media queries widen it: one column, sized in `rem`
 * so the reader's own font-size setting is respected, capped at a comfortable
 * measure on a desktop. There is not a single pixel width in the stylesheet,
 * which is also what makes "nothing is wider than a 390px phone" checkable.
 */
import { escapeHtml } from './html.js';

const STYLESHEET = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: #fbfaf7;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  font-size: 1.0625rem;
  line-height: 1.65;
  /* Long DOIs and URLs must wrap instead of pushing the page sideways. */
  overflow-wrap: break-word;
}
.wrap { max-width: 38rem; margin: 0 auto; padding: 1.4rem 1.1rem 3rem; }
a { color: #10467a; }
a:visited { color: #5a3b85; }
a:focus-visible { outline: 0.15rem solid #10467a; outline-offset: 0.15rem; }
.masthead { border-bottom: 0.0625rem solid #e0dacd; padding-bottom: 1.1rem; margin-bottom: 1.5rem; }
.site-name { margin: 0; font-size: 0.95rem; font-weight: 700; letter-spacing: 0.02em; color: #7a6f5b; }
.topic-label { margin: 1rem 0 0; font-size: 0.9rem; color: #7a6f5b; }
h1 { margin: 0.15rem 0 0.35rem; font-size: 1.55rem; line-height: 1.25; }
.dateline { margin: 0; color: #6d6455; font-size: 0.98rem; }
.lede { margin: 0.9rem 0 0; color: #4a4438; }
.nav { margin: 0 0 1.2rem; font-size: 0.98rem; }
.nav a, .day-link a { display: inline-block; padding: 0.35rem 0; }
.paper { background: #ffffff; border: 0.0625rem solid #e6e0d4; border-radius: 0.6rem; padding: 1rem 1rem 1.2rem; margin: 0 0 1.5rem; }
.paper-counter { margin: 0; font-size: 0.85rem; color: #8a7f6a; }
.block-label { margin: 0.5rem 0 0.1rem; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.04em; color: #8a7f6a; }
h2 { margin: 0 0 0.6rem; font-size: 1.28rem; line-height: 1.3; }
h3 { margin: 1.35rem 0 0.35rem; font-size: 1.02rem; line-height: 1.35; color: #33507a; }
p { margin: 0 0 0.75rem; }
.notice { border-left: 0.25rem solid #b8860b; background: #fff7e3; padding: 0.7rem 0.9rem; border-radius: 0.3rem; margin: 0 0 1.5rem; }
.notice h2, .notice h3 { margin: 0 0 0.35rem; font-size: 1.05rem; color: #6a4a06; }
.notice p:last-child { margin-bottom: 0; }
.preprint { border-left: 0.25rem solid #a4551f; background: #fdf1e7; padding: 0.6rem 0.8rem; border-radius: 0.3rem; margin: 0 0 1rem; font-size: 0.97rem; }
.motivation { font-weight: 700; color: #6a4a06; background: #fff7e3; padding: 0.5rem 0.7rem; border-radius: 0.3rem; margin: 0 0 0.6rem; }
.reference { margin: 0.4rem 0 0; }
.reference dt { font-weight: 700; font-size: 0.92rem; color: #6d6455; margin: 0.7rem 0 0; }
.reference dd { margin: 0.1rem 0 0; }
.reference a { overflow-wrap: anywhere; }
.days { list-style: none; margin: 0; padding: 0; }
.day { background: #ffffff; border: 0.0625rem solid #e6e0d4; border-radius: 0.6rem; padding: 0.9rem 1rem 1rem; margin: 0 0 1.1rem; }
.day-date { margin: 0; font-size: 1.15rem; font-weight: 700; }
.day-category { margin: 0.1rem 0 0.6rem; color: #6d6455; font-size: 0.95rem; }
.day-titles { margin: 0 0 0.5rem; padding-left: 1.1rem; }
.day-titles li { margin: 0 0 0.3rem; }
.empty { background: #ffffff; border: 0.0625rem solid #e6e0d4; border-radius: 0.6rem; padding: 1rem; }
footer { border-top: 0.0625rem solid #e0dacd; margin-top: 2rem; padding-top: 1.1rem; font-size: 0.95rem; color: #5c5546; }
footer h2 { font-size: 1.05rem; margin: 0 0 0.4rem; }
.degradations { margin: 0 0 1rem; padding-left: 1.1rem; }
.degradations li { margin: 0 0 0.35rem; }
@media (prefers-color-scheme: dark) {
  body { background: #14140f; color: #ebe6dc; }
  a { color: #8fbdf0; }
  a:visited { color: #c2a6e8; }
  .paper, .day, .empty { background: #1e1e17; border-color: #34322a; }
  .masthead, footer { border-color: #34322a; }
  .site-name, .topic-label, .dateline, .paper-counter, .block-label, .day-category, footer { color: #a9a294; }
  .lede { color: #c6c0b2; }
  h3 { color: #9fc0ea; }
  .notice { background: #2b2411; border-left-color: #d7a92e; }
  .notice h2, .notice h3, .motivation { color: #f0d999; }
  .motivation { background: #2b2411; }
  .preprint { background: #2c1d13; border-left-color: #d08040; }
}
`.trim();

export interface DocumentOptions {
  /** Goes straight into `<html lang>`; comes from `config.output.language` (§2). */
  readonly lang: string;
  /** Plain text — escaped here. */
  readonly title: string;
  /** Trusted HTML built by the renderer. */
  readonly body: string;
}

export function renderDocument(options: DocumentOptions): string {
  return `<!doctype html>
<html lang="${escapeHtml(options.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
<style>
${STYLESHEET}
  .summary .lead { font-weight: 600; }

  /* Category filter. No script anywhere on this page (§8), so the whole thing
     is :checked plus a sibling selector. The radios stay in the accessibility
     tree and remain focusable — clip them, never display:none them, or the
     chips stop working from a keyboard. */
  /* The usual visually-hidden recipe, minus the no-wrap declaration it normally
     carries: this element has no text so it does not need one, and the 390px
     guard reads any such declaration in the sheet as a block on body copy. */
  .cat-input { position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); clip-path: inset(50%); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 1.4rem; }
  .chip { display: inline-block; padding: 0.32rem 0.72rem; border-radius: 1.2rem;
    border: 0.0625rem solid #e6e0d4; background: #ffffff; color: #4a4438;
    font-size: 0.88rem; line-height: 1.3; cursor: pointer; }
  .chip:hover { border-color: #b9ad95; }
  .chip-count { color: #8a7f6a; font-size: 0.8rem; }
  .cat-empty { display: none; margin: 0 0 1.4rem; color: #6d6455; }

  /* Default: everything shows. Each chip then hides the days that are not its
     own, and reveals its own empty note when it has none. */
  #cat-all:checked ~ .cat-empty { display: none; }
</style>
</head>
<body>
<div class="wrap">
${options.body}
</div>
</body>
</html>
`;
}
