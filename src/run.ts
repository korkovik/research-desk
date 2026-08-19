/**
 * §3 — what one daily run does, in the spec's own order.
 *
 * This is the only file that knows the whole shape of a run. Everything it
 * calls is a pure function or an injectable adapter, which is why the pipeline
 * can be tested offline end to end: the orchestrator holds the decisions, the
 * modules hold the work.
 *
 * The two decisions worth reading the code for:
 *
 *   §7.4 — a paper whose everyday example cannot be traced back to the paper is
 *   removed and replaced from the ranked remainder. If no replacement is
 *   available the day publishes short, and says so. It never publishes the
 *   example anyway.
 *
 *   §9 — fewer than `minPapersToPublish` verified papers means nothing is
 *   written at all: no page, no JSON twin, no state update, and `index.html`
 *   is not touched, so a reader opening it sees yesterday's five papers. The
 *   absence of today's entry is the signal.
 */
import { resolve } from 'node:path';
import type {
  Candidate,
  DayDigest,
  Degradation,
  DigestEntry,
  EnrichedCandidate,
  ScoredCandidate,
  Shortfall,
} from './types.js';
import { categoryForWeekday, displayName, type Config } from './config.js';
import type { Secrets } from './env.js';
import { fetchCandidates } from './adapters/registry.js';
import { enrichWithTldr } from './enrich/semanticScholar.js';
import { optionsFromConfig, selectForDay } from './select/select.js';
import { admitWithinCap } from './select/diversity.js';
import { passesExplainabilityGate } from './select/score.js';
import { checkStyle } from './checks/index.js';
import { createSeenLookup, loadSeen, recordPublished, saveSeen } from './state/seen.js';
import { writeDayOutputs } from './render/archive.js';
import { stringsFor } from './render/strings.js';
import { AnthropicLlmClient, estimateCostUsd, type LlmClient } from './summarise/client.js';
import { summariseAndVerify } from './summarise/summarise.js';
import type { SourceText } from './summarise/verify.js';
import { localDateISO, localWeekday, shiftISODate } from './util/dates.js';
import { appendRunLog, summarise as summariseRunLog, type Logger, type RunLogLine } from './util/log.js';

export interface RunOptions {
  repoRoot: string;
  config: Config;
  secrets: Secrets;
  logger: Logger;
  /** Writes nothing: no archive, no index, no state. Everything else runs. */
  dryRun: boolean;
  /** Overrides the run date; otherwise the configured timezone's today. */
  date?: string;
  /** Injected by tests. */
  llm?: LlmClient;
  fetchImpl?: typeof fetch | undefined;
  now?: (() => Date) | undefined;
  /**
   * Injected by tests so the §4.2 throttle runs in simulated time. Production
   * leaves it unset and really waits 1.1 s between Semantic Scholar requests —
   * that gap is the point, and nothing in the pipeline may shorten it.
   */
  clock?: { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> } | undefined;
}

export interface RunResult {
  outcome: 'published' | 'published_degraded' | 'aborted';
  date: string;
  digest: DayDigest | null;
  /** 0 published, 1 expected abort, 2 unexpected. Mirrors DESIGN-NOTES D.8. */
  exitCode: 0 | 1 | 2;
}

/** §7.4's top-up budget: how many replacements one run will generate. */
const MAX_TOP_UPS = 2;

