/**
 * Loads and validates `config.json` (§8). Validation is strict on purpose: an
 * unattended 06:00 run that reads a malformed config should stop with a line
 * naming the field, not publish a page built on a silently-defaulted weight.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const TopicIdList = z.array(z.string().min(1)).min(1);

const CategorySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  key: z.string().min(1),
  labelCs: z.string().min(1),
  openalex: z.object({
    fieldIds: TopicIdList,
    fieldNames: z.array(z.string().min(1)).min(1),
  }),
  arxiv: z.object({ categories: z.array(z.string().min(1)).min(1) }).optional(),
});

const WeightsSchema = z.object({
  explainability: z.number().min(0).max(1),
  everydayRelevance: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  credibility: z.number().min(0).max(1),
});

// --- §2 style checker (DESIGN-NOTES A). Knobs only; the hype lexicon and the
// jargon term list are corpora and live in src/checks/lexicons.cs.ts. ---

/** A warn/hard pair. Every A.3.2 metric ships as one. */
const ThresholdSchema = z.object({ warn: z.number(), hard: z.number() });
const Share = z.number().min(0).max(1);

const StyleSchema = z.object({
  hype: z.object({
    /** A.1.1 #36 / A.1.2 #37 — the false-positive guard window. */
    guardWindowChars: z.number().int().min(1),
  }),
  english: z.object({
    // A.2.3's five conditions and the two secondary checks.
    minTokens: z.number().int().min(1),
    englishScoreHard: Share,
    czechScoreHard: Share,
    maxCzechFunctionWords: z.number().int().min(0),
    mixedMinTokens: z.number().int().min(1),
    mixedEnglishScoreWarn: Share,
    runMinTokens: z.number().int().min(1),
    runMinEnglishFunctionWords: z.number().int().min(1),
  }),
  readability: z.object({
    // A.3.2 R1..R9. Larger is worse for every metric except compositeIndexFloor.
    meanSentenceWords: ThresholdSchema,
    longestSentenceWords: ThresholdSchema,
    longSentenceCount: ThresholdSchema,
    meanSyllablesPerWord: ThresholdSchema,
    share4Syllables: ThresholdSchema,
    share5Syllables: ThresholdSchema,
    passiveShare: ThresholdSchema,
    /** R8 — the reflexive-passive detector is ~0.5 precise (A.3.4), so it never hard-fails. */
    reflexivePassiveShareWarn: Share,
    /** R9 — lower is worse: warn below `warn`, hard below `hard`. */
    compositeIndexFloor: ThresholdSchema,
    /** What "a long sentence" means for R3. A.3.2 fixes it at 25 words. */
    longSentenceWords: z.number().int().min(1),
    /** A.3.2's extra rule outside the table: §7.1's one-line title. */
    nadpisMaxWords: z.number().int().min(1),
    nadpisMaxChars: z.number().int().min(1),
  }),
  jargon: z.object({
    glossMinWords: z.number().int().min(1),
    parenGlossMaxDistanceChars: z.number().int().min(1),
    parenGlossMinCzechWords: z.number().int().min(1),
    dashGlossMaxGapChars: z.number().int().min(1),
  }),
  numbers: z.object({
    anchorMinWords: z.number().int().min(1),
    parenRestatementMinWords: z.number().int().min(1),
    anchorLookaheadSentences: z.number().int().min(0),
  }),
  warnBudget: z.object({
    perHundredWords: z.number().min(0),
    maxPerPaper: z.number().int().min(0),
  }),
});

/** The `style` slice of the config, as every check module receives it. */
export type StyleConfig = z.infer<typeof StyleSchema>;

