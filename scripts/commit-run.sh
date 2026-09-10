#!/usr/bin/env bash
# Commits this run's ledger line — always — and the edition only if one was
# published. Two guarantees, and the second is built on top of the first rather
# than instead of it:
#
#   1. A run that did not publish never changes the archive. Any edition file it
#      half-wrote before failing is put back exactly as main has it.
#   2. Every run still commits something: its line in state/runs.jsonl. GitHub
#      disables a public repo's schedule after 60 days without activity, so a
#      ledger that only moved on good days would let a long outage switch off
#      the very schedule that should recover from it.
#
# Environment: DAY (required), PUBLISH=true|false, OUTCOME (for the message),
# REMOTE (default origin), BRANCH (default main).
set -euo pipefail

DAY="${DAY:?DAY is required}"
PUBLISH="${PUBLISH:-false}"
OUTCOME="${OUTCOME:-recorded}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
LEDGER="state/runs.jsonl"
EDITION_PATHS=(archive index.html state/seen.json)

git config user.name  "research-desk-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [ "$PUBLISH" = "true" ]; then
  git add -A -- "${EDITION_PATHS[@]}"
  if git diff --cached --quiet -- "${EDITION_PATHS[@]}"; then
    message="ledger: $DAY $OUTCOME"   # the build succeeded but had nothing to publish
  else
    message="digest: $DAY"
  fi
else
  git checkout HEAD -- "${EDITION_PATHS[@]}"
  git clean -fdq -- archive
  message="ledger: $DAY $OUTCOME"
fi
git add -- "$LEDGER"

if git diff --cached --quiet; then
  # Never "nothing to do": the ledger step runs on every path, so an empty
  # commit here means it failed, and a quiet exit would be the silence this
  # whole mechanism exists to remove.
  echo "::error::No ledger line to commit — the run went unrecorded."
  exit 1
fi

git commit -q -m "$message"

# Push race: rebase onto whatever arrived and retry. state/runs.jsonl is marked
# merge=union in .gitattributes, so two runs appending to the ledger resolve
# themselves. Anything else conflicting is aborted rather than hand-merged — a
# seen.json half-merged by a bot would silently break dedup for every later run.
for attempt in 1 2 3 4 5; do
  if git pull -q --rebase --autostash "$REMOTE" "$BRANCH"; then
    if git push -q "$REMOTE" "HEAD:$BRANCH"; then
      echo "Pushed: $message"
      exit 0
    fi
  else
    git rebase --abort >/dev/null 2>&1 || true
    echo "::error::Rebase onto $REMOTE/$BRANCH conflicted outside the ledger; refusing to hand-merge generated state."
    exit 1
  fi
  echo "Push attempt $attempt lost the race; retrying."
  sleep $((attempt * 5))
done
echo "::error::Could not push after 5 attempts."
exit 1
