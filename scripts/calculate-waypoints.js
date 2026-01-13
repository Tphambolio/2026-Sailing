/**
 * Calculate route waypoints to avoid land crossings
 * Uses Turf.js for geometry operations and coastline GeoJSON data
 *
 * SIMPLE APPROACH: For each route that crosses land, find a single offshore
 * waypoint that routes around the obstruction.
 */

import * as turf from '@turf/turf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STOPS_PATH = path.join(__dirname, '../src/data/stops.json');
const COASTLINE_PATH = path.join(__dirname, 'coastline.geojson');

// Download coastline data if not present
async function downloadCoastline() {
  if (fs.existsSync(COASTLINE_PATH)) {
    console.log('Coastline data already exists');
    return;
  }

  console.log('Downloading Mediterranean coastline data...');
  const url = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

  const response = await fetch(url);
  const data = await response.json();

  // Filter to Mediterranean countries only
  const medCountries = [
    'Italy', 'Croatia', 'Slovenia', 'Montenegro', 'Albania', 'Greece',
    'Turkey', 'Cyprus', 'Spain', 'France', 'Tunisia', 'Libya', 'Egypt',
    'Israel', 'Lebanon', 'Syria', 'Malta', 'Bosnia and Herzegovina',
    'Serbia', 'North Macedonia', 'Bulgaria'
  ];

  const filtered = {
    type: 'FeatureCollection',
    features: data.features.filter(f =>
      medCountries.includes(f.properties.ADMIN) ||
      medCountries.includes(f.properties.name)
    )
  };

  fs.writeFileSync(COASTLINE_PATH, JSON.stringify(filtered));
  console.log(`Saved coastline data with ${filtered.features.length} countries`);
}

// Load stops and coastline data
function loadData() {
  const stops = JSON.parse(fs.readFileSync(STOPS_PATH, 'utf8'));
  const coastline = JSON.parse(fs.readFileSync(COASTLINE_PATH, 'utf8'));
  return { stops, coastline };
}

// Check if a point is on land
function isOnLand(lon, lat, landPolygons) {
  const point = turf.point([lon, lat]);
  for (const feature of landPolygons.features) {
    try {
      if (turf.booleanPointInPolygon(point, feature)) {
        return true;
      }
    } catch (e) {
      continue;
    }
  }
  return false;
}

// Check if a line segment crosses land (sample multiple points along it)
function lineCrossesLand(startLon, startLat, endLon, endLat, landPolygons, samples = 10) {
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const lon = startLon + (endLon - startLon) * t;
    const lat = startLat + (endLat - startLat) * t;
    if (isOnLand(lon, lat, landPolygons)) {
      return true;
    }
  }
  return false;
}

// Find a waypoint that routes around land
// Strategy: Try pushing the midpoint perpendicular to the route, in both directions
function findOffshoreWaypoint(startLon, startLat, endLon, endLat, landPolygons) {
  const midLon = (startLon + endLon) / 2;
  const midLat = (startLat + endLat) / 2;

  // Calculate perpendicular direction
  const dx = endLon - startLon;
  const dy = endLat - startLat;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular vectors (normalized)
  const perpX = -dy / length;
  const perpY = dx / length;

  // Try increasing offsets until we find water AND clear routes
  const offsets = [0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6];

  for (const offset of offsets) {
    for (const direction of [1, -1]) {
      const testLon = midLon + perpX * offset * direction;
      const testLat = midLat + perpY * offset * direction;

      // Check if this point is in water
      if (isOnLand(testLon, testLat, landPolygons)) {
        continue;
      }

      // Check if BOTH segments (start->waypoint and waypoint->end) are clear
      const seg1Clear = !lineCrossesLand(startLon, startLat, testLon, testLat, landPolygons);
      const seg2Clear = !lineCrossesLand(testLon, testLat, endLon, endLat, landPolygons);

      if (seg1Clear && seg2Clear) {
        return { lon: testLon, lat: testLat };
      }
    }
  }

  return null;
}

// For complex routes, we may need multiple waypoints
// This iteratively adds waypoints until the route is clear
function calculateWaypoints(startLon, startLat, endLon, endLat, landPolygons, maxIterations = 3) {
  // First check if direct route is clear
  if (!lineCrossesLand(startLon, startLat, endLon, endLat, landPolygons)) {
    return [];
  }

  // Try to find a single waypoint solution
  const waypoint = findOffshoreWaypoint(startLon, startLat, endLon, endLat, landPolygons);

  if (waypoint) {
    return [[waypoint.lat, waypoint.lon]];
  }

  // If single waypoint doesn't work, try splitting the route in thirds
  // and finding waypoints for each segment
  if (maxIterations > 0) {
    const waypoints = [];

    // Try quarter points
    const points = [
      { lon: startLon + (endLon - startLon) * 0.33, lat: startLat + (endLat - startLat) * 0.33 },
      { lon: startLon + (endLon - startLon) * 0.66, lat: startLat + (endLat - startLat) * 0.66 }
    ];

    // Push each point offshore if it's on land
    for (const pt of points) {
      if (isOnLand(pt.lon, pt.lat, landPolygons)) {
        // Find nearest water point
        const dx = endLon - startLon;
        const dy = endLat - startLat;
        const length = Math.sqrt(dx * dx + dy * dy);
        const perpX = -dy / length;
        const perpY = dx / length;

        for (const offset of [0.05, 0.1, 0.15, 0.2, 0.3]) {
          for (const dir of [1, -1]) {
            const testLon = pt.lon + perpX * offset * dir;
            const testLat = pt.lat + perpY * offset * dir;
            if (!isOnLand(testLon, testLat, landPolygons)) {
              waypoints.push([testLat, testLon]);
              break;
            }
          }
          if (waypoints.length > 0) break;
        }
      } else {
        waypoints.push([pt.lat, pt.lon]);
      }
    }

    if (waypoints.length > 0) {
      return waypoints;
    }
  }

  console.log('  Warning: Could not find clear route');
  return [];
}

// Main processing function
async function main() {
  console.log('Route Waypoint Calculator (Simple Version)');
  console.log('==========================================\n');

  await downloadCoastline();

  const { stops, coastline } = loadData();
  console.log(`Loaded ${stops.length} stops and coastline data\n`);

  let updatedCount = 0;
  let clearedCount = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const next = stops[i + 1];

    // Check if direct route crosses land
    const crossesLand = lineCrossesLand(
      current.lon, current.lat,
      next.lon, next.lat,
      coastline
    );

    if (crossesLand) {
      console.log(`${current.name} -> ${next.name}: crosses land`);

      const waypoints = calculateWaypoints(
        current.lon, current.lat,
        next.lon, next.lat,
        coastline
      );

      if (waypoints.length > 0) {
        stops[i].routeWaypoints = waypoints;
        console.log(`  Added ${waypoints.length} waypoint(s)`);
        updatedCount++;
      } else {
        // Clear any existing waypoints
        if (stops[i].routeWaypoints) {
          delete stops[i].routeWaypoints;
        }
      }
    } else {
      // Route is clear, remove any existing waypoints
      if (stops[i].routeWaypoints) {
        delete stops[i].routeWaypoints;
        clearedCount++;
      }
    }
  }

  // Save updated stops
  fs.writeFileSync(STOPS_PATH, JSON.stringify(stops, null, 2));
  console.log(`\nDone! Added waypoints to ${updatedCount} routes, cleared ${clearedCount}`);
}

main().catch(console.error);
