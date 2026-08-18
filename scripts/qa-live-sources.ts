/**
 * Probes all three source APIs once each and reports what came back.
 *
 * This is the evidence for §11's acceptance checks 2, 4 and 5 that fixtures
 * cannot give: that the filters are accepted as constructed, that a real
 * seven-day window actually contains ten or more candidates, and that the
 * Semantic Scholar pacing survives contact with the real rate limiter.
 *
 *   npm run qa:live-sources
 *
 * COST: exactly one OpenAlex list query (10 credits of the 100/day unkeyed
 * allowance, or of 100,000 with a key), one arXiv query, and a handful of
 * Semantic Scholar lookups at the mandatory 1.1 s spacing. Do not run it in a
 * loop while the key is missing.
 */
import { loadConfig, categoryForWeekday } from '../src/config.js';
import { loadEnvFile, readSecrets } from '../src/env.js';
import { createLogger } from '../src/util/log.js';
import { adaptersForCategory } from '../src/adapters/registry.js';
import { enrichWithTldr } from '../src/enrich/semanticScholar.js';
import { localDateISO, localWeekday, shiftISODate } from '../src/util/dates.js';
import type { Candidate } from '../src/types.js';

const repoRoot = new URL('..', import.meta.url).pathname;
loadEnvFile(repoRoot);
const config = loadConfig(repoRoot);
const secrets = readSecrets();
const logger = createLogger();

const requestedWeekday = Number(process.argv[2] ?? '');
const now = new Date();
const today = localDateISO(now, config.output.timezone);
const weekday = Number.isInteger(requestedWeekday) && requestedWeekday >= 1 && requestedWeekday <= 7
  ? requestedWeekday
  : localWeekday(now, config.output.timezone);
const category = categoryForWeekday(config, weekday);
const since = shiftISODate(today, -config.windows.freshnessDays);

console.log(`\n=== ${today} · weekday ${weekday} · ${category.labelCs} · since ${since} ===`);
console.log(`OpenAlex key: ${secrets.openAlexApiKey === null ? 'ABSENT (unkeyed allowance)' : 'present'}`);
console.log(`Semantic Scholar key: ${secrets.semanticScholarApiKey === null ? 'absent' : 'present'}\n`);

const deps = { config, secrets, logger };
const all: Candidate[] = [];
let failures = 0;

for (const adapter of adaptersForCategory(category, deps)) {
  const started = Date.now();
  try {
    const candidates = await adapter.fetch(category, since);
    all.push(...candidates);
    const withDoi = candidates.filter((c) => c.doi !== null && c.doi !== undefined).length;
    const withAbstract = candidates.filter((c) => c.abstract !== null).length;
    console.log(
      `${adapter.name.padEnd(10)} ${String(candidates.length).padStart(3)} candidates ` +
        `in ${Date.now() - started}ms — ${withDoi} with a DOI, ${withAbstract} with an abstract`,
    );
    // §11 steps 2 and 4 both want at least ten.
    console.log(`           §11 threshold (>= 10): ${candidates.length >= 10 ? 'MET' : 'NOT MET'}`);
    for (const sample of candidates.slice(0, 2)) {
      console.log(`           · ${sample.date}  ${sample.title.slice(0, 78)}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`${adapter.name.padEnd(10)} FAILED — ${(error as Error).message}`);
  }
}

if (all.length > 0) {
  const sample = all.slice(0, 5);
  console.log(`\nSemantic Scholar: ${sample.length} sequential lookups at ${config.sources.semanticScholar.throttleMs}ms spacing`);
  const started = Date.now();
  const result = await enrichWithTldr(sample, { ...deps, config: { ...config, shortlist: { size: sample.length } } });
  const withTldr = result.enriched.filter((c) => c.tldr !== null).length;
  console.log(
    `           ${withTldr}/${result.enriched.length} got a TLDR in ${Date.now() - started}ms` +
      `${result.degradation === null ? '' : ` — degraded: ${result.degradation.detail}`}`,
  );
  console.log(`           rate-limited: ${result.degradation === null ? 'no' : 'YES'}`);
}

console.log(`\n${failures === 0 ? 'all sources answered' : `${failures} source(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
