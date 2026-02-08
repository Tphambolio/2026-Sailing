const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// Re-add manual waypoints for 13 routes that the algorithm
// can't solve but need visual routes on the map.
//
// These won't pass strict validation but will look correct
// on the Leaflet map (approximate water paths).
// ============================================================

const manualFixes = [
  // === BAY OF KOTOR (10m data models bay as land) ===
  ['Herceg Novi', 'Rose', [[42.46, 18.55]]],
  ['Rose', 'Perast', [[42.48, 18.62], [42.475, 18.68]]],
  ['Perast', 'Kotor', [[42.465, 18.73], [42.44, 18.76]]],
  ['Kotor', 'Tivat', [[42.45, 18.75], [42.465, 18.72], [42.45, 18.69]]],

  // === CROATIA ===
  // Šibenik → Split: around coast/islands
  ['Šibenik', 'Split', [[43.65, 16.0], [43.5, 16.2]]],

  // === TURKEY ===
  // Bodrum → Marmaris: south of Datça Peninsula
  ['Bodrum', 'Marmaris', [[36.9, 27.5], [36.65, 27.8], [36.6, 27.95], [36.62, 28.1]]],

  // === TURKEY ↔ CYPRUS (long open water crossings) ===
  // Anamur → Larnaca: west of Cyprus island
  ['Anamur', 'Larnaca', [[35.6, 32.2], [34.8, 32.1], [34.5, 33.0], [34.7, 33.4]]],
  // Larnaca → Anamur: reverse
  ['Larnaca', 'Anamur', [[34.7, 33.4], [34.5, 33.0], [34.8, 32.1], [35.6, 32.2]]],

  // === PELOPONNESE ===
  // Gytheio → Kalamata: around Mani Peninsula
  ['Gytheio', 'Kalamata', [[36.55, 22.3], [36.7, 22.0]]],

  // === CALABRIA ===
  // Sibari → Rossano: offshore east coast
  ['Sibari', 'Rossano', [[39.65, 16.7]]],
  // Rossano → Crotone: well offshore past Cape Colonna
  ['Rossano', 'Crotone', [[39.5, 17.05], [39.25, 17.2]]],
  // Roccella Ionica → Reggio Calabria: around toe of Italy
  ['Roccella Ionica', 'Reggio Calabria', [[38.1, 16.3], [37.85, 15.65], [37.95, 15.6]]],

  // === SICILY ===
  // Syracuse → Marina di Ragusa: around SE corner
  ['Syracuse', 'Marina di Ragusa', [[36.85, 15.25], [36.7, 14.9]]],
];

let applied = 0;
for (const [from, to, waypoints] of manualFixes) {
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].name === from && stops[i + 1].name === to) {
      stops[i].routeWaypoints = waypoints;
      console.log(`  ✓ ${stops[i].id} ${from} → ${to}: ${waypoints.length} wp`);
      applied++;
      break;
    }
  }
}

// Verify no routes without waypoints that should have them
let missing = 0;
for (let i = 0; i < stops.length - 1; i++) {
  if (!stops[i].routeWaypoints) missing++;
}

console.log(`\nApplied: ${applied} manual fixes`);
console.log(`Routes without any waypoints: ${missing} (should be direct water crossings)`);

fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2));
console.log('Saved to stops.json');
