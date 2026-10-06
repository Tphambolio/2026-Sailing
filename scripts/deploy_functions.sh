#!/bin/bash
# Deploy the journal's Supabase edge functions. Run from anywhere:
#   bash ~/dev/sailing/2026-Sailing/scripts/deploy_functions.sh
# (Needs `supabase login` done once on this machine.)
set -e
cd "$(dirname "$0")/.."
for f in get-upload-url delete-photo google-photos-video; do
  echo "== deploying $f"
  supabase functions deploy "$f" --project-ref frxehymsydwsvhlecjqb --use-api
done
echo "Done."
