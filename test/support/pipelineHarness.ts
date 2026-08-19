/**
 * A whole run, offline.
 *
 * Everything the pipeline reaches outside itself is injectable — `fetchImpl`
 * for the three source APIs, an `LlmClient` for the two Claude calls — so a
 * complete run from discovery to rendered page can be exercised with no network
 * and no keys. That is what makes §11 step 10 partly provable today.
 */
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { LlmClient, LlmRequest, LlmResult, LlmUsage } from '../../src/summarise/client.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../..');

/** A throwaway repo root with the real config and empty state directories. */
export function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'research-desk-e2e-'));
  for (const dir of ['archive', 'logs', 'state']) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(REPO, 'config.json'), join(root, 'config.json'));
  return root;
}

interface OpenAlexWork {
  publication_date: string;
  created_date?: string;
  [key: string]: unknown;
}

/**
 * Serves the captured OpenAlex response, with every publication date pulled
 * into the run's freshness window. The fixture is real data whose dates go
 * stale the day after it was captured; without this, every test would start
 * failing on §6's seven-day rule for a reason that has nothing to do with the
 * code under test.
 */
export function openAlexFixture(runDate: string, count: number): string {
  const raw: unknown = JSON.parse(
    readFileSync(join(REPO, 'test/fixtures/openalex-works-psychology.json'), 'utf8'),
  );
  const parsed = raw as { results: OpenAlexWork[]; meta: Record<string, unknown> };
  const results = parsed.results.slice(0, count).map((work, index) => ({
    ...work,
    // Spread across the window so freshness actually discriminates.
    publication_date: shift(runDate, -(index % 6)),
    created_date: shift(runDate, -(index % 6)),
  }));
  return JSON.stringify({ meta: { ...parsed.meta, count: results.length }, results });
}

function shift(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface FetchLog {
  urls: string[];
}

/**
 * Routes by host. Semantic Scholar answers 404 throughout, which is the normal
 * case for very recent papers and exercises §4.2's "do not skip the paper for
 * this reason alone" path.
 */
export function makeFetchImpl(runDate: string, log: FetchLog, workCount = 25): typeof fetch {
  return (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    log.urls.push(url);
    if (url.includes('api.openalex.org')) {
      return Promise.resolve(new Response(openAlexFixture(runDate, workCount), { status: 200 }));
    }
    if (url.includes('semanticscholar.org')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
    }
    if (url.includes('arxiv.org')) {
      return Promise.resolve(
        new Response(readFileSync(join(REPO, 'test/fixtures/arxiv-cs-ai.xml'), 'utf8'), { status: 200 }),
      );
    }
    return Promise.resolve(new Response('unexpected host', { status: 500 }));
  };
}

const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/**
 * A model that writes acceptable Czech and verifies its own example honestly.
 *
 * The Czech below is deliberately plain and hype-free: it has to pass the real
 * §2 checker, so this doubles as a check that the checker does not reject
 * reasonable prose. The verification payload quotes the real source text, so
 * `adjudicate` finds the quote and the example is genuinely accepted rather
 * than waved through.
 */
export class HonestLlm implements LlmClient {
  readonly calls: string[] = [];

  complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push(request.label);
    const source = extractSource(request.user);

    if (request.label.startsWith('summarise')) {
      return this.ok<T>({
        nadpis: 'Vědci sledovali, jak spolu souvisí spánek a nálada u studentů',
        oCoJde:
          'Vědci chtěli zjistit, jestli lidé, kteří spí méně, bývají také podrážděnější. ' +
          'Sledovali proto skupinu studentů několik týdnů. Ukázalo se, že souvislost tam je.',
        podrobneVysvetleni: PODROBNE,
        prikladZeZivota: PRIKLAD,
        procJeToDulezite:
          'Spánek je jedna z mála věcí, které si člověk může sám nastavit. ' +
          'Když se ukáže, že pomáhá i náladě, stojí za to mu dát přednost.',
        poznamkaKOmezenim:
          'Studie sledovala jen malou skupinu lidí a po krátkou dobu, takže z ní ' +
          'nejde vyvozovat obecné závěry.',
      });
    }

    if (request.label.startsWith('verify-example')) {
      // Spans cover the whole example so V6 is satisfied, and both quotes are
      // literal slices of the abstract so V4 passes for the right reason —
      // the stub is honest, not merely agreeable.
      const [firstSpan, secondSpan] = splitInTwo(PRIKLAD);
      return this.ok<T>({
        claims: [
          {
            id: 'c1',
            claimText: restate(source.quotableA),
            claimType: 'action',
            exampleSpan: firstSpan,
            verdict: 'supported',
            sourceQuote: source.quotableA,
            quoteField: 'abstract',
          },
          {
            id: 'c2',
            claimText: restate(source.quotableB),
            claimType: 'outcome',
            exampleSpan: secondSpan,
            verdict: 'supported',
            sourceQuote: source.quotableB,
            quoteField: 'abstract',
          },
        ],
        modelOverallVerdict: 'supported',
        unsupportedReasonsCs: [],
      });
    }

    if (request.label.startsWith('motivation-fallback')) {
      return this.ok<T>({ motivace: PRIKLAD });
    }
    if (request.label.startsWith('regenerate-example')) {
      return this.ok<T>({ prikladZeZivota: PRIKLAD });
    }
    return Promise.reject(new Error(`HonestLlm has no answer for "${request.label}"`));
  }

  private ok<T>(value: unknown): Promise<LlmResult<T>> {
    return Promise.resolve({ value: value as T, usage: NO_USAGE });
  }

  totalUsage(): LlmUsage {
    return NO_USAGE;
  }

  callCount(): number {
    return this.calls.length;
  }
}

