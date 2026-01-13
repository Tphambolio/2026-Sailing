#!/usr/bin/env python3
"""Simple test harness for validate_data.py

Creates two small JSON files: one valid and one invalid and ensures the validator returns expected exit codes.
"""
import json
import subprocess
from pathlib import Path


def run(cmd):
    r = subprocess.run(cmd, shell=True)
    return r.returncode


def main():
    tmp = Path('tests/tmp')
    tmp.mkdir(parents=True, exist_ok=True)

    good = tmp / 'good.json'
    bad = tmp / 'bad.json'

    good_data = [
        {"number": 1, "name": "A", "lat": 45, "lon": 12, "arrival": "2026-07-01", "departure": "2026-07-02", "duration": "1 day", "distance": "10 km", "type": "Marina", "link": "https://example.com", "season": "summer"}
    ]

    bad_data = [
        {"number": 1, "name": "B", "lat": 95, "lon": 12, "arrival": "2026-07-05", "departure": "2026-07-01", "duration": "1 day", "distance": "10 km", "type": "Marina", "link": "User to research", "season": "summer"}
    ]

    good.write_text(json.dumps(good_data))
    bad.write_text(json.dumps(bad_data))

    print('Running validator on good.json (expect 0)')
    rc_good = run(f'python3 validate_data.py {good}')
    print('Exit code:', rc_good)

    print('Running validator on bad.json (expect non-zero)')
    rc_bad = run(f'python3 validate_data.py {bad}')
    print('Exit code:', rc_bad)

    if rc_good == 0 and rc_bad != 0:
        print('Tests passed')
        return 0
    else:
        print('Tests failed')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
