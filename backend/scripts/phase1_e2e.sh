#!/usr/bin/env bash
# End-to-end test of every Phase 1 flow against a running API ($BASE).
# Asserts pass/fail and exits non-zero if anything fails.
#
#   BASE=http://localhost:8099/api/v1 bash scripts/phase1_e2e.sh
set -uo pipefail

B="${BASE:-http://localhost:8099/api/v1}"
PASS=0; FAIL=0
pass(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail(){ printf '  \033[31mFAIL\033[0m %s — %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
section(){ printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

STATUS=""; BODY=""
api(){ # method path [token] [body]
  local method=$1 path=$2 token=${3:-} body=${4:-}
  local args=(-s -X "$method" "$B$path" -w $'\n%{http_code}' -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  local out; out=$(curl "${args[@]}")
  STATUS=$(printf '%s' "$out" | tail -1)
  BODY=$(printf '%s' "$out" | sed '$d')
}
jget(){ printf '%s' "$BODY" | python3 -c "import sys,json
try: v=json.load(sys.stdin)$1; print('' if v is None else v)
except Exception: print('NULL')"; }
assert_status(){ [ "$STATUS" = "$2" ] && pass "$1" || fail "$1" "status expected $2 got $STATUS ($BODY)"; }
assert_status_ge(){ [ "$STATUS" -ge "$2" ] 2>/dev/null && pass "$1" || fail "$1" "status expected >=$2 got $STATUS ($BODY)"; }
assert_eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1" "expected [$3] got [$2]"; }

TS=$(date +%s)
iso(){ python3 -c "import datetime;print((datetime.datetime.utcnow()+datetime.timedelta(days=$1)).strftime('%Y-%m-%dT%H:%M:%SZ'))"; }
PAST2=$(iso -2); FUT2=$(iso 2); FUT30=$(iso 30); FUT1=$(iso 1)

reg(){ # name emailkey phone  -> echoes access token
  api POST /auth/register "" "{\"name\":\"$1\",\"email\":\"${2}_${TS}@ex.com\",\"password\":\"secret-password\",\"phone\":\"$3\",\"age\":30,\"city\":\"Pune\",\"running_level\":\"amateur\"}"
  jget "['access_token']"
}

# ───────────────────────────────────────────────────────────────
section "Health"
api GET /health
assert_status "health 200" 200

section "Auth + profile"
APHONE="+9199${RANDOM}001"; MPHONE="+9199${RANDOM}002"; M2PHONE="+9199${RANDOM}003"
ADMIN=$(reg Admin admin "$APHONE"); assert_eq "register returns token" "$([ -n "$ADMIN" ] && echo ok)" ok
MEM=$(reg Runner runner "$MPHONE")
MEM2=$(reg Runner2 runner2 "$M2PHONE")
# missing mandatory field -> rejected
api POST /auth/register "" "{\"email\":\"x_${TS}@ex.com\",\"password\":\"secret-password\"}"
assert_status_ge "register missing fields rejected" 400
# duplicate email -> rejected
api POST /auth/register "" "{\"name\":\"Dup\",\"email\":\"admin_${TS}@ex.com\",\"password\":\"secret-password\",\"phone\":\"+9199${RANDOM}009\",\"age\":22,\"city\":\"Pune\",\"running_level\":\"amateur\"}"
assert_status_ge "duplicate email rejected" 400
# login
api POST /auth/login "" "{\"email\":\"admin_${TS}@ex.com\",\"password\":\"secret-password\"}"
assert_status "login 200" 200
REFRESH=$(jget "['refresh_token']")
# refresh rotates
api POST /auth/refresh "" "{\"refresh_token\":\"$REFRESH\"}"
assert_status "refresh 200" 200
# me + update
api GET /users/me "$ADMIN"; assert_status "GET me 200" 200
ADMIN_ID=$(jget "['id']")
# PUT /users/me is a full replace — all mandatory fields required (incl. phone)
api PUT /users/me "$ADMIN" "{\"name\":\"Admin Renamed\",\"phone\":\"$APHONE\",\"age\":31,\"city\":\"Mumbai\",\"running_level\":\"advanced\"}"
assert_status "PUT me 200" 200
assert_eq "profile updated" "$(jget "['name']")" "Admin Renamed"
MEM_ID=$(api GET /users/me "$MEM"; jget "['id']")
MEM2_ID=$(api GET /users/me "$MEM2"; jget "['id']")

section "Org + chapter"
api GET /chapters/mine "$ADMIN"; assert_status "chapters/mine 200 (empty)" 200
assert_eq "empty list is [] not null" "$BODY" "[]"
api POST /organisations "$ADMIN" '{"name":"ClubMitra Test Org"}'
assert_status_ge "create org 2xx" 200
OID=$(jget "['id']")
api PUT "/organisations/$OID" "$ADMIN" '{"name":"Org Renamed","description":"d"}'
assert_status "update org 200" 200
# chapter with approval + fee
api POST "/organisations/$OID/chapters" "$ADMIN" "{\"name\":\"Pune Chapter\",\"city\":\"Pune\",\"requires_approval\":true,\"membership_fee_enabled\":true,\"membership_fee_amount\":500,\"membership_period\":\"monthly\"}"
assert_status_ge "create chapter 2xx" 200
CID=$(jget "['id']"); CODE=$(jget "['invite_code']")
assert_eq "creator auto-enrolled (chapters/mine)" "$(api GET /chapters/mine "$ADMIN"; jget "[0]['id']")" "$CID"
# open chapter (no approval, no fee)
api POST "/organisations/$OID/chapters" "$ADMIN" '{"name":"Open Chapter","city":"Mumbai","requires_approval":false}'
OPEN_CID=$(jget "['id']"); OPEN_CODE=$(jget "['invite_code']")

section "Roles + permissions"
# member (non-admin) cannot create a chapter under the org
api POST "/organisations/$OID/chapters" "$MEM" '{"name":"Nope","city":"Pune"}'
assert_status_ge "non-admin chapter create blocked" 400
# assign MEM2 as chapter_admin
api POST "/organisations/$OID/roles" "$ADMIN" "{\"user_id\":\"$MEM2_ID\",\"chapter_id\":\"$CID\",\"role\":\"chapter_admin\"}"
assert_status_ge "assign chapter_admin ok" 200

section "Join flow: approval + fee + subscription"
# MEM joins approval+fee chapter -> pending
api POST /chapters/join "$MEM" "{\"invite_code\":\"$CODE\"}"
assert_status "join (approval) 200" 200
assert_eq "status pending" "$(jget "['status']")" pending
# admin approves -> pending_payment (fee enabled)
api POST "/chapters/$CID/members/$MEM_ID/approve" "$ADMIN"
assert_status "approve 200" 200
assert_eq "status pending_payment" "$(jget "['status']")" pending_payment
# pay -> active
api POST "/chapters/$CID/pay" "$MEM"
assert_status "pay 200" 200
assert_eq "status active after pay" "$(jget "['status']")" active
# renew immediately -> blocked (outside renewal window)
api POST "/chapters/$CID/pay" "$MEM"
assert_status_ge "early renewal blocked" 400
# open chapter join -> active immediately
api POST /chapters/join "$MEM2" "{\"invite_code\":\"$OPEN_CODE\"}"
assert_eq "open chapter join -> active" "$(jget "['status']")" active

section "Members"
api GET "/chapters/$CID/members" "$ADMIN"; assert_status "list members 200" 200
api GET "/chapters/$CID/members/$MEM_ID" "$ADMIN"; assert_status "member detail 200" 200
api PUT "/chapters/$CID/members/$MEM_ID" "$ADMIN" '{"status":"suspended"}'
assert_status "set member status 204" 204
api DELETE "/chapters/$CID/members/$MEM_ID" "$ADMIN"
assert_status_ge "soft delete member ok" 200

section "Attendance"
api POST /runs "$ADMIN" "{\"chapter_id\":\"$CID\",\"title\":\"Sunday Long Run\",\"scheduled_at\":\"$FUT2\",\"location\":\"Riverside\",\"distance_target\":10}"
assert_status_ge "schedule run 2xx" 200
RUN=$(jget "['id']")
# optional time (date only) — re-fetch and confirm has_time stuck
api POST /runs "$ADMIN" "{\"chapter_id\":\"$CID\",\"title\":\"TBD Run\",\"scheduled_at\":\"$FUT1\",\"has_time\":false}"
TBD=$(jget "['id']")
api GET "/runs/$TBD" "$ADMIN"
assert_eq "has_time=false honored" "$(jget "['has_time']")" "False"
# recurring bulk
api POST /runs/bulk "$ADMIN" "{\"chapter_id\":\"$CID\",\"title\":\"Weekly Tempo\",\"scheduled_at\":\"$FUT2\",\"scheduled_ats\":[\"$FUT2\",\"$FUT30\"]}"
assert_status_ge "bulk schedule ok" 200
api GET "/runs?chapter_id=$CID" "$ADMIN"; assert_status "list runs 200" 200
api GET "/runs/$RUN" "$ADMIN"; assert_status "get run 200" 200
api PUT "/runs/$RUN" "$ADMIN" "{\"title\":\"Edited Run\",\"scheduled_at\":\"$FUT2\"}"
assert_status "edit run 200" 200
api POST "/runs/$RUN/checkin" "$MEM2"; assert_status_ge "checkin ok" 200
api GET "/runs/$RUN/attendance" "$ADMIN"; assert_status "attendance list 200" 200
api POST "/runs/$RUN/checkout" "$MEM2" '{"notes":"left early"}'; assert_status_ge "checkout ok" 200

section "Challenges"
# challenge with join fee + lock date (upcoming)
api POST /challenges "$ADMIN" "{\"title\":\"June 100K\",\"type\":\"distance\",\"visibility\":\"public\",\"target_km\":100,\"start_date\":\"$FUT2\",\"end_date\":\"$FUT30\",\"join_fee\":200,\"lock_date\":\"$FUT1\"}"
assert_status_ge "create challenge 2xx" 200
CH=$(jget "['id']")
api GET /challenges "$MEM2"; assert_status "list challenges 200" 200
api GET "/challenges/$CH" "$MEM2"; assert_status "get challenge 200" 200
# join without paying the fee -> 402
api POST "/challenges/$CH/join" "$MEM2" '{}'
assert_status "join without fee -> 402" 402
# join with paid -> joined
api POST "/challenges/$CH/join" "$MEM2" '{"paid":true}'
assert_status "paid join 200" 200
# leave (before lock) -> ok
api POST "/challenges/$CH/leave" "$MEM2" '{}'
assert_status_ge "leave before lock ok" 200
# already-started challenge: joining closed
api POST /challenges "$ADMIN" "{\"title\":\"Started\",\"type\":\"distance\",\"visibility\":\"public\",\"target_km\":50,\"start_date\":\"$PAST2\",\"end_date\":\"$FUT30\"}"
STARTED=$(jget "['id']")
api POST "/challenges/$STARTED/join" "$MEM2" '{}'
assert_status_ge "join after start blocked" 400
# proof + verify (free challenge)
api POST /challenges "$ADMIN" "{\"title\":\"Proof Test\",\"type\":\"distance\",\"visibility\":\"public\",\"target_km\":50,\"start_date\":\"$PAST2\",\"end_date\":\"$FUT30\"}"
PCH=$(jget "['id']")
PDATE=$(python3 -c "import datetime;print(datetime.date.today().isoformat())")
api POST "/challenges/$PCH/proof" "$MEM2" "{\"strava_link\":\"https://strava.com/x\",\"km_claimed\":12.5,\"proof_date\":\"$PDATE\"}"
assert_status_ge "submit proof ok" 200
PID=$(jget "['id']")
api GET "/challenges/$PCH/proof" "$ADMIN"; assert_status "review queue 200" 200
api POST "/challenges/$PCH/proof/$PID/verify" "$ADMIN"
assert_status_ge "verify proof ok" 200
api GET "/challenges/$PCH/leaderboard" "$MEM2"
assert_status "leaderboard 200" 200
assert_eq "leaderboard credited submitter" "$(jget "[0]['score']")" "12.5"

section "Push notifications"
api POST /push/token "$ADMIN" '{"token":"ExponentPushToken[cm-admin-test]","platform":"ios"}'
assert_status "register push token 204" 204
api DELETE /push/token "$ADMIN" '{"token":"ExponentPushToken[cm-admin-test]"}'
assert_status "unregister push token 204" 204

# ───────────────────────────────────────────────────────────────
printf '\n\033[1m──────────────────────────────\033[0m\n'
printf '\033[1mPASSED: %d   FAILED: %d\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "ALL GREEN"; exit 0; } || exit 1
