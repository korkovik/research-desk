/**
 * Runs the §7.4 golden set against the REAL Anthropic API.
 *
 * This is the script that closes the project's biggest open gap. Until it has
 * been run and passed, the claim "the verifier can genuinely reject a
 * fabricated example" is unproven — the offline suite proves the pipeline acts
 * correctly on a verdict, not that the verdict is right.
 *
 *   ANTHROPIC_API_KEY=… npm run qa:live-verifier
 *
 * Cost: 10 calls (20 with --challenge), a few cents. Run it after any change to
 * the verifier prompt or the model version, and paste the output into
 * docs/HANDOVER.md.
 */
import { loadEnvFile, readSecrets } from '../src/env.js';
import { AnthropicLlmClient, estimateCostUsd } from '../src/summarise/client.js';
import { VERIFIER_SYSTEM_PROMPT, renderVerifierUserMessage } from '../src/summarise/prompt.js';
import { VerificationSchema } from '../src/summarise/schema.js';
import { verifyExample } from '../src/summarise/verify.js';
import { loadFixtures, sourceOf, grade, report } from './golden.js';
import { loadConfig } from '../src/config.js';

const repoRoot = new URL('..', import.meta.url).pathname;
loadEnvFile(repoRoot);
const secrets = readSecrets();
if (secrets.anthropicApiKey === null) {
  console.error(
    'ANTHROPIC_API_KEY is not set. Put it in .env.local (see .env.example) and run again.',
  );
  process.exit(78);
}

const config = loadConfig(repoRoot);
const withChallenge = process.argv.includes('--challenge');
const llm = new AnthropicLlmClient(secrets.anthropicApiKey);
const only = process.argv.filter((a) => /^GT-\d+$/i.test(a)).map((a) => a.toUpperCase());
const fixtures = loadFixtures().filter((f) => only.length === 0 || only.includes(f.id));

console.log(
  `Golden set: ${fixtures.length} fixtures, model ${config.verification.model}, ` +
    `challenge pass ${withChallenge ? 'ON' : 'off'}\n`,
);

const grades = [];
const errors: string[] = [];
for (const fixture of fixtures) {
  // The single call is made directly rather than through `verifyExample`, so the
  // raw payload can be graded against the fixture's expectations claim by claim.
  //
  // One fixture's failure must not discard the other eleven. The first live run
  // of this script died on GT-12 and threw away the spend on GT-01..GT-11 with
  // it, because nothing was printed until the summary at the end.
  let response;
  try {
    response = await llm.complete({
      system: VERIFIER_SYSTEM_PROMPT,
      user: renderVerifierUserMessage(sourceOf(fixture), fixture.candidateExample),
      schema: VerificationSchema,
      model: config.verification.model,
      maxTokens: config.verification.maxTokens,
      effort: config.verification.effort,
      cacheSystem: true,
      label: `golden-${fixture.id}`,
    });
  } catch (error) {
    const message = `${fixture.id}: call failed — ${(error as Error).message}`;
    console.log(`  ERROR  ${message}`);
    errors.push(message);
    continue;
  }
  const g = grade(fixture, response.value);
  console.log(
    `  ${g.pass ? 'pass' : 'FAIL'}  ${g.id}  expected=${g.expected.padEnd(11)} ` +
      `got=${g.actual.padEnd(11)} model=${g.modelVerdict.padEnd(11)} ${g.label}`,
  );
  grades.push(g);

  if (withChallenge) {
    const full = await verifyExample(llm, fixture.candidateExample, sourceOf(fixture), {
      model: config.verification.model,
      effort: config.verification.effort,
      maxTokens: config.verification.maxTokens,
      challengePass: true,
    });
    console.log(`      challenge-pass verdict for ${fixture.id}: ${full.verdict}`);
  }
}

const passed = report(grades);
const usage = llm.totalUsage();
const cost = estimateCostUsd(usage, config.verification.model);
console.log(
  `\nTokens: ${usage.inputTokens} in (+${usage.cacheReadTokens} cached), ` +
    `${usage.outputTokens} out${cost === null ? '' : ` — about $${cost.toFixed(3)}`}`,
);

if (errors.length > 0) {
  console.log(`\n${errors.length} fixture(s) never returned a verdict:`);
  for (const message of errors) console.log(`  - ${message}`);
}

// DESIGN-NOTES C.7: a clean sweep is the gate. Anything less blocks a prompt
// change — and a fixture that errored is not a pass.
process.exit(passed === fixtures.length && errors.length === 0 ? 0 : 1);
