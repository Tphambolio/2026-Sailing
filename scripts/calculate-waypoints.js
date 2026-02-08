/**
 * Calculate route waypoints to avoid land crossings
 * Uses Turf.js for geometry operations and Natural Earth 10m coastline data
 * (includes individual islands: Vis, Hvar, Korčula, etc.)
 *
 * Usage:
 *   node scripts/calculate-waypoints.js            # Full recalculation
 *   node scripts/calculate-waypoints.js --validate  # Check only, no changes
 *
 * The coastline data must be prepared first with: node scripts/prepare-coastline.js
 */

import * as turf from '@turf/turf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STOPS_PATH = path.join(__dirname, '../src/data/stops.json');
const COASTLINE_PATH = path.join(__dirname, 'coastline.geojson');

// Number of sample points along a line for crossing detection
const LAND_SAMPLES = 25;

// Margin (0-0.5) to skip samples near start/end of a segment.
// Stops are on land (harbors/towns), so we skip the coastal zone.
// 0.12 → sample from t=0.12 to t=0.88 (generous for 10m coastline data)
const STOP_MARGIN = 0.12;

// Offsets to try (in degrees) when finding offshore waypoints
// 0.01° ≈ 1.1km at Mediterranean latitudes
const OFFSETS_SMALL = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15
];
// Larger offsets only for single-waypoint strategies (not recursive)
const OFFSETS_LARGE = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08,
  0.1, 0.12, 0.15, 0.2, 0.25, 0.3
];
// For backwards compat
const OFFSETS = OFFSETS_LARGE;

const VALIDATE_MODE = process.argv.includes('--validate');

// ─── Data Loading ──────────────────────────────────────────────

function loadData() {
  if (!fs.existsSync(COASTLINE_PATH)) {
    console.error('ERROR: coastline.geojson not found.');
    console.error('Run first: node scripts/prepare-coastline.js');
    process.exit(1);
  }

  const stops = JSON.parse(fs.readFileSync(STOPS_PATH, 'utf8'));
  const coastline = JSON.parse(fs.readFileSync(COASTLINE_PATH, 'utf8'));
  return { stops, coastline };
}

// ─── Geometry Helpers ──────────────────────────────────────────

function isOnLand(lon, lat, land) {
  const pt = turf.point([lon, lat]);
  for (const feature of land.features) {
    try {
      if (turf.booleanPointInPolygon(pt, feature)) return true;
    } catch { continue; }
  }
  return false;
}

/**
 * Check if a straight line between two points crosses land.
 * `margin` skips samples near endpoints (for coastal stops).
 */
function lineCrossesLand(sLon, sLat, eLon, eLat, land, margin = 0) {
  for (let i = 1; i < LAND_SAMPLES; i++) {
    const t = i / LAND_SAMPLES;
    if (t < margin || t > (1 - margin)) continue;
    if (isOnLand(sLon + (eLon - sLon) * t, sLat + (eLat - sLat) * t, land)) return true;
  }
  return false;
}

/**
 * Check if a full waypoint path is clear of land.
 * Uses margin near stop endpoints only (first/last segment).
 */
function pathClear(sLon, sLat, waypoints, eLon, eLat, land) {
  let pLon = sLon, pLat = sLat;

  for (let w = 0; w < waypoints.length; w++) {
    const [wLat, wLon] = waypoints[w];
    const margin = (w === 0) ? STOP_MARGIN : 0;
    if (lineCrossesLand(pLon, pLat, wLon, wLat, land, margin)) return false;
    pLon = wLon;
    pLat = wLat;
  }

  // Last segment to destination
  return !lineCrossesLand(pLon, pLat, eLon, eLat, land, STOP_MARGIN);
}

function perpendicular(dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [0, 0];
  return [-dy / len, dx / len];
}

/**
 * Sort waypoints by their projection onto the start→end vector.
 * Prevents zigzag patterns from recursive splitting.
 */
