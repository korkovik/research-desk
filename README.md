# Research Desk

Five newly published research papers a day, explained in plain Czech so that
someone with no scientific background understands what was found, why it
matters, and what it looks like in real life. One self-contained HTML page a
day, an archive, and always a link back to the original paper.

The success criterion, from the spec: **a secondary-school teacher or a family
member with no research background reads the page and can explain the finding
to someone else afterwards.**

Full specification: [`docs/SPEC.md`](docs/SPEC.md).
What is built, what is proven, and what still needs a hand: [`docs/HANDOVER.md`](docs/HANDOVER.md).

---

## Status

Built and tested offline. **Not yet run end to end**, because OpenAlex has
required an API key since 13 February 2026 and Research Desk does not have one
yet. Everything is written against the documented API shape and against
responses captured live from all three sources; the moment the key exists it
drops into `.env.local` and the pipeline runs unchanged. `docs/HANDOVER.md`
lists precisely what remains unproven until then — read that before trusting
anything here.

## Getting it running

```bash
npm install
cp .env.example /dev/null          # do NOT copy it — see the note at its top
$EDITOR .env.local                 # add OPENALEX_API_KEY and ANTHROPIC_API_KEY
npm run check                      # typecheck + lint + tests
npm run run:dry                    # a full run that writes nothing
npm run run:daily                  # a real run
```

Then schedule it:

```bash
cp launchd/com.tomscld.research-desk.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tomscld.research-desk.plist
launchctl kickstart -p gui/$(id -u)/com.tomscld.research-desk   # run it now
```

## Credentials

Three variables, all read from `.env.local` in this directory (see
[`.env.example`](.env.example) for the full contract). Nothing is shared with
any other project on this machine.

| Variable | Needed? | What happens without it |
|---|---|---|
| `OPENALEX_API_KEY` | **Yes, for daily running** | Falls back to the unkeyed 100-credits/day allowance — about ten list queries in total, enough to smoke-test and not enough to run daily. Free key from [openalex.org/settings/api](https://openalex.org/settings/api). |
| `ANTHROPIC_API_KEY` | **Yes** | The pipeline can discover and rank papers but cannot write or verify a word, and stops before publishing rather than shipping a page of English abstracts. |
| `SEMANTIC_SCHOLAR_API_KEY` | No | The API answers without a key at a lower rate. The 1.1-second gap between requests is enforced either way. |

**Research Desk uses its own Anthropic key.** No key was copied here from
another project — `czech-product-verifier` has one, and its spend cap is its
own. Put Research Desk's key in
`~/claudecode-workspace/research-desk/.env.local` at mode 0600.

## What a run costs

Two Claude calls per paper — one to write the six blocks, one to check that the
"Příklad ze života" is really traceable to the paper — plus an optional
adversarial third, plus whatever regeneration the checks demand. Typically
**12–17 calls a day** for five papers.

Measured prompt sizes and estimated tokens, at `claude-opus-5`
($5 / $25 per million tokens in / out), `effort: high`, challenge pass on:

| | per day |
|---|---|
| Input (after prompt caching of the stable system prompts) | ~16,000 tokens |
| Output, including adaptive thinking | ~33,000 tokens |
| **Estimated cost** | **$0.55 – $0.95 per day, i.e. roughly $17 – $29 per month** |

The range is wide because the uncertain term is thinking tokens, which are
billed as output and dominate the bill. **The upper end of that range exceeds a
$20 monthly cap**, so if the cap is a hard one, pull these levers in this order —
each is a one-line change in `config.json`:

1. `verification.challengePass: false` — drops the second adversarial pass.
   Saves roughly a quarter of the output tokens. Costs the most in safety, so
   it is listed first only because it is the largest single saving; consider it
   the last one you actually want to pull.
2. `summarisation.effort` and `verification.effort` from `high` to `medium` —
   roughly halves thinking tokens. This is the lever to pull first.
3. `summarisation.model` / `verification.model` to `claude-sonnet-5`
   ($3 / $15) — about 40 % cheaper, at some quality cost on the Czech.

Every run logs its actual token usage and an estimated cost into
`logs/run.log`, so after a week the estimate above can be replaced with a
measurement.

## How it works

```
rotation (§5)  →  adapters (§4)  →  enrichment (§4.2)  →  ranking (§6)
                                                              ↓
        archive + index (§8)  ←  render (§7)  ←  verify (§7.4)  ←  summarise (§7)
```

- **`src/adapters/`** — one file per source, all satisfying the same contract
  from §10: `fetch(category, since) → [{id, title, abstract, date, url, licence,
  source}]`. Adding the later market/industry source is a new file and one line
  in `registry.ts`.
- **`src/select/`** — §6's four ranking factors, the explainability gate, the
  max-two-per-subfield diversity constraint, and dedup against `state/seen.json`.
- **`src/summarise/`** — the six §7 blocks, and the verification pass that can
  reject them. See below.
- **`src/checks/`** — §2's plain-language and no-hype rules as deterministic
  checks over the generated Czech, not just as instructions in a prompt.
- **`src/render/`** — the day page and the index. Self-contained HTML, all CSS
  inline, no external requests, readable on a phone.

### The part that matters most

§7.4 calls a fabricated everyday example the single worst failure this project
can produce — worse than publishing four papers instead of five. So the example
gets a separate verification call that sees **only** the paper's own source text
and the candidate example, never the rest of the generated summary. The model's
verdict is advisory; the verdict that counts is computed in code from the claims
it returns, and every claim it marks supported must carry a quote that the code
then confirms really occurs in the source. A verifier that invents its own
supporting quote fails.

When an example cannot be verified: regenerate, re-verify, fall back to the
authors' stated motivation under a visible label, verify that too — and if it
still fails, **drop the paper and publish four**.

## Configuration

Everything a future change would plausibly touch is in
[`config.json`](config.json) — output language, the seven-day category rotation
with its OpenAlex field IDs, ranking weights, papers per day, paths, windows,
model and effort settings. Nothing in `src/` hardcodes any of it. The loader
refuses a config that reorders §6's fixed importance ranking, because that would
quietly change what the project is for.

**The Czech-facing name is still unset** (`output.siteName: null`). Until it is,
pages carry the working name and every run logs a reminder.

## Czech language review

All reader-facing Czech is in one file, [`src/render/strings.cs.ts`](src/render/strings.cs.ts),
so it can be reviewed in a single pass. The prompts in
[`src/summarise/prompt.ts`](src/summarise/prompt.ts) are also Czech and also
machine-written; a reader never sees them, but bad Czech there produces bad
Czech downstream, so they belong in the same review. Neither the project owner
nor the machine that wrote them is a native speaker — see `docs/HANDOVER.md`
for the specific strings flagged as least confident.

## Commands

| | |
|---|---|
| `npm run check` | typecheck, lint, and the full offline test suite |
| `npm run run:daily` | one real run |
| `npm run run:dry` | a full run that writes nothing |
| `npm run resolve:categories` | re-resolve the seven categories to OpenAlex field IDs (one live query) |
| `npm run render:index` | rebuild `index.html` from the archive's JSON twins |
| `npm run qa:live-verifier` | run the ten golden fixtures against the real API — **the check that closes this project's biggest open gap** |
| `npm run qa:live-sources` | probe all three source APIs and report what each returned |

## Licence

MIT. OpenAlex metadata is CC0 and safe to store and republish; arXiv and
Semantic Scholar metadata is used under their respective terms. The project
deliberately uses metadata only and never retrieves paywalled full text.