/**
 * Pulls two quotable slices back out of the rendered prompt. Character slices
 * rather than sentences, so they are guaranteed to be literal substrings of the
 * abstract whatever its punctuation — the point is that the real quote check in
 * `adjudicate` passes because the quote really is there.
 */
function extractSource(userMessage: string): { quotableA: string; quotableB: string } {
  const match = /### Abstrakt\n([\s\S]*?)\n\n###/.exec(userMessage);
  const abstract = (match?.[1] ?? userMessage).replace(/\s+/gu, ' ').trim();
  const half = Math.max(60, Math.floor(abstract.length / 2));
  return {
    quotableA: abstract.slice(0, Math.min(180, half)),
    quotableB: abstract.slice(half, half + 180) || abstract.slice(0, 180),
  };
}

/**
 * An English restatement of the quote, which is what a real verifier writes.
 * Generic boilerplate here would share no word stem with a real abstract and
 * would be rejected by the relevance rule — correctly, which is why the stub
 * must not use it.
 */
function restate(quote: string): string {
  return `The source states: ${quote.split(/\s+/u).slice(0, 18).join(' ')}`;
}

/** Two halves at a word boundary, so the spans cover the example between them. */
function splitInTwo(text: string): [string, string] {
  const cut = text.indexOf(' ', Math.floor(text.length / 2));
  const at = cut === -1 ? Math.floor(text.length / 2) : cut;
  return [text.slice(0, at).trim(), text.slice(at).trim()];
}

/**
 * A plain-Czech example. It has to survive the real §2 checker — no hype, short
 * sentences, no unglossed jargon, no bare numbers — which is why it is written
 * out rather than generated.
 */
const PRIKLAD =
  'Představte si běžný týden ve škole. Studenti si každý večer zapsali, kdy šli spát, ' +
  'a ráno krátce popsali, jak se cítí. Po pár týdnech bylo vidět, že po kratší noci ' +
  'jim den obvykle utíkal hůř než po delší.';

const PODROBNE = [
  'Vědci pozvali skupinu studentů a několik týdnů si u nich zapisovali, kolik hodin spali',
  'a jak se cítili. Každý večer vyplnili krátký dotazník o náladě a ráno zapsali, kdy šli spát',
  'a kdy vstali. Data se pak porovnala mezi sebou.',
  'Ukázalo se, že ve dnech po kratším spánku lidé hodnotili svou náladu hůř. Rozdíl nebyl velký,',
  'ale objevoval se opakovaně u většiny lidí ve skupině. Zajímavé bylo, že to platilo i tehdy,',
  'když člověk sám tvrdil, že mu krátký spánek nevadí.',
  'Autoři upozorňují, že jde o pozorování, ne o pokus. Nemůžou tedy tvrdit, že krátký spánek',
  'špatnou náladu způsobuje. Může to být i naopak, nebo za obojím může stát něco třetího,',
  'třeba stres ze zkoušek. Přesto výsledek zapadá do toho, co ukazují i jiné studie.',
].join(' ');
