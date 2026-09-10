#!/usr/bin/env bash
# Keeps czech-product-verifier's Supabase project from being paused for
# inactivity, by making one genuine read of its catalogue each run.
#
# What it can and cannot do:
#   - It PREVENTS a pause by keeping the project's activity above Supabase's
#     idle threshold. It cannot CURE one: a paused project's hostname stops
#     resolving and resuming needs the dashboard. If the project is already
#     paused this fails, visibly, every run until someone presses Resume.
#   - It cannot write. It connects as cpv_web, whose grants are SELECT-only
#     (czech-product-verifier migrations 0003/0005), and it also opens the
#     transaction READ ONLY, so there are two independent locks on that.
#
# Reports status=ok|failed|unconfigured to $GITHUB_OUTPUT. Exits non-zero only
# on a real failure; the workflow marks the step continue-on-error, because
# Research Desk publishing is worth more than the verifier's uptime.
set -uo pipefail

report() { echo "status=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

if [ -z "${CPV_KEEPALIVE_DATABASE_URL:-}" ]; then
  echo "::notice::CPV_KEEPALIVE_DATABASE_URL is not set, so the czech-product-verifier keepalive did not run."
  report unconfigured
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "::warning title=czech-product-verifier keepalive failed::psql is not installed on this runner."
  report failed
  exit 1
fi

# A real read of a real table the site serves, not `select 1`. Supabase's own
# wording is that "a few user requests to the database each day" keep a project
# awake; it does not publish the exact rule, so this is made as close to a real
# visitor's request as a read-only role can make it.
query='begin transaction read only; select count(*) from (select 1 from cpv.products limit 1) as probe; commit;'
output=$(PGCONNECT_TIMEOUT=15 PGAPPNAME=research-desk-keepalive \
  psql "$CPV_KEEPALIVE_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 -tAq -c "$query" 2>&1)
status=$?

if [ $status -eq 0 ]; then
  echo "czech-product-verifier keepalive: read ok ($(printf '%s' "$output" | tr -d '[:space:]') row)."
  report ok
  exit 0
fi

# psql never prints the password, but mask any URL credentials anyway before
# the message reaches a public log.
reason=$(printf '%s' "$output" | sed -E 's#(postgres(ql)?://)[^@[:space:]]*@#\1***@#g' | tr '\n' ' ' | cut -c1-300)
echo "::warning title=czech-product-verifier keepalive failed::$reason"
report failed
exit 1
