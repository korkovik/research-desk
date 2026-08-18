#!/usr/bin/env node
/**
 * The entry point. Three commands, and a deliberate refusal to be clever: the
 * 06:00 launchd job runs `run`, and everything it needs — config, credentials,
 * paths — is established here, not inherited from a shell it does not have.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { loadEnvFile, readSecrets } from './env.js';
import { createLogger } from './util/log.js';
import { regenerateIndex } from './render/index.js';
import { runDay } from './run.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `research-desk <command>

  run [--dry-run] [--date YYYY-MM-DD]   one daily run (§3)
  reindex                               rebuild index.html from the archive's JSON twins
  help

Credentials come from .env.local in the repository root; see .env.example.
Exit codes: 0 published, 1 aborted for an expected reason (too few candidates,
a source outage), 2 aborted for an unexpected one (bad config, filesystem).`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  const logger = createLogger();
  const env = loadEnvFile(repoRoot);
  if (env.file !== null) {
    // Names only. A value is never logged, and the shadowed list is what tells
    // you an exported variable — not the file — is the one in force.
    logger.info(`env: read ${env.file} (${env.applied.join(', ') || 'nothing applied'})`);
    if (env.shadowed.length > 0) {
      logger.warn(`env: already set in the environment, file entry ignored: ${env.shadowed.join(', ')}`);
    }
  } else {
    logger.warn('env: no .env.local found — running with whatever the environment provides');
  }

  const config = loadConfig(repoRoot);
  const secrets = readSecrets();

  if (command === 'reindex') {
    const result = regenerateIndex({ config, repoRoot, logger });
    logger.info(`index rebuilt: ${result.days} day(s) at ${result.path}`);
    return 0;
  }

  if (command !== 'run') {
    console.error(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const dryRun = argv.includes('--dry-run');
  const dateIndex = argv.indexOf('--date');
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : undefined;
  if (dateIndex >= 0 && date === undefined) {
    console.error('--date needs a YYYY-MM-DD value');
    return 2;
  }

  if (secrets.openAlexApiKey === null) {
    logger.warn(
      'OPENALEX_API_KEY is not set — running on the unkeyed 100-credits/day allowance. ' +
        'That is enough to smoke-test and not enough to run daily (§4.1).',
    );
  }

  const result = await runDay({
    repoRoot,
    config,
    secrets,
    logger,
    dryRun,
    ...(date === undefined ? {} : { date }),
  });
  logger.info(`run ${result.date}: ${result.outcome}`);
  return result.exitCode;
}

try {
  process.exitCode = await main();
} catch (error) {
  // Exit 2 is the scheduler's signal that something is broken rather than
  // merely quiet — DESIGN-NOTES D.8. A quiet news week is a 1; this is not that.
  console.error(`[fatal] ${(error as Error).message}`);
  if (process.env.RESEARCH_DESK_DEBUG) console.error(error);
  process.exitCode = 2;
}
