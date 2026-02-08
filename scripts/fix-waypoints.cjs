const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// Fix waypoints that failed validation
// Coordinates verified against coastline GeoJSON
// ============================================================

// Map: [fromStopName, toStopName] → corrected waypoints [lat, lon]
const fixes = [
  // === BAY OF KOTOR ===
  // 10m coastline data models the entire bay as land, so validation
  // will always fail for these. Keep reasonable water-path waypoints.
  // (No changes — already have decent visual waypoints)

  // === ALBANIA COAST ===
  // Durrës → Karpen Beach: push further offshore
  ['Durrës', 'Karpen Beach', [[41.22, 19.35]]],

  // Karpen Beach → Vlorë: stay well offshore
  ['Karpen Beach', 'Vlorë', [[40.9, 19.3], [40.65, 19.3]]],

  // Vlorë → Orikum: push west in Vlorë Bay
  ['Vlorë', 'Orikum', [[40.42, 19.42], [40.38, 19.44]]],

  // === CORFU ===
  // Kassiopi → Kontokali: hug east coast of Corfu
  ['Kassiopi', 'Kontokali Bay (Corfu)', [[39.72, 19.95], [39.68, 19.92]]],

  // === CYCLADES ===
  // Kea → Ermoupoli: navigate around Gyaros
  ['Kea', 'Ermoupoli (Syros)', [[37.55, 24.5], [37.5, 24.65]]],

  // === TURKEY - DATÇA PENINSULA ===
  // Bodrum → Marmaris: go south of Datça Peninsula
  ['Bodrum', 'Marmaris', [[36.9, 27.5], [36.65, 27.8], [36.6, 27.9], [36.62, 28.0]]],

  // === TURKEY SOUTH COAST ===
  // Alanya → Anamur: stay well offshore
  ['Alanya', 'Anamur', [[36.45, 32.0], [36.35, 32.1], [35.95, 32.8]]],

  // Side → Antalya: stay offshore
  ['Side', 'Antalya', [[36.78, 31.0]]],

  // === TURKEY ↔ CYPRUS ===
  // Anamur → Larnaca: go WEST of Cyprus
  ['Anamur', 'Larnaca', [[35.6, 32.2], [34.8, 32.1], [34.5, 33.0], [34.7, 33.4]]],

  // Larnaca → Anamur: reverse route west of Cyprus
  ['Larnaca', 'Anamur', [[34.7, 33.4], [34.5, 33.0], [34.8, 32.1], [35.6, 32.2]]],

  // Anamur → Alanya (return): stay offshore
  ['Anamur', 'Alanya', [[35.95, 32.8], [36.35, 32.1], [36.45, 32.0]]],

  // === DODECANESE ===
  // Lindos → Chalki: go south around Rhodes
  ['Lindos (Rhodes)', 'Chalki', [[35.85, 27.75]]],

  // === PELOPONNESE ===
  // Gytheio → Kalamata: around Mani Peninsula
  ['Gytheio', 'Kalamata', [[36.55, 22.3], [36.7, 22.0]]],

  // === CALABRIA COAST ===
  // Taranto → Policoro: along Gulf of Taranto
  ['Taranto', 'Policoro', [[40.3, 16.95]]],

  // Policoro → Sibari: offshore
  ['Policoro', 'Sibari', [[39.9, 16.7]]],

  // Sibari → Rossano: offshore
  ['Sibari', 'Rossano', [[39.65, 16.7]]],

  // Rossano → Crotone: well offshore, around Capo Colonna
  ['Rossano', 'Crotone', [[39.5, 17.0], [39.25, 17.15]]],

  // Roccella Ionica → Reggio Calabria: around toe of Italy
  ['Roccella Ionica', 'Reggio Calabria', [[38.1, 16.3], [37.88, 15.55], [37.95, 15.65]]],

  // === SICILY ===
  // Syracuse → Marina di Ragusa: around SE corner of Sicily
  ['Syracuse', 'Marina di Ragusa', [[36.85, 15.2], [36.72, 14.9]]],
];

// Apply fixes
let fixed = 0;
for (const [fromName, toName, waypoints] of fixes) {
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].name === fromName && stops[i + 1].name === toName) {
      stops[i].routeWaypoints = waypoints;
      console.log(`  ✓ ${stops[i].id} ${fromName} → ${toName}: ${waypoints.length} wp`);
      fixed++;
      break;
    }
  }
}

console.log(`\nFixed: ${fixed} routes`);

fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2));
console.log('Saved to stops.json');
