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

export const ConfigSchema = z
  .object({
    output: z.object({
      language: z.string().min(2),
      siteName: z.string().min(1).nullable(),
      workingName: z.string().min(1),
      tagline: z.string().min(1).nullable(),
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
      maxPerSubfield: z.number().int().min(1),
    }),
    summarisation: z.object({
      model: z.string().min(1),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      maxTokens: z.number().int().min(1000),
      maxRegenerationAttempts: z.number().int().min(0),
    }),
    verification: z.object({
      model: z.string().min(1),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      maxTokens: z.number().int().min(500),
      maxExampleAttempts: z.number().int().min(1),
      dropPaperIfMotivationFallbackAlsoFails: z.boolean(),
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
