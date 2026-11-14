#!/bin/sh
# Checks the free-print rule against the deployed function.
#   SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=... sh scripts/test-quota.sh
# Expect: free 2, 1, 0, then ok:false three times (same device, new device, forged IP header).
set -eu
DEV=$(uuidgen | tr 'A-Z' 'a-z')
call() { # device [extra curl args]
  d=$1; shift
  curl -s "$SUPABASE_URL/functions/v1/print" -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"device\":\"$d\",\"action\":\"${ACTION:-free}\",\"pack\":\"small\"}" "$@"; echo
}
for i in 1 2 3 4; do call "$DEV"; done
echo "new device, same IP (must be refused):"
call "$(uuidgen | tr 'A-Z' 'a-z')"
echo "forged X-Forwarded-For (must be refused):"
call "$(uuidgen | tr 'A-Z' 'a-z')" -H 'X-Forwarded-For: 203.0.113.9'
echo "paid balance: refused at 0, buy small = 5, spend = 4, another device still 0:"
W=$(uuidgen | tr 'A-Z' 'a-z')
ACTION=paid call "$W"; ACTION=buy call "$W"; ACTION=paid call "$W"
ACTION=check call "$(uuidgen | tr 'A-Z' 'a-z')"
