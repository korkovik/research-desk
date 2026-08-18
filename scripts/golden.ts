/**
 * Shared plumbing for the §7.4 golden set (DESIGN-NOTES C.7).
 *
 * The ten fixtures are the only thing in this project that can answer "does the
 * verifier actually reject a fabrication?" — the offline tests prove the code
 * acts correctly on a verdict, not that the verdict is right. So the fixtures
 * are loaded, rendered and scored in one place, used by two harnesses:
 *
 *   scripts/qa-live-verifier.ts   sends them to the real API (needs a key)
 *   scripts/qa-golden-adjudicate.ts  scores responses captured any other way
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { VerificationSchema, type VerificationPayload } from '../src/summarise/schema.js';
import { adjudicate } from '../src/summarise/verify.js';
import type { SourceText } from '../src/summarise/verify.js';

export const FixtureSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.object({
    title: z.string(),
    abstract: z.string(),
    tldr: z.string().nullable(),
    venue: z.string(),
    type: z.string(),
    date: z.string(),
  }),
  candidateExample: z.string(),
  isMotivationFallback: z.boolean(),
  expected: z.object({
    finalVerdict: z.enum(['supported', 'unsupported']),
    mustFlagSpans: z.array(z.string()),
    mustHaveAtLeastOneSupportedClaim: z.boolean(),
    note: z.string(),
  }),
});

export type Fixture = z.infer<typeof FixtureSchema>;

export function loadFixtures(dir = 'test/fixtures/verification'): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => FixtureSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

export function sourceOf(fixture: Fixture): SourceText {
  return { ...fixture.source };
}

export interface Grade {
  id: string;
  label: string;
  expected: 'supported' | 'unsupported';
  actual: 'supported' | 'unsupported';
  modelVerdict: 'supported' | 'unsupported';
  pass: boolean;
  /** Why it failed, in the order the assertions are checked. */
  problems: string[];
  coverage: number;
  fabricatedQuote: boolean;
}

/**
 * The four assertions of DESIGN-NOTES C.7. Assertion 3 is the one that matters
 * most: a verifier that rejects everything scores 5/10 on verdicts alone and
 * looks half-working, so every fabricated fixture must ALSO come back with at
 * least one genuinely supported claim.
 */
export function grade(fixture: Fixture, payload: VerificationPayload): Grade {
  const report = adjudicate(payload, fixture.candidateExample, sourceOf(fixture));
  const problems: string[] = [];

  if (report.verdict !== fixture.expected.finalVerdict) {
    problems.push(`verdict ${report.verdict}, expected ${fixture.expected.finalVerdict}`);
  }

  if (fixture.expected.finalVerdict === 'unsupported') {
    for (const span of fixture.expected.mustFlagSpans) {
      const flagged = payload.claims.some(
        (c) => c.verdict === 'unsupported' && overlaps(c.exampleSpan, span),
      );
      if (!flagged) problems.push(`did not flag the fabricated span: "${truncate(span)}"`);
    }
    if (fixture.expected.mustHaveAtLeastOneSupportedClaim) {
      const supported = payload.claims.filter((c) => c.verdict === 'supported').length;
      if (supported === 0) {
        problems.push('rejected every claim — a reject-everything verifier is not a working one');
      }
    }
  } else if (report.fabricatedQuote) {
    problems.push('invented a quote even though a real one exists in the source');
  }

  return {
    id: fixture.id,
    label: fixture.label,
    expected: fixture.expected.finalVerdict,
    actual: report.verdict,
    modelVerdict: report.modelVerdict,
    pass: problems.length === 0,
    problems,
    coverage: report.coverage,
    fabricatedQuote: report.fabricatedQuote,
  };
}

/** Spans match loosely: the verifier may split a sentence differently than we did. */
function overlaps(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x.includes(y) || y.includes(x);
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function report(grades: Grade[]): number {
  let passed = 0;
  for (const g of grades) {
    const mark = g.pass ? 'PASS' : 'FAIL';
    console.log(
      `${mark}  ${g.id}  expected=${g.expected.padEnd(11)} got=${g.actual.padEnd(11)} ` +
        `model=${g.modelVerdict.padEnd(11)} coverage=${(g.coverage * 100).toFixed(0)}%  ${g.label}`,
    );
    for (const problem of g.problems) console.log(`        - ${problem}`);
    if (g.pass) passed += 1;
  }
  const fabricated = grades.filter((g) => g.expected === 'unsupported' && g.actual === 'supported');
  const overCautious = grades.filter((g) => g.expected === 'supported' && g.actual === 'unsupported');
  console.log(`\n${passed}/${grades.length} fixtures passed.`);
  console.log(`  fabrications let through: ${fabricated.length} (must be 0)`);
  console.log(`  genuine examples wrongly rejected: ${overCautious.length} (must be 0)`);
  const drift = grades.filter((g) => g.modelVerdict !== g.actual).length;
  console.log(`  model verdict disagreed with the code's: ${drift}/${grades.length}`);
  return passed;
}

export { VerificationSchema };
