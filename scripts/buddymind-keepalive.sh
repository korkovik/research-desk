#!/usr/bin/env bash
# Keeps buddymind's Supabase project from being paused for inactivity, by
# making one genuine read of a table the app itself serves, each run.
#
# What it can and cannot do:
#   - It PREVENTS a pause by keeping the project's activity above Supabase's
#     idle threshold. It cannot CURE one: a paused project's hostname stops
#     resolving and resuming needs the dashboard. If the project is already
#     paused this fails, visibly, every run until someone presses Resume.
#   - It reads through the REST API as the `anon` role, with the project's
#     publishable key: the least-privileged role buddymind has. That key already
#     ships to every browser in the app's JavaScript, so it grants nothing a
#     visitor does not have; it is a secret here only to keep it out of the repo.
#     buddymind has no read-only login role like the verifier's cpv_web, and
#     making one would mean handing this repo a database password with more
#     reach than this key.
#   - The table read is reference data (the wellness category list), which RLS
#     lets anon SELECT. No user's data is readable this way.
#
# Reports status=ok|failed|unconfigured to $GITHUB_OUTPUT. Exits non-zero only
# on a real failure; the workflow marks the step continue-on-error, because
# Research Desk publishing is worth more than buddymind's uptime.
set -uo pipefail

report() { echo "status=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }
fail() {
  echo "::warning title=buddymind keepalive failed::$1"
  report failed
  exit 1
}

if [ -z "${BUDDYMIND_SUPABASE_URL:-}" ] || [ -z "${BUDDYMIND_SUPABASE_ANON_KEY:-}" ]; then
  echo "::notice::BUDDYMIND_SUPABASE_URL or BUDDYMIND_SUPABASE_ANON_KEY is not set, so the buddymind keepalive did not run."
  report unconfigured
  exit 0
fi

# A real read of a real table, not a health ping: the health endpoints answer
# from Supabase's gateway and never reach Postgres.
url="${BUDDYMIND_SUPABASE_URL%/}/rest/v1/behavioral_health_categories?select=id&limit=1"
body=$(curl -sS --max-time 20 --retry 2 --retry-delay 5 -w '\n%{http_code}' \
  -H "apikey: $BUDDYMIND_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $BUDDYMIND_SUPABASE_ANON_KEY" \
  -H 'Accept: application/json' "$url" 2>&1)
curl_status=$?
code=${body##*$'\n'}
body=${body%$'\n'*}

if [ $curl_status -eq 6 ]; then
  fail "the project's hostname does not resolve. That is what a paused (or deleted) Supabase project looks like."
fi
if [ $curl_status -ne 0 ]; then
  fail "the request did not complete (curl exit $curl_status): $(printf '%s' "$body" | tr '\n' ' ' | cut -c1-200)"
fi
if [ "$code" != 200 ]; then
  fail "the read returned HTTP $code: $(printf '%s' "$body" | tr '\n' ' ' | cut -c1-200)"
fi

rows=$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(Array.isArray(a)?a.length:-1)}catch{console.log(-1)}})')
if [ "$rows" = -1 ]; then
  fail "the read returned HTTP 200 but not a JSON array."
fi
if [ "$rows" = 0 ]; then
  # Postgres still ran the query, so the project was kept awake. But the app's
  # own category list reading empty means a policy or the data changed.
  echo "::notice::buddymind keepalive: the read reached the database but returned no rows. Check the RLS policy on behavioral_health_categories."
fi
echo "buddymind keepalive: read ok ($rows row)."
report ok
exit 0
