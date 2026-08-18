/**
 * Writes the exact prompts the verifier would receive, one file per fixture.
 *
 * It exists so the golden set can be exercised without an Anthropic key: the
 * rendered prompt can be given to a Claude model through any other channel, its
 * JSON answer dropped into `--out`, and `qa-golden-adjudicate` will score it
 * with the same code the production path uses. That is a weaker proof than
 * `qa:live-verifier` — a different transport, no cache, no structured-output
 * enforcement — and the handover says so. It is not nothing, though: it tests
 * the prompt, which is the part a key would not improve.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERIFIER_SYSTEM_PROMPT, renderVerifierUserMessage } from '../src/summarise/prompt.js';
import { loadFixtures, sourceOf } from './golden.js';

const outDir = process.argv[2] ?? 'tmp/golden-prompts';
mkdirSync(outDir, { recursive: true });

for (const fixture of loadFixtures()) {
  const body = [
    '===== SYSTEM PROMPT =====',
    VERIFIER_SYSTEM_PROMPT,
    '',
    '===== USER MESSAGE =====',
    renderVerifierUserMessage(sourceOf(fixture), fixture.candidateExample),
  ].join('\n');
  writeFileSync(join(outDir, `${fixture.id.toLowerCase()}.txt`), `${body}\n`, 'utf8');
}
console.log(`rendered prompts for the golden set into ${outDir}`);
