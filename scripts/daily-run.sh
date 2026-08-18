#!/bin/bash
# The launchd entrypoint (§11 step 10).
#
# launchd gives a job almost no environment: no shell profile, a bare PATH, and
# no working directory you can rely on. Everything a run needs is therefore
# established here rather than inherited — the repo root, the PATH that finds
# node, and the credentials, which src/env.ts reads from .env.local for exactly
# this reason.
#
# It is deliberately NOT `set -e` on the pipeline call: a failed run must still
# reach the run-log append and the exit-code report below, because a run that
# dies silently at 06:00 is the failure mode §9 exists to prevent.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 78

# Homebrew node on Apple silicon, then the Intel path, then whatever is around.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p logs
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== ${STAMP} starting daily run ===" >> logs/stdout.log

npm run --silent run:daily >> logs/stdout.log 2>> logs/stderr.log
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  # §9: fail visibly, not loudly. The run log is the record Tom reads when the
  # page looks wrong, so a crash that never reached the pipeline's own logging
  # still leaves a line there.
  printf '%s\t%s\tCRASH\tcandidates=0\tselected=0\tpublished=no\terrors=daily-run.sh exited %s (see logs/stderr.log)\n' \
    "$STAMP" "$(date +%Y-%m-%d)" "$STATUS" >> logs/run.log
fi

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) finished, exit ${STATUS} ===" >> logs/stdout.log
exit "$STATUS"
