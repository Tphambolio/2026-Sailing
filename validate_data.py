111#!/usr/bin/env python3
"""Simple validator for the full stops JSON.

Checks:
- file is valid JSON and is a list
- required fields exist
- lat/lon are numbers and within valid ranges
- arrival <= departure when parseable
- flags placeholder values like 'User to research' or suspicious emojis in link

Exits with 0 if all checks pass, 1 if any issues are found.
"""
import json
import sys
import argparse
import re
from datetime import datetime
from pathlib import Path

REQUIRED_FIELDS = ["number", "name", "lat", "lon", "arrival", "departure", "duration", "distance", "type", "link", "season"]


def parse_date(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def remove_emojis(text: str) -> str:
    # Basic emoji/surrogate removal using regex ranges
    try:
        # remove surrogate pairs and common emoji ranges
        emoji_pattern = re.compile(
            "[\U00010000-\U0010ffff]",
            flags=re.UNICODE,
        )
        return emoji_pattern.sub('', text)
    except Exception:
        # Fallback: remove non-printable control chars
        return ''.join(ch for ch in text if ch.isprintable())


def main(path, fix=False, inplace=False):
    p = Path(path)
    if not p.exists():
        print(f"ERROR: file not found: {path}")
        return 1

    data = json.loads(p.read_text())
    if not isinstance(data, list):
        print("ERROR: top-level JSON is not a list")
        return 1

    ok = True
    cleaned = []
    for i, item in enumerate(data, start=1):
        row_ok = True
        missing = [f for f in REQUIRED_FIELDS if f not in item]
        if missing:
            print(f"Row {i}: missing fields: {missing}")
            row_ok = False

        # lat/lon
        try:
            lat = float(item.get("lat", 0))
            lon = float(item.get("lon", 0))
            if not (-90 <= lat <= 90):
                print(f"Row {i}: lat out of range: {lat}")
                row_ok = False
            if not (-180 <= lon <= 180):
                print(f"Row {i}: lon out of range: {lon}")
                row_ok = False
        except Exception:
            print(f"Row {i}: lat/lon not numeric: lat={item.get('lat')} lon={item.get('lon')}")
            row_ok = False

        # dates
        arrival_raw = item.get("arrival", "")
        departure_raw = item.get("departure", "")
        arrival = parse_date(arrival_raw)
        departure = parse_date(departure_raw)
        if arrival and departure and arrival > departure:
            print(f"Row {i}: arrival {arrival_raw} is after departure {departure_raw}")
            if fix:
                # swap if obvious mistake
                print(f"Row {i}: swapping arrival/departure to fix ordering")
                item["arrival"], item["departure"] = departure_raw, arrival_raw
                arrival, departure = departure, arrival
            else:
                row_ok = False

        # placeholder checks
        link = item.get("link", "")
        if isinstance(link, str) and "User to research" in link:
            print(f"Row {i}: placeholder in link field")
            if fix:
                item["link"] = ""
                print(f"Row {i}: cleared placeholder link")
            else:
                row_ok = False
        if isinstance(link, str) and "http" not in link and len(link) > 200:
            print(f"Row {i}: suspicious link content (too long / not a URL)")
            if fix:
                item["link"] = ""
            else:
                row_ok = False

        # normalize text fields: remove emojis/control chars if fix requested
        if fix:
            for k, v in list(item.items()):
                if isinstance(v, str):
                    cleaned_v = remove_emojis(v).strip()
                    item[k] = cleaned_v

        cleaned.append(item)
        if not row_ok:
            ok = False

    if fix and cleaned:
        out_path = p if inplace else p.with_name(p.stem + ".fixed" + p.suffix)
        out_path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2))
        print(f"Wrote cleaned output to: {out_path}")

    if ok:
        print("Validation passed: no issues found.")
        return 0
    else:
        print("Validation failed: see messages above.")
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Validate and optionally fix JSON data.")
    parser.add_argument("path", help="Path to the JSON file.")
    parser.add_argument("--fix", action="store_true", help="Attempt to fix issues.")
    parser.add_argument("--inplace", action="store_true", help="Modify the file in place when fixing.")
    args = parser.parse_args()
    sys.exit(main(args.path, fix=args.fix, inplace=args.inplace))
