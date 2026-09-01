# Research Desk

Five newly published research papers a day, explained in plain Czech so that
someone with no scientific background understands what was found, why it
matters, and what it looks like in real life. One self-contained HTML page a
day, an archive, and always a link back to the original paper.

The success criterion, from the spec: **a secondary-school teacher or a family
member with no research background reads the page and can explain the finding
to someone else afterwards.**

**Live: https://korkovik.github.io/research-desk/**

[![check](https://github.com/korkovik/research-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/korkovik/research-desk/actions/workflows/ci.yml)
[![daily digest](https://github.com/korkovik/research-desk/actions/workflows/daily.yml/badge.svg)](https://github.com/korkovik/research-desk/actions/workflows/daily.yml)

The specification, the design notes, the assumptions log and the handover live
in `docs/` on the build machine and are deliberately **not** published here:
they carry spend figures, candid assessments of which editions read badly, and
personal detail. `.gitignore` says how to publish them if that is ever wanted.

---

## Status

Running. Nine editions have been published from live data across all three
sources, and deduplication has been proven across consecutive runs — the second
run excluded nine papers it had already covered, with no overlap by ID or DOI.

It now runs itself: GitHub Actions builds an edition every morning and GitHub
Pages serves it. The Mac mini is no longer in the loop, which retires
assumption A1.

What is still weak, in order: number anchoring is the least reliable of the §2
checks; the §7.4 verification machinery is in the codebase but **not wired into
the daily run** since the "Příklad ze života" block was removed, because there
is no longer a fabricated-example surface for it to guard; and no native Czech
speaker has reviewed the output.

## Getting it running

```bash
npm install
$EDITOR .env.local     # uncomment and fill OPENALEX_API_KEY and ANTHROPIC_API_KEY
                       # (.env.local already exists; .env.example is documentation,
                       #  do NOT copy it — see the note at its top)
npm run check          # typecheck + lint + tests
npm run run:dry                    # a full run that writes nothing
npm run run:daily                  # a real run
```

That is only needed to run it by hand. The daily schedule lives in GitHub
Actions — see [Deployment](#deployment). The `launchd/` plist is kept for
running it on the Mac mini instead, but nothing depends on it any more.

## Deployment

GitHub Actions builds the edition, GitHub Pages serves it. Actions rather than
a serverless host because a run takes about eleven minutes end to end, which is
past every serverless function ceiling; Actions has a six-hour job limit and is
free on public repositories.

```
06:00 Prague ─ .github/workflows/daily.yml
               ├── gate      is this the 06:00 firing, and is today unpublished?
               ├── build     npm run run:daily          (the only step that spends)
               ├── publish   commit archive/, index.html, state/seen.json → main
               └── on failure  open a dated issue labelled run-failure
                     │
               Pages serves main at the repository root
```

**Why the output is committed.** Every run gets a clean runner. If the archive
were not in git, each morning would rebuild an index holding only that day's
edition and every earlier page would 404; and `state/seen.json` — the only
record of what has already been published — would start empty and re-publish
papers already covered. Committing the output is what makes the archive an
archive.

**The DST trap.** GitHub cron is UTC and ignores daylight saving. The common
fix is two month-scoped rules, but EU DST switches on the *last Sunday* of March
and October, so a month-scoped pair is still an hour out for about the first
four weeks of March and the last week of October. Instead both rules fire daily
and a gate step asks the runner's own tzdata whether it is 06:00 in Prague.
Exact all year; the losing firing costs a few free seconds.

**Not committing a broken day.** The publish step runs only if the build step
succeeded, so a failed run leaves the archive and `seen.json` untouched and
yesterday's site still served. Per §9 the day is visibly missing rather than
padded with older or off-category papers.

**The push race.** The output commit is rebased onto `origin/main` and retried
five times with backoff. If the rebase conflicts it is aborted and the job
fails: a `seen.json` half-merged by a bot would silently break deduplication
for every later run, which is worse than a red X.

**Knowing it broke, without a daily email.** A good day sends nothing. A bad day
opens (or comments on) one dated issue labelled `run-failure`, which GitHub
notifies on, turns the badge above red, and leaves a red X in the Actions tab.

A benign skip is *not* a failure. Every firing after the first finds the day
already published, so the run passes `--skip-if-published` and the guard says
so calmly and exits 0. Reporting that as a failure would send a notification on
a morning when everything worked, and a red signal that usually means "probably
fine" is worse than no signal at all.

**The run that never happens.** A third cron at 11:00 UTC checks the two things
that must be true for there to be anything to read: today's edition is committed,
and the live Pages origin actually serves it. Both firings delayed out of their
window, a disabled schedule, or a failed Pages deploy would otherwise leave a
green tick and a site quietly frozen on an old edition — the worst failure this
project has, because silence reads as success. Either check failing opens an
issue and fails the run.

Run it by hand from the Actions tab → **daily digest** → *Run workflow*, with
`force` ticked to replace an edition already published today.

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
own. For local runs, put the key in
`~/claudecode-workspace/research-desk/.env.local` at mode 0600.

For the daily Actions run the same two values are **repository secrets**
(Settings → Secrets and variables → Actions), never committed. `.gitignore`
denies everything env-shaped and re-admits only `.env.example`, so a stray
copy like `.env.local.bak` cannot reach git either.

## What a run costs

Measured across nine live runs, not estimated. One Claude call per paper —
the `Příklad ze života` block was removed, and with it the second verification
call that guarded it — so a clean run makes **12 to 15 calls** for five papers,
the spread being regeneration when a §2 style check rejects a block.

At `claude-opus-5` ($5 / $25 per million tokens in / out), `effort: high`:

| | per day |
|---|---|
| Calls | 12 – 15 |
| **Measured cost** | **$0.85 – $1.13, averaging $0.97** |
| **Per month** | **roughly $29** |

Six unattended runs (21–25 August and 1 September), revising an earlier figure
of $0.70/day that came from hand-triggered runs. Unattended days cost more
because nobody is picking an easy category for them.

**$28 does not sit comfortably inside a $40 cap**, and on 26 August the cap
was exhausted — every run failed with `You have reached your specified API
usage limits` until it reset on 1 September. The cap is shared with
`czech-product-verifier`, so Research Desk's $28 is not the whole bill. Either
raise the cap, give this project its own, or pull the levers below before the
month is out. `state/runs.jsonl` carries the real per-run cost, so the month
can be totalled rather than guessed.

How it came down, since the trajectory is the useful part: 41 calls / $1.99 per
run at the start, then $1.86 once the number-anchor check stopped forcing
needless regeneration, then $1.18 when the generator was rewritten, then $0.62
once the example block and its verification call went. `effort: medium` was
measured and rejected: it saved 12 % and doubled the surviving style findings
from four to eight.

If the cap ever needs defending, pull these in order — each is one line in
`config.json`:

1. `summarisation.effort` from `high` to `medium` — cheapest lever, at a
   measured cost in Czech style quality.
2. `summarisation.model` to `claude-sonnet-5` ($3 / $15) — about 40 % cheaper,
   at more quality cost on the Czech.

Every run logs its real token usage and cost to `logs/run.log`, and the Actions
log keeps the same line for each day.

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
nor the machine that wrote them is a native speaker — see the handover notes on the build machine
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
