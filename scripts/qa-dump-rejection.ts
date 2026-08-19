/**
 * One-off evidence dump: run ONE golden fixture through the real verifier and
 * print the whole exchange — the Czech on trial, every claim the model made,
 * and the verdict the code computed from them. `qa-live-verifier` prints a
 * scoreboard; this prints the rejection itself.
 *
 *   npx tsx scripts/qa-dump-rejection.ts GT-06
 */
import { loadEnvFile, readSecrets } from '../src/env.js';
import { AnthropicLlmClient, estimateCostUsd } from '../src/summarise/client.js';
import { VERIFIER_SYSTEM_PROMPT, renderVerifierUserMessage } from '../src/summarise/prompt.js';
import { VerificationSchema } from '../src/summarise/schema.js';
import { adjudicate } from '../src/summarise/verify.js';
import { loadFixtures, sourceOf } from './golden.js';
import { loadConfig } from '../src/config.js';

const repoRoot = new URL('..', import.meta.url).pathname;
loadEnvFile(repoRoot);
const secrets = readSecrets();
if (secrets.anthropicApiKey === null) process.exit(78);

const wanted = (process.argv[2] ?? 'GT-06').toUpperCase();
const config = loadConfig(repoRoot);
const fixture = loadFixtures().find((f) => f.id === wanted);
if (!fixture) throw new Error(`no fixture ${wanted}`);

const llm = new AnthropicLlmClient(secrets.anthropicApiKey);
const source = sourceOf(fixture);
const response = await llm.complete({
  system: VERIFIER_SYSTEM_PROMPT,
  user: renderVerifierUserMessage(source, fixture.candidateExample),
  schema: VerificationSchema,
  model: config.verification.model,
  maxTokens: config.verification.maxTokens,
  effort: config.verification.effort,
  cacheSystem: true,
  label: `dump-${fixture.id}`,
});

const payload = response.value;
console.log(`FIXTURE ${fixture.id} — ${fixture.label}`);
console.log(`SOURCE  ${source.title}\n`);
console.log('THE CZECH EXAMPLE ON TRIAL ("Příklad ze života"):');
console.log(fixture.candidateExample.replace(/^/gm, '  '));
console.log(`\nMODEL'S OWN VERDICT (recorded, not trusted): ${payload.modelOverallVerdict}`);
console.log("MODEL'S REASONS, in Czech, as the reader-facing pipeline would see them:");
for (const r of payload.unsupportedReasonsCs) console.log(`  · ${r}`);
console.log('\nPER-CLAIM:');
for (const c of payload.claims) {
  console.log(`  [${c.id}] ${c.verdict.toUpperCase()}  type=${c.claimType}`);
  console.log(`      czech span : "${c.exampleSpan}"`);
  console.log(`      claim (en) : ${c.claimText}`);
  console.log(`      quote      : ${c.sourceQuote ? `"${c.sourceQuote}" (${c.quoteField})` : '— none —'}`);
}

const report = adjudicate(payload, fixture.candidateExample, source);
console.log(`\nCODE'S ADJUDICATED VERDICT: ${report.verdict}`);
console.log(`CODE-SIDE RULES THAT FIRED: ${report.failures.map((f) => `${f.code}${f.claimId ? `(${f.claimId})` : ''}`).join(', ') || '(none)'}`);
for (const f of report.failures) console.log(`  - ${f.code}: ${f.detail}`);
const usage = llm.totalUsage();
console.log(`\nTokens: ${usage.inputTokens} in, ${usage.outputTokens} out — about $${(estimateCostUsd(usage, config.verification.model) ?? 0).toFixed(3)}`);
