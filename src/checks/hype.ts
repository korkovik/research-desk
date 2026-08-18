/**
 * A.1 — the hype check. §2: "No hype. No 'revolutionary', 'breakthrough',
 * 'game-changing'."
 *
 * Scope (A.0 block table): all five prose blocks plus the free-text limitation
 * note. The structured fields of block 6 are never checked.
 */
import type { StyleConfig } from '../config.js';
import {
  compileEntries,
  HYPE_CS_HARD,
  HYPE_CS_WARN,
  HYPE_EN_HARD,
  HYPE_EN_WARN,
  type CompiledEntry,
  type LexEntry,
} from './lexicons.cs.js';
import { lowerForMatching, mask, type MaskSpan } from './text.js';
import type { BlockName, Finding } from './types.js';

const CS_ENTRIES: readonly CompiledEntry[] = compileEntries([...HYPE_CS_HARD, ...HYPE_CS_WARN]);
const EN_ENTRIES: readonly CompiledEntry[] = compileEntries([...HYPE_EN_HARD, ...HYPE_EN_WARN]);

/** Everything the checker knows, exposed so a test can assert the list is complete. */
export const HYPE_ENTRIES: readonly LexEntry[] = [
  ...HYPE_CS_HARD,
  ...HYPE_CS_WARN,
  ...HYPE_EN_HARD,
  ...HYPE_EN_WARN,
];

export function checkHype(block: BlockName, text: string, config: StyleConfig): Finding[] {
  const lowered = lowerForMatching(text);

  // A.1.3: the English leak list is matched only OUTSIDE parenthesised spans,
  // because §2 requires the English original in parentheses on first use and
  // `state-of-the-art` may legitimately appear there as a term being glossed.
  // Czech hype gets no such exemption — a Czech gloss reading "(tedy naprosto
  // revoluční objev)" is still hype.
  const withParensMasked = mask(lowered, { parens: true });

  const raw: Finding[] = [
    ...run(CS_ENTRIES, block, text, lowered, lowered, [], config),
    ...run(EN_ENTRIES, block, text, lowered, withParensMasked.text, withParensMasked.spans, config),
  ];

  return resolveSeverity(raw);
}

function run(
  entries: readonly CompiledEntry[],
  block: BlockName,
  original: string,
  lowered: string,
  haystack: string,
  masked: readonly MaskSpan[],
  config: StyleConfig,
): Finding[] {
  void masked;
  const out: Finding[] = [];
  for (const entry of entries) {
    // A caseSensitive entry matches the original text; everything else matches
    // the length-preserving lower-cased copy, so offsets are identical either way.
    const subject = entry.caseSensitive === true ? original : haystack;
    entry.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = entry.re.exec(subject)) !== null) {
      if (m[0].length === 0) {
        entry.re.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!guardPasses(entry, lowered, end, config)) continue;
      out.push({
        check: 'hype',
        severity: entry.severity,
        block,
        span: { start, end },
        matchedText: original.slice(start, end),
        rule: `hype:${entry.id}`,
        messageCs: hypeMessageCs(original.slice(start, end), entry.severity),
      });
    }
  }
  return out;
}

/**
 * A.1.1 #36 / A.1.2 #37. The guard reads the `config.style.hype.guardWindowChars`
 * characters that follow the hit — 20 by default, which is one Czech word plus
 * its space.
 */
function guardPasses(entry: CompiledEntry, lowered: string, end: number, config: StyleConfig): boolean {
  if (!entry.guard) return true;
  const window = lowered.slice(end, end + (entry.guard.withinChars || config.hype.guardWindowChars));
  const hit = new RegExp(entry.guard.pattern, 'u').test(window);
  return entry.guard.mode === 'require' ? hit : !hit;
}

/**
 * A.1.4. Where a hard entry and a warn entry match the same span — `zlomov` is
 * both, and so is `průlom` — the hard one wins and the warn one is dropped, so
 * one word never spends two lines of the regeneration prompt.
 */
function resolveSeverity(findings: readonly Finding[]): Finding[] {
  const byStart = new Map<number, Finding[]>();
  for (const f of findings) {
    const bucket = byStart.get(f.span.start);
    if (bucket) bucket.push(f);
    else byStart.set(f.span.start, [f]);
  }
  const kept: Finding[] = [];
  for (const bucket of byStart.values()) {
    const hard = bucket.filter((f) => f.severity === 'hard');
    kept.push(...(hard.length > 0 ? hard : bucket));
  }
  return kept.sort((a, b) => a.span.start - b.span.start);
}

/**
 * A.1.4's example message, generalised. Czech written by the implementer — see
 * the handover note; it goes verbatim into the regeneration prompt, so a native
 * speaker should read it before this ships.
 */
export function hypeMessageCs(matched: string, severity: 'hard' | 'warn'): string {
  return severity === 'hard'
    ? `Slovo „${matched}“ je zakázané (pravidlo §2, žádná senzacechtivost). Napište místo něj konkrétně, co se změnilo.`
    : `Slovo „${matched}“ zbytečně přehání (pravidlo §2). Zvažte střízlivější formulaci, nebo doplňte konkrétní číslo či příklad.`;
}