export async function runDay(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const { config, logger, repoRoot } = options;
  const clock = options.now ?? (() => new Date());
  const date = options.date ?? localDateISO(clock(), config.output.timezone);
  const weekday = localWeekday(new Date(`${date}T12:00:00Z`), 'UTC');
  const category = categoryForWeekday(config, weekday);
  const since = shiftISODate(date, -config.windows.freshnessDays);
  const degradations: Degradation[] = [];

  if (config.output.siteName === null) {
    // Assumption A4: the Czech-facing name is still open (§12). Saying so every
    // morning is what stops it from quietly becoming permanent.
    logger.warn('config.output.siteName is still null — pages carry the working name');
  }
  logger.info(
    `run ${date} (${category.labelCs}), window from ${since}, publishing as "${displayName(config)}"`,
  );

  // Built before the first HTTP request, not at the point of first use. Without
  // this, a run with no Anthropic key spends its OpenAlex credits and 22 seconds
  // of Semantic Scholar pacing before discovering it cannot write a word — and
  // on the unkeyed allowance those credits are a meaningful fraction of the day.
  const llm = options.llm ?? createLlmClient(options);

  const adapterDeps = {
    config,
    secrets: options.secrets,
    logger,
    fetchImpl: options.fetchImpl,
    now: options.now,
  };

  // ---- §3.2 discovery -------------------------------------------------------
  const discovery = await fetchCandidates(category, since, adapterDeps);
  degradations.push(...discovery.degradations);
  const fetched: Record<string, number> = {};
  for (const candidate of discovery.candidates) {
    fetched[candidate.source] = (fetched[candidate.source] ?? 0) + 1;
  }
  logger.info(`discovery: ${discovery.candidates.length} candidates ${JSON.stringify(fetched)}`);

  // ---- §3.3–3.4 dedup, ranking, selection -----------------------------------
  const seenPath = resolve(repoRoot, config.paths.seenState);
  const seenState = loadSeen(seenPath);
  const isSeen = createSeenLookup(seenState, date, config.windows.dedupDays);

  // §4.2: enrich only the shortlist. Ranking runs twice — once on the raw
  // candidates to find the shortlist worth spending Semantic Scholar's one
  // request per second on, then again once those have their TLDRs, because a
  // TLDR changes what the explainability heuristic can see.
  const selectOptions = optionsFromConfig(config, date, isSeen);
  const shortlisting = selectForDay(discovery.candidates.map(toUnenriched), {
    ...selectOptions,
    // Nothing has a TLDR yet, and both abstract rules accept one as a
    // substitute — so judging them here would drop the papers enrichment is
    // about to rescue. They run in full on the pass below.
    deferAbstractRules: true,
  });
  // `ranked`, not `selected`: the shortlist is "the twenty worth spending
  // Semantic Scholar's one-request-per-second on", and it must not be narrowed
  // by the explainability gate or the diversity cap here. A TLDR is exactly the
  // evidence the gate reads, so gating before enrichment would discard
  // candidates for lacking the very thing enrichment was about to give them.
  const shortlist = shortlisting.ranked.slice(0, config.shortlist.size);
  logger.info(
    `shortlist: ${shortlist.length} of ${shortlisting.ranked.length} candidates that survived §6's exclusions`,
  );

  const enrichment = await enrichWithTldr(shortlist, { ...adapterDeps, clock: options.clock });
  if (enrichment.degradation) degradations.push(enrichment.degradation);

  const selection = selectForDay(enrichment.enriched, selectOptions);
  logger.info(
    `selection: ${selection.selected.length} selected, ${selection.remainder.length} in reserve, ` +
      `exclusions ${JSON.stringify(shortlisting.exclusionCounts)}`,
  );
  if (selection.flags.diversityRelaxed) logger.warn('diversity cap was relaxed to reach the target');
  if (selection.flags.explainGateWaived) logger.warn('explainability gate was waived to reach the minimum');

  // ---- §7 summarisation, §7.4 verification ---------------------------------
  const entries: DigestEntry[] = [];
  const dropped: { id: string; reason: string; attempts: number }[] = [];
  const queue = [...selection.selected];
  const reserve = [...selection.remainder];
  let topUps = 0;

  while (queue.length > 0 && entries.length < config.output.papersPerDay) {
    // A hard ceiling on the day's spend. Each paper costs at least three calls
    // and a pathological one costs many more, so without this a single bad
    // morning could quietly cost several times a normal one — and the whole
    // point of an unattended job is that nobody is watching when it does.
    if (llm.callCount() >= config.anthropic.maxCallsPerRun) {
      logger.error(
        `call budget of ${config.anthropic.maxCallsPerRun} spent — publishing ` +
          `${entries.length} paper(s) rather than spending more`,
      );
      degradations.push({
        source: 'budget',
        message: stringsFor(config.output.language).degradationBudget,
        detail: `hit maxCallsPerRun (${config.anthropic.maxCallsPerRun})`,
      });
      break;
    }
    const candidate = queue.shift();
    if (candidate === undefined) break;
    const result = await summariseAndVerify(
      llm,
      sourceTextOf(candidate),
      { isPreprint: candidate.isPreprint === true, categoryLabel: category.labelCs },
      {
        language: config.output.language,
        model: config.summarisation.model,
        effort: config.summarisation.effort,
        maxTokens: config.summarisation.maxTokens,
        maxRegenerationAttempts: config.summarisation.maxRegenerationAttempts,
        maxExampleAttempts: config.verification.maxExampleAttempts,
        verification: {
          model: config.verification.model,
          effort: config.verification.effort,
          maxTokens: config.verification.maxTokens,
          challengePass: config.verification.challengePass,
          onWarn: (message) => logger.warn(`${candidate.id}: ${message}`),
        },
        checkStyle: (summary) => checkStyle(summary, config.style, { sourceTitle: candidate.title }),
        log: {
          info: (m) => logger.info(`${candidate.id}: ${m}`),
          warn: (m) => logger.warn(`${candidate.id}: ${m}`),
          error: (m) => logger.error(`${candidate.id}: ${m}`),
        },
      },
    );

    if (result.status === 'ok') {
      entries.push({
        candidate,
        summary: result.summary,
        verification: result.verification,
        checks: result.checks,
      });
      continue;
    }

    dropped.push({
      id: candidate.id,
      reason: result.reason,
      attempts: result.verification?.attempts ?? 0,
    });
    degradations.push(degradationForDrop(result.reason, config));

    // §7.4: replace the dropped paper rather than publish short, but only from
    // the ranked remainder — never by widening the window, reaching into
    // another category, or lowering a bar. §6's diversity cap is one of those
    // bars: a replacement must still fit under it, or a day that dropped two
    // papers could quietly publish three from one subfield. Bounded at two,
    // because a systematic failure would otherwise chew through the whole
    // remainder at two API calls a paper.
    if (topUps >= MAX_TOP_UPS) {
      logger.warn('top-up budget spent — publishing short rather than reaching further');
      continue;
    }
    const cap = selection.flags.diversityRelaxed
      ? config.ranking.relaxedMaxPerSubfield
      : config.ranking.maxPerSubfield;
    const committed = [...entries.map((e) => e.candidate), ...queue];
    // The remainder is what ranking did NOT select, which by definition includes
    // the papers the explainability gate and the diversity cap turned away. A
    // replacement has to clear both again, or the §7.4 top-up becomes the way
    // §6's rules get broken — quietly, and only on the days a drop already made
    // the day fragile. §7's whole premise is that an unexplainable paper is not
    // worth a slot; that does not stop being true because a slot came free.
    const replacementIndex = reserve.findIndex(
      (paper) =>
        passesExplainabilityGate(paper, config.ranking.explainabilityGate) &&
        admitWithinCap([paper], committed, 1, cap).length === 1,
    );
    if (replacementIndex === -1) {
      logger.warn(
        `nothing in the ranked remainder clears the explainability gate and the ` +
          `${cap}-per-subfield cap — publishing short rather than breaking §6`,
      );
      continue;
    }
    const [replacement] = reserve.splice(replacementIndex, 1);
    if (replacement !== undefined) {
      topUps += 1;
      logger.warn(`topping up with ${replacement.id} after dropping ${candidate.id}`);
      queue.push(replacement);
    }
  }

  // ---- §9 publish, or refuse to ---------------------------------------------
  // §3's shortfall gets its own notice on the page, rendered from
  // `digest.shortfall`. It deliberately does NOT also become a `Degradation`:
  // the footer keys its wording on the degradation's source, so a shortfall
  // filed under `openalex` made the page tell the reader the database had been
  // unavailable when nothing had gone wrong with it at all.
  const shortfall = shortfallOf(entries.length, config, selection.shortfallReason);
  if (shortfall !== null) logger.warn(`shortfall: ${shortfall.produced}/${shortfall.expected} — ${shortfall.reason}`);

  const usage = llm.totalUsage();
  const baseLog: Omit<RunLogLine, 'summary'> = {
    ts: new Date(started).toISOString(),
    runId: date,
    level: 'INFO',
    outcome: 'published',
    category: category.key,
    categoryLabelCs: category.labelCs,
    durationMs: Date.now() - started,
    candidates: {
      fetched,
      afterExclusions: shortlisting.ranked.length,
      // From the FIRST pass. The second one only ever sees the shortlist, so
      // its counts would report a handful of exclusions that already happened.
      exclusionReasons: shortlisting.exclusionCounts,
      selected: selection.selected.length,
      verified: entries.length,
      dropped,
    },
    degradations: degradations.map((d) => d.source),
    warnings: logger.warnings(),
    errors: logger.errors(),
    anthropic: {
      callsTotal: llm.callCount(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      estimatedCostUsd: estimateCostUsd(usage, config.summarisation.model),
    },
  };

  if (entries.length < config.output.minPapersToPublish) {
    // §9: publish nothing, log the failure, leave yesterday's index intact —
    // and "intact" means untouched, not regenerated to the same bytes (A20).
    logger.error(
      `only ${entries.length} paper(s) survived verification, below the minimum of ` +
        `${config.output.minPapersToPublish} — publishing nothing and leaving the index alone`,
    );
    const line = { ...baseLog, level: 'FATAL' as const, outcome: 'aborted' as const };
    writeRunLog(options, { ...line, summary: summariseRunLog(line) });
    return { outcome: 'aborted', date, digest: null, exitCode: 1 };
  }

  // §2's rules never drop a paper, so a hard untranslated-English finding can
  // survive the regeneration budget and reach the page. That is a visible
  // defect in what the reader is looking at, so it is said out loud rather than
  // left in a log (D.6 `DEG_TRANSLATION`). Other style findings get no footer
  // note: a clumsy sentence is not a reason to make a reader distrust the text.
  if (entries.some((e) => e.checks.hard.some((v) => v.rule === 'untranslated-english'))) {
    degradations.push({
      source: 'translation',
      message: stringsFor(config.output.language).degradationTranslation,
      detail: 'an untranslated-English finding survived the style regeneration budget',
    });
  }

  // §9's footer lists one sentence per thing that went wrong, not one per
  // occurrence: two papers dropped for the same reason is one sentence, and the
  // Czech is already plural. The JSON twin keeps every record, with its detail.
  const footerDegradations = dedupeBySource(degradations);

  const digest: DayDigest = {
    date,
    categoryKey: category.key,
    categoryLabel: category.labelCs,
    language: config.output.language,
    entries,
    shortfall,
    degradations: footerDegradations,
    generatedAt: new Date().toISOString(),
    // The reader's calendar day, not UTC's — a page dated 19 August must not
    // say it was made on the 18th because the run finished at 01:30 Prague.
    generatedOn: localDateISO(new Date(), config.output.timezone),
    schemaVersion: 1,
  };

  if (options.dryRun) {
    logger.info('dry run: nothing written');
  } else {
    try {
      writeDayOutputs({ digest, config, repoRoot, logger });
      // D.3's ordering: `seen.json` is written only after the page exists. A run
      // that dies before publishing must not burn its candidates.
      saveSeen(seenPath, recordPublished(seenState, entries, date, category.key));
    } catch (error) {
      // A full disk or a failed rename is the one failure that would otherwise
      // leave `logs/run.log` silent — and that file is the only place Tom looks
      // when the page is wrong. §9 wants one line per run, this run included.
      logger.error(`could not commit the day's output: ${(error as Error).message}`);
      const failed = { ...baseLog, level: 'FATAL' as const, outcome: 'aborted' as const };
      writeRunLog(options, { ...failed, errors: logger.errors(), summary: summariseRunLog(failed) });
      return { outcome: 'aborted', date, digest: null, exitCode: 2 };
    }
  }

  const degraded = degradations.length > 0 || shortfall !== null;
  const line = {
    ...baseLog,
    level: degraded ? ('WARN' as const) : ('INFO' as const),
    outcome: degraded ? ('published_degraded' as const) : ('published' as const),
  };
  writeRunLog(options, { ...line, summary: summariseRunLog(line) });

  return {
    outcome: degraded ? 'published_degraded' : 'published',
    date,
    digest,
    exitCode: 0,
  };
}

function writeRunLog(options: RunOptions, line: RunLogLine): void {
  if (options.dryRun) return;
  appendRunLog(resolve(options.repoRoot, options.config.paths.runLog), line);
}

function createLlmClient(options: RunOptions): LlmClient {
  const key = options.secrets.anthropicApiKey;
  if (key === null) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Without it a run can discover and rank papers but ' +
        'cannot write or verify a word — see .env.example. Refusing to continue rather than ' +
        'publishing a page of English abstracts.',
    );
  }
  return new AnthropicLlmClient(key);
}

