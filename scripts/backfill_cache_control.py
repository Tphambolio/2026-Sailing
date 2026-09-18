#!/usr/bin/env python3
"""One-time backfill: re-upload every existing object in the sailing-stop-photos
bucket so its Cache-Control header matches the new 1-year value.

Why this is needed: Supabase Storage only sets response headers at upload
time (see uploadStopPhoto() in src/lib/supabase.ts) — you can't patch the
header by editing a DB row, so the ~465 files uploaded before that fix still
serve with the old 1hr Cache-Control and keep re-fetching from origin on
every repeat view. This script downloads each object and re-uploads it to
the exact same path with upsert=true and the new Cache-Control, which is a
byte-for-byte no-op on content but rewrites the stored response header.

Requires SUPABASE_SERVICE_ROLE_KEY in the environment — the anon key can't
list/read/write objects it doesn't own, which is most of them here (the app
mostly runs with signed-in users other than whoever runs this script). The
service role key bypasses RLS/storage-owner checks so every object can be
touched regardless of who originally uploaded it.

Usage:
    export SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Settings > API > service_role
    python3 scripts/backfill_cache_control.py [--dry-run]

Never commit this key or paste it anywhere outside your own shell.
"""

import os
import sys
import time

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://frxehymsydwsvhlecjqb.supabase.co")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "sailing-stop-photos"
NEW_CACHE_CONTROL = "31536000"  # 1 year, matches src/lib/supabase.ts
LIST_PAGE_SIZE = 100

if not SERVICE_ROLE_KEY:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY is not set. Export it from Settings > API > service_role and re-run.")

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
}


def list_folder(prefix: str) -> list[dict]:
    """One level of storage.list() — folders come back as entries with id=None."""
    entries: list[dict] = []
    offset = 0
    while True:
        resp = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}",
            headers=HEADERS,
            json={"prefix": prefix, "limit": LIST_PAGE_SIZE, "offset": offset,
                  "sortBy": {"column": "name", "order": "asc"}},
        )
        resp.raise_for_status()
        page = resp.json()
        entries.extend(page)
        if len(page) < LIST_PAGE_SIZE:
            break
        offset += LIST_PAGE_SIZE
    return entries


def list_all_objects() -> list[str]:
    """Bucket is organized as {stopKey}/{timestamp}.{ext} — one folder per stop.
    storage.list() only returns one level at a time, so list the top level to
    find stop-key folders, then list inside each to get the actual files."""
    all_objects: list[str] = []
    for entry in list_folder(""):
        if entry.get("id") is not None:
            # A file sitting directly at bucket root (unexpected, but handle it).
            all_objects.append(entry["name"])
            continue
        folder = entry["name"]
        for file_entry in list_folder(f"{folder}/"):
            if file_entry.get("id") is not None:
                all_objects.append(f"{folder}/{file_entry['name']}")
    return all_objects


def backfill_one(path: str) -> None:
    download = requests.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}", headers=HEADERS)
    download.raise_for_status()
    content_type = download.headers.get("Content-Type", "application/octet-stream")

    upload = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers={
            **HEADERS,
            "Content-Type": content_type,
            "cache-control": f"max-age={NEW_CACHE_CONTROL}",
            "x-upsert": "true",
        },
        data=download.content,
    )
    upload.raise_for_status()


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    print("Listing objects in bucket...")
    all_objects = list_all_objects()
    print(f"Found {len(all_objects)} objects.")

    if dry_run:
        print("--dry-run: not uploading anything. First 10 paths:")
        for path in all_objects[:10]:
            print(f"  {path}")
        return

    done = 0
    failures: list[str] = []
    for path in all_objects:
        try:
            backfill_one(path)
        except requests.HTTPError as err:
            failures.append(f"{path}: {err}")
        done += 1
        if done % 25 == 0 or done == len(all_objects):
            print(f"  {done}/{len(all_objects)} done...")
        time.sleep(0.05)  # light throttle — this is a one-time batch, no need to hammer the API

    print(f"\nBackfilled {done - len(failures)}/{len(all_objects)} objects.")
    if failures:
        print(f"{len(failures)} failures:")
        for f in failures:
            print(f"  {f}")


if __name__ == "__main__":
    main()