export const ConfigSchema = z
  .object({
    output: z.object({
      language: z.string().min(2),
      siteName: z.string().min(1).nullable(),
      workingName: z.string().min(1),
      papersPerDay: z.number().int().min(1),
      minPapersToPublish: z.number().int().min(1),
      timezone: z.string().min(1),
    }),
    paths: z.object({
      archiveDir: z.string().min(1),
      indexFile: z.string().min(1),
      seenState: z.string().min(1),
      runLog: z.string().min(1),
    }),
    windows: z.object({
      freshnessDays: z.number().int().min(1),
      dedupDays: z.number().int().min(1),
    }),
    shortlist: z.object({ size: z.number().int().min(1) }),
    ranking: z.object({
      weights: WeightsSchema,
      explainabilityGate: z.number().min(0).max(1),
      maxPerSubfield: z.number().int().min(1),
      /** §6's diversity cap is hard by default; raising it to hit the target is opt-in. */
      relaxDiversityToReachTarget: z.boolean(),
      relaxedMaxPerSubfield: z.number().int().min(1),
      /** DESIGN-NOTES B.1 rule 3 — the floor below which an abstract cannot carry §7.3. */
      minAbstractChars: z.number().int().min(0),
    }),
    summarisation: z.object({
      model: z.string().min(1),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      maxTokens: z.number().int().min(1000),
      maxRegenerationAttempts: z.number().int().min(0),
    }),
    style: StyleSchema,
    anthropic: z.object({
      maxCallsPerRun: z.number().int().min(1),
    }),
    verification: z.object({
      model: z.string().min(1),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      maxTokens: z.number().int().min(500),
      maxExampleAttempts: z.number().int().min(1),
      challengePass: z.boolean(),
    }),
    sources: z.object({
      openalex: z.object({
        baseUrl: z.string().url(),
        perPage: z.number().int().min(1).max(200),
        maxPages: z.number().int().min(1),
        mailto: z.string().min(3),
        requireApiKey: z.boolean(),
      }),
      semanticScholar: z.object({
        baseUrl: z.string().url(),
        throttleMs: z.number().int().min(1000),
      }),
      arxiv: z.object({
        baseUrl: z.string().url(),
        maxResults: z.number().int().min(1).max(2000),
      }),
    }),
    http: z.object({
      retries: z.number().int().min(0),
      backoffMs: z.array(z.number().int().min(0)).min(1),
      timeoutMs: z.number().int().min(1000),
      userAgent: z.string().min(1),
    }),
    categories: z.array(CategorySchema).length(7),
  })
  .superRefine((cfg, ctx) => {
    const sum = Object.values(cfg.ranking.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranking', 'weights'],
        message: `weights must sum to 1, got ${sum}`,
      });
    }
    // §6 fixes the ORDER of importance. A config that reorders it would quietly
    // change what the project is for, so it is rejected rather than obeyed.
    const w = cfg.ranking.weights;
    if (!(w.explainability > w.everydayRelevance && w.everydayRelevance > w.freshness && w.freshness > w.credibility)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranking', 'weights'],
        message:
          'weights must respect §6 ordering: explainability > everydayRelevance > freshness > credibility',
      });
    }
    // A "relaxed" cap below the normal one would silently tighten the constraint
    // on exactly the days the operator asked for more room.
    if (cfg.ranking.relaxedMaxPerSubfield < cfg.ranking.maxPerSubfield) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranking', 'relaxedMaxPerSubfield'],
        message: 'relaxedMaxPerSubfield cannot be below maxPerSubfield',
      });
    }
    if (cfg.output.minPapersToPublish > cfg.output.papersPerDay) {
      ctx.addIssue({
        code: 'custom',
        path: ['output', 'minPapersToPublish'],
        message: 'minPapersToPublish cannot exceed papersPerDay',
      });
    }
    const weekdays = new Set(cfg.categories.map((c) => c.weekday));
    if (weekdays.size !== 7) {
      ctx.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'categories must cover each weekday 1..7 exactly once',
      });
    }
    const keys = new Set(cfg.categories.map((c) => c.key));
    if (keys.size !== cfg.categories.length) {
      ctx.addIssue({ code: 'custom', path: ['categories'], message: 'category keys must be unique' });
    }
    // A.3.2's table is only meaningful if `hard` is strictly worse than `warn`.
    // A config where they are crossed would hard-fail text that never warns,
    // which is the kind of silent inversion nobody notices for weeks.
    const r = cfg.style.readability;
    const ascending: Array<[string, { warn: number; hard: number }]> = [
      ['meanSentenceWords', r.meanSentenceWords],
      ['longestSentenceWords', r.longestSentenceWords],
      ['longSentenceCount', r.longSentenceCount],
      ['meanSyllablesPerWord', r.meanSyllablesPerWord],
      ['share4Syllables', r.share4Syllables],
      ['share5Syllables', r.share5Syllables],
      ['passiveShare', r.passiveShare],
    ];
    for (const [name, t] of ascending) {
      if (!(t.hard > t.warn)) {
        ctx.addIssue({
          code: 'custom',
          path: ['style', 'readability', name],
          message: `hard (${t.hard}) must be worse than warn (${t.warn}) — larger is worse for this metric`,
        });
      }
    }
    // R9 runs the other way: warn below 50, hard below 40.
    if (!(r.compositeIndexFloor.hard < r.compositeIndexFloor.warn)) {
      ctx.addIssue({
        code: 'custom',
        path: ['style', 'readability', 'compositeIndexFloor'],
        message: 'composite index R9 is a floor: hard must be BELOW warn',
      });
    }
    if (cfg.http.backoffMs.length < cfg.http.retries) {
      ctx.addIssue({
        code: 'custom',
        path: ['http', 'backoffMs'],
        message: `backoffMs needs at least ${cfg.http.retries} entries, one per retry`,
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(repoRoot: string, filename = 'config.json'): Config {
  const file = resolve(repoRoot, filename);
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`${file} is not valid:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** The category for a given weekday (1 = Monday … 7 = Sunday). */
export function categoryForWeekday(config: Config, weekday: number): Config['categories'][number] {
  const found = config.categories.find((c) => c.weekday === weekday);
  if (!found) throw new Error(`no category configured for weekday ${weekday}`);
  return found;
}

/** What the pages are called today. Falls back to the working name while §12 is open. */
export function displayName(config: Config): string {
  return config.output.siteName ?? config.output.workingName;
}