function sortWaypointsByProgress(sLon, sLat, eLon, eLat, waypoints) {
  if (waypoints.length <= 1) return waypoints;
  const dx = eLon - sLon;
  const dy = eLat - sLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return waypoints;

  return [...waypoints].sort((a, b) => {
    const [aLat, aLon] = a;
    const [bLat, bLon] = b;
    const tA = ((aLon - sLon) * dx + (aLat - sLat) * dy) / lenSq;
    const tB = ((bLon - sLon) * dx + (bLat - sLat) * dy) / lenSq;
    return tA - tB;
  });
}

// ─── Waypoint Calculation ──────────────────────────────────────

/**
 * Find a single offshore waypoint that creates a clear route,
 * testing perpendicular offsets from a point at parameter `t`.
 */
function findClearWaypoint(sLon, sLat, eLon, eLat, land, t = 0.5) {
  const bLon = sLon + (eLon - sLon) * t;
  const bLat = sLat + (eLat - sLat) * t;

  const [perpX, perpY] = perpendicular(eLon - sLon, eLat - sLat);

  for (const offset of OFFSETS) {
    for (const dir of [1, -1]) {
      const tLon = bLon + perpX * offset * dir;
      const tLat = bLat + perpY * offset * dir;

      if (isOnLand(tLon, tLat, land)) continue;

      if (!lineCrossesLand(sLon, sLat, tLon, tLat, land, STOP_MARGIN) &&
          !lineCrossesLand(tLon, tLat, eLon, eLat, land, STOP_MARGIN)) {
        return [tLat, tLon];
      }
    }
  }
  return null;
}

/**
 * Calculate waypoints to route around land.
 *
 * Strategies (tried in order):
 * 1. Single waypoint at midpoint
 * 2. Single waypoint at 1/3, 2/3, 1/4, 3/4
 * 3. Recursive split — find water midpoint, solve each half
 * 4. Parallel 3-point offset (all three at same perpendicular offset)
 */
