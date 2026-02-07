/**
 * Download and prepare Natural Earth 1:10m land polygons
 * Includes individual islands (Vis, Hvar, Korčula, etc.) that the old
 * country-boundary data was missing.
 *
 * Uses ogr2ogr (GDAL) to convert shapefile → GeoJSON, clipped to Mediterranean.
 * Run once: node scripts/prepare-coastline.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, 'coastline.geojson');
const TEMP_DIR = path.join(__dirname, '_ne_temp');
const ZIP_PATH = path.join(TEMP_DIR, 'ne_10m_land.zip');
const NE_URL = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip';

// Mediterranean bounding box: west south east north
// Extended slightly to include all route coverage (Black Sea edge, Atlantic approach)
const CLIP_WEST = -6.0;
const CLIP_SOUTH = 30.0;
const CLIP_EAST = 37.0;
const CLIP_NORTH = 47.0;

async function main() {
  console.log('Natural Earth 1:10m Land → Mediterranean GeoJSON');
  console.log('=================================================\n');

  // Create temp directory
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Step 1: Download
  if (!fs.existsSync(ZIP_PATH)) {
    console.log('Downloading Natural Earth 10m land polygons...');
    execSync(`curl -L --progress-bar -o "${ZIP_PATH}" "${NE_URL}"`, { stdio: 'inherit' });
    console.log('');
  } else {
    console.log('Using cached download.');
  }

  // Step 2: Unzip
  console.log('Extracting shapefile...');
  execSync(`unzip -o -q "${ZIP_PATH}" -d "${TEMP_DIR}"`);

  const shpFile = path.join(TEMP_DIR, 'ne_10m_land.shp');
  if (!fs.existsSync(shpFile)) {
    console.error('ERROR: ne_10m_land.shp not found after unzip');
    process.exit(1);
  }

  // Step 3: Convert to GeoJSON with Mediterranean clip
  // -simplify 0.0005 ≈ 55m tolerance — keeps island shapes while reducing vertices
  console.log('Converting to GeoJSON (clipped to Mediterranean)...');
  const clipBox = `${CLIP_WEST} ${CLIP_SOUTH} ${CLIP_EAST} ${CLIP_NORTH}`;
  execSync(
    `ogr2ogr -f GeoJSON "${OUTPUT_PATH}" "${shpFile}" -clipsrc ${clipBox} -simplify 0.0005`,
    { stdio: 'inherit' }
  );

  // Step 4: Verify output
  const stats = fs.statSync(OUTPUT_PATH);
  const sizeKB = (stats.size / 1024).toFixed(0);
  console.log(`\nOutput: ${OUTPUT_PATH} (${sizeKB} KB)`);

  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  console.log(`Land polygons: ${data.features.length}`);

  // Quick island check — verify known Croatian islands are present
  const testPoints = [
    { name: 'Vis island', lon: 16.15, lat: 43.06 },
    { name: 'Hvar island', lon: 16.65, lat: 43.17 },
    { name: 'Korčula island', lon: 16.88, lat: 42.96 },
    { name: 'Crete', lon: 24.9, lat: 35.2 },
    { name: 'Cyprus', lon: 33.4, lat: 35.1 },
  ];

  // Use turf for point-in-polygon check (if available)
  try {
    const turf = await import('@turf/turf');
    console.log('\nIsland coverage check:');
    for (const tp of testPoints) {
      const pt = turf.point([tp.lon, tp.lat]);
      let found = false;
      for (const feature of data.features) {
        try {
          if (turf.booleanPointInPolygon(pt, feature)) {
            found = true;
            break;
          }
        } catch { continue; }
      }
      console.log(`  ${found ? '✓' : '✗'} ${tp.name} (${tp.lat}, ${tp.lon})`);
    }
  } catch {
    console.log('\n(Install @turf/turf to verify island coverage)');
  }

  // Step 5: Clean up temp files
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log('\nCleaned up temp files. Done!');
}

main().catch(err => {
  console.error('Failed:', err.message);
  // Clean up on error too
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  process.exit(1);
});
