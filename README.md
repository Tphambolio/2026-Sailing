# Mediterranean Odyssey Map (2026-Sailing)

This is a small static site that visualizes a Mediterranean sailing itinerary using Leaflet and JSON data files.

What I changed in the repository for easier local development:

- Moved the main dataset files to `data/`.
- Updated `index.html` to load `./data/full_stops_81_validated.json` and added basic error handling and a loading indicator.
- Added a small data validator `validate_data.py`.
- Added a `package.json` with a convenient `start` script that uses `npx http-server` for local serving.
- Added a GitHub Actions workflow to run the validator on PRs.

Quick start (recommended):

1. Serve the folder locally (option A — npm):

```bash
# optionally install http-server globally or use npx
npx http-server ./ -p 8080
# then open http://localhost:8080 in your browser
```

2. Or with Python's built-in server (option B):

```bash
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

Validation
----------
There's a small validation script that checks required fields, lat/lon ranges and simple date ordering.

Run it with:

```bash
python3 validate_data.py data/full_stops_81_validated.json
```

If you want me to extend this to automatically fix common problems or wire it into CI with stricter checks, tell me and I'll proceed.

Notes
-----
- The project currently uses static JSON files in `data/`. If you prefer hosting data remotely (CDN or API), update the fetch URL in `index.html` accordingly.
- Consider adding license and contributing information if you plan to share this publicly.