/**
 * Ranking runs once BEFORE enrichment, to find the shortlist worth spending
 * Semantic Scholar's one-request-per-second on, so a raw candidate has to be
 * given the enriched shape first. `tldr: null` is honest here — it says the
 * shortlisting pass genuinely had no TLDR to score against, which is why the
 * ranking is run again afterwards on the enriched set.
 */
function toUnenriched(candidate: Candidate): EnrichedCandidate {
  return {
    ...candidate,
    tldr: null,
    abstractSource: candidate.abstract === null ? 'none' : 'source',
  };
}

/** Exactly what the verifier is allowed to see (DESIGN-NOTES C.1.1). */
function sourceTextOf(candidate: ScoredCandidate): SourceText {
  return {
    title: candidate.title,
    abstract: candidate.abstract ?? '',
    tldr: candidate.tldr,
    venue: candidate.venue ?? (candidate.isPreprint === true ? 'preprint server' : 'unknown venue'),
    type: candidate.isPreprint === true ? 'preprint' : 'article',
    date: candidate.date,
  };
}

/**
 * Both drop reasons wear the same sentence to the reader: a study was left out
 * because its text could not be prepared. The distinction between "the example
 * could not be traced to the paper" and "the API would not answer" matters to
 * whoever reads the log, and not at all to the family reading the page.
 */
