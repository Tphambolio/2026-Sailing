#!/bin/bash
# Nightly export of the journal's database content, run from cron on the OCI box.
#
# Saves journal text (sailing_stop_notes), photo records (sailing_stop_photos)
# and the itinerary (sailing_trip_stops) as gzipped JSON, keeps 30 days locally,
# and copies each night's set to R2 under backups/ (the photo Worker refuses to
# serve that prefix, and the bucket's public r2.dev URL is disabled).
# Photos themselves already live in R2; this covers the text and metadata that
# only exist in Supabase, which has no point-in-time recovery on the free plan.
#
# Uses the public anon key — the same read access the site has. Requires an
# rclone remote "r2-sailing" (scoped to the sailing-stop-photos bucket).
set -euo pipefail

PROJECT_URL="https://frxehymsydwsvhlecjqb.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyeGVoeW1zeWR3c3ZobGVjanFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNjI2NDIsImV4cCI6MjA4MzczODY0Mn0.AL5XS12d3SZlFm4YNcJxq5V46BAoj6oUrixYr0wB3GI"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/sailing-backups}"
KEEP_DAYS=30
STAMP=$(date -u +%Y-%m-%d)
DEST="$BACKUP_ROOT/$STAMP"
LOG="$BACKUP_ROOT/backup.log"

mkdir -p "$DEST"
log() { echo "[$(date -Iseconds)] $*" >> "$LOG"; }

fetch() {  # fetch <table> <query>
  local out="$DEST/$1.json"
  curl -sS --fail --max-time 120 "$PROJECT_URL/rest/v1/$1?$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Range: 0-99999" -o "$out"
  # A truncated/empty export is worse than none — refuse to keep it.
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d, list) and len(d) > 0" "$out"
  gzip -f "$out"
  echo "$1=$(zcat "$out.gz" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
}

if summary=$(fetch sailing_stop_notes 'select=*&order=stop_key' && fetch sailing_stop_photos 'select=*&order=created_at' && fetch sailing_trip_stops 'select=*'); then
  if rclone copy "$DEST" "r2-sailing:sailing-stop-photos/backups/$STAMP" 2>>"$LOG"; then
    log "OK $STAMP $(echo $summary | tr '\n' ' ') (local + R2)"
  else
    log "PARTIAL $STAMP $(echo $summary | tr '\n' ' ') — local only, R2 copy failed"
  fi
else
  log "FAILED $STAMP — export error, previous backups untouched"
  rm -rf "$DEST"
  exit 1
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +$KEEP_DAYS -exec rm -rf {} +
