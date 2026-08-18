/**
 * Scores captured verifier responses against the golden set.
 *
 * Reads `<dir>/gt-NN.json`, each holding one `VerificationResult` payload, and
 * runs them through the same `adjudicate` the production pipeline uses. Use it
 * with `render-golden-prompts` when no API key is available.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VerificationSchema } from '../src/summarise/schema.js';
import { loadFixtures, grade, report } from './golden.js';

const dir = process.argv[2] ?? 'tmp/golden-responses';
const fixtures = loadFixtures();
const grades = [];
const missing: string[] = [];

for (const fixture of fixtures) {
  const path = join(dir, `${fixture.id.toLowerCase()}.json`);
  if (!existsSync(path)) {
    missing.push(fixture.id);
    continue;
  }
  const parsed = VerificationSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    // A schema violation is itself a result: the production path treats an
    // unparseable verifier response as `unsupported` (DESIGN-NOTES C.6).
    console.log(`FAIL  ${fixture.id}  response did not match the schema: ${parsed.error.issues[0]?.message}`);
    continue;
  }
  grades.push(grade(fixture, parsed.data));
}

if (missing.length > 0) console.log(`(no response captured for: ${missing.join(', ')})\n`);
const passed = report(grades);
process.exit(passed === fixtures.length ? 0 : 1);