function calculateWaypoints(sLon, sLat, eLon, eLat, land, depth = 0) {
  if (!lineCrossesLand(sLon, sLat, eLon, eLat, land, depth === 0 ? STOP_MARGIN : 0)) {
    return [];
  }

  if (depth > 2) return [];

  const dx = eLon - sLon, dy = eLat - sLat;
  const [perpX, perpY] = perpendicular(dx, dy);

  // Strategy 1: Single waypoint at midpoint (use large offsets)
  const mid = findClearWaypoint(sLon, sLat, eLon, eLat, land, 0.5);
  if (mid) return [mid];

  // Strategy 2: Single waypoint at other positions (use large offsets)
  for (const t of [0.33, 0.67, 0.25, 0.75]) {
    const wp = findClearWaypoint(sLon, sLat, eLon, eLat, land, t);
    if (wp) return [wp];
  }

  // Strategy 3: Parallel 3-point offset (smooth, avoids zigzag)
  for (const offset of OFFSETS_LARGE) {
    for (const dir of [1, -1]) {
      const pts = [0.25, 0.5, 0.75].map(t => {
        const pLon = sLon + dx * t + perpX * offset * dir;
        const pLat = sLat + dy * t + perpY * offset * dir;
        return [pLat, pLon];
      });

      if (pts.some(([lat, lon]) => isOnLand(lon, lat, land))) continue;
      if (pathClear(sLon, sLat, pts, eLon, eLat, land)) return pts;
    }
  }

  // Strategy 4: Parallel 5-point offset (for complex routes)
  for (const offset of OFFSETS_LARGE) {
    for (const dir of [1, -1]) {
      const pts = [0.15, 0.3, 0.5, 0.7, 0.85].map(t => {
        const pLon = sLon + dx * t + perpX * offset * dir;
        const pLat = sLat + dy * t + perpY * offset * dir;
        return [pLat, pLon];
      });

      if (pts.some(([lat, lon]) => isOnLand(lon, lat, land))) continue;
      if (pathClear(sLon, sLat, pts, eLon, eLat, land)) return pts;
    }
  }

  // Strategy 5: Recursive split (small offsets only, limited depth)
  if (depth < 2) {
    const midLon = (sLon + eLon) / 2, midLat = (sLat + eLat) / 2;
    for (const offset of OFFSETS_SMALL) {
      for (const dir of [1, -1]) {
        const spLon = midLon + perpX * offset * dir;
        const spLat = midLat + perpY * offset * dir;
        if (isOnLand(spLon, spLat, land)) continue;

        const half1 = calculateWaypoints(sLon, sLat, spLon, spLat, land, depth + 1);
        const half2 = calculateWaypoints(spLon, spLat, eLon, eLat, land, depth + 1);
        const combined = [...half1, [spLat, spLon], ...half2];

        if (pathClear(sLon, sLat, combined, eLon, eLat, land)) {
          return combined;
        }
      }
    }
  }

  return [];
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('Route Waypoint Calculator (Natural Earth 10m)');
  console.log(VALIDATE_MODE ? 'Mode: VALIDATE (no changes)' : 'Mode: FULL');
  console.log('='.repeat(50) + '\n');

  const { stops, coastline } = loadData();
  console.log(`Loaded ${stops.length} stops, ${coastline.features.length} land polygons\n`);

  let clear = 0, fixed = 0, failed = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const cur = stops[i];
    const nxt = stops[i + 1];
    const label = `${cur.id}. ${cur.name} → ${nxt.name}`;

    const crosses = lineCrossesLand(cur.lon, cur.lat, nxt.lon, nxt.lat, coastline, STOP_MARGIN);

    if (!crosses) {
      // Direct route clear — remove any old waypoints
      if (!VALIDATE_MODE && cur.routeWaypoints) delete cur.routeWaypoints;
      clear++;
      continue;
    }

    // Calculate new waypoints
    const waypoints = VALIDATE_MODE
      ? []
      : calculateWaypoints(cur.lon, cur.lat, nxt.lon, nxt.lat, coastline);

    if (VALIDATE_MODE) {
      // Just report
      const existing = cur.routeWaypoints?.length || 0;
      const ok = existing > 0 && pathClear(cur.lon, cur.lat, cur.routeWaypoints, nxt.lon, nxt.lat, coastline);
      if (ok) {
        console.log(`  ✓ ${label}: ${existing} waypoints OK`);
        fixed++;
      } else {
        console.log(`  ✗ ${label}: crosses land${existing ? ` (${existing} wp broken)` : ''}`);
        failed++;
      }
    } else if (waypoints.length > 0) {
      // Sort waypoints by progression along the route to prevent zigzag
      const sorted = sortWaypointsByProgress(cur.lon, cur.lat, nxt.lon, nxt.lat, waypoints);
      if (pathClear(cur.lon, cur.lat, sorted, nxt.lon, nxt.lat, coastline)) {
        cur.routeWaypoints = sorted;
        console.log(`✓ ${label}: ${sorted.length} waypoint(s)`);
        fixed++;
      } else if (pathClear(cur.lon, cur.lat, waypoints, nxt.lon, nxt.lat, coastline)) {
        // Fall back to unsorted if sorted breaks the path
        cur.routeWaypoints = waypoints;
        console.log(`✓ ${label}: ${waypoints.length} waypoint(s) (unsorted)`);
        fixed++;
      } else {
        console.log(`✗ ${label}: could not auto-fix (waypoints don't clear)`);
        if (cur.routeWaypoints) delete cur.routeWaypoints;
        failed++;
      }
    } else {
      console.log(`✗ ${label}: could not auto-fix`);
      if (cur.routeWaypoints) delete cur.routeWaypoints;
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Direct clear: ${clear} | Fixed: ${fixed} | Unfixed: ${failed}`);
  console.log(`Total: ${clear + fixed + failed} routes, ${Math.round((clear + fixed) / (clear + fixed + failed) * 100)}% resolved`);

  if (!VALIDATE_MODE) {
    fs.writeFileSync(STOPS_PATH, JSON.stringify(stops, null, 2));
    console.log(`\nSaved to ${STOPS_PATH}`);
  }
}

main().catch(console.error);
