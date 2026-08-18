/**
 * The internal vocabulary of the §2 style checker (DESIGN-NOTES A.0).
 *
 * `Finding` is the richer shape the design note specifies; `src/checks/index.ts`
 * flattens it into the `LanguageViolation` that the rest of the pipeline already
 * speaks. Keeping the two apart means a check module never has to know how the
 * digest JSON is shaped.
 */
import type { PaperSummary } from '../types.js';

/** The five checks of A.1–A.5. */
export type CheckName = 'hype' | 'english_sentence' | 'readability' | 'jargon' | 'number_anchor';

export type Severity = 'hard' | 'warn';

/**
 * `'all'` is used by the readability metrics, which A.3.2 computes over blocks
 * 2–5 *concatenated* — the per-block sample is too small to be stable, so an
 * aggregate finding genuinely belongs to no single block.
 */
export type BlockName = keyof PaperSummary | 'all';

export interface Span {
  start: number;
  end: number;
}

export interface Finding {
  check: CheckName;
  severity: Severity;
  block: BlockName;
  /** Char offsets into that block's own NFC-normalised text. */
  span: Span;
  matchedText: string;
  /** e.g. `hype:revoluč`, `english_sentence:mixed`, `readability:R2`. */
  rule: string;
  /** Czech, fed verbatim into the regeneration prompt (A.6). */
  messageCs: string;
}

/** A block's identity and text, as handed to a single check. */
export interface BlockText {
  name: BlockName;
  text: string;
}
