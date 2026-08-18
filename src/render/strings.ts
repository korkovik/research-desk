/**
 * Picks the language the pages are written in.
 *
 * §2: "build the pipeline so the output language is a config value, not
 * hardcoded strings". The renderer never imports `strings.cs.ts`; it asks here
 * for `config.output.language`. Shipping English later is a new `strings.en.ts`
 * plus one line in the registry below — no renderer change.
 */
import type { StringTable } from './stringTable.js';
import { stringsCs } from './strings.cs.js';

const TABLES: Readonly<Record<string, StringTable>> = {
  cs: stringsCs,
};

/** The languages this build can actually render, for error messages and tests. */
export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(TABLES);

/**
 * Throws rather than falling back to Czech: a config that asks for a language
 * we cannot write would otherwise publish a page in the wrong language to an
 * audience that cannot read it, which is worse than not publishing (§9 —
 * fail visibly).
 */
export function stringsFor(language: string): StringTable {
  const table = TABLES[language];
  if (!table) {
    throw new Error(
      `no string table for output.language="${language}"; available: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
  return table;
}

export type { StringTable };