function degradationForDrop(
  reason: 'example_unverifiable' | 'summarisation_failed',
  config: Config,
): Degradation {
  return {
    source: 'anthropic',
    message: stringsFor(config.output.language).degradationAnthropic,
    detail:
      reason === 'example_unverifiable'
        ? 'example failed §7.4 verification at every rung'
        : 'summarisation call failed after retries',
  };
}

/** One entry per source, keeping the first message and joining the details. */
function dedupeBySource(all: readonly Degradation[]): Degradation[] {
  const bySource = new Map<string, Degradation>();
  for (const degradation of all) {
    const existing = bySource.get(degradation.source);
    if (existing === undefined) {
      bySource.set(degradation.source, { ...degradation });
      continue;
    }
    existing.detail = `${existing.detail}; ${degradation.detail}`;
  }
  return [...bySource.values()];
}

function shortfallOf(
  produced: number,
  config: Config,
  reason: 'none' | 'candidate-shortage' | 'diversity-cap',
): Shortfall | null {
  if (produced >= config.output.papersPerDay) return null;
  return {
    expected: config.output.papersPerDay,
    produced,
    reason:
      reason === 'diversity-cap'
        ? 'the two-per-subfield diversity constraint (§6) could not be met with more papers'
        : 'not enough fresh, in-category candidates survived filtering and verification',
  };
}
