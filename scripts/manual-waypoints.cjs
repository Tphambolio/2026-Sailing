const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// Manual waypoints for routes the algorithm can't auto-solve
// Format: { fromName: [[lat, lon], ...] }
// Waypoints are ordered from start to end
// ============================================================

const manualWaypoints = {
  // === CROATIA ===
  // Šibenik → Split: go offshore past Trogir/Čiovo islands
  'Šibenik': [[43.65, 16.0], [43.5, 16.2]],

  // === BAY OF KOTOR (Montenegro fjord) ===
  // Herceg Novi → Rose: through outer bay
  'Herceg Novi': [[42.46, 18.55]],

  // Rose → Perast: through Verige Strait
  'Rose': [[42.48, 18.62], [42.475, 18.68]],

  // Perast → Kotor: around inner bay bend
  'Perast': [[42.465, 18.73], [42.44, 18.76]],

  // Kotor → Tivat: back through the bay
  'Kotor': [[42.45, 18.75], [42.465, 18.72], [42.45, 18.69]],

  // Budva → Sveti Stefan: short coastal hop
  'Budva': [[42.27, 18.87]],

  // === ALBANIA COAST ===
  // Durrës → Karpen Beach: south along coast
  'Durrës': [[41.22, 19.46]],

  // Karpen Beach → Vlorë: long coastal route
  'Karpen Beach': [[40.9, 19.42], [40.65, 19.42]],

  // Vlorë → Orikum: within Vlorë Bay
  'Vlorë': [[40.4, 19.47]],

  // Drymades Beach → Himara: around headland
  'Drymades Beach': [[40.12, 19.65]],

  // === GREECE (Ionian/Corfu) ===
  // Kassiopi → Kontokali Bay: down east coast of Corfu
  'Kassiopi': [[39.72, 19.92], [39.66, 19.88]],

  // Preveza → Lefkada Town: across the channel
  'Preveza': [[38.9, 20.73]],

  // === GREECE (Corinth/Saronic) ===
  // Galaxidi → Corinth Canal: across Gulf of Corinth
  'Galaxidi': [[38.25, 22.55], [38.05, 22.85]],

  // Corinth Canal → Aegina: through Saronic Gulf
  'Corinth Canal': [[37.88, 23.1], [37.82, 23.3]],

  // Spetses → Cape Sounion: past Hydra, NE across Myrtoan Sea
  'Spetses': [[37.35, 23.3], [37.5, 23.7]],

  // Kea → Ermoupoli: between islands
  'Kea': [[37.55, 24.6]],

  // Ermoupoli → Ornos Bay (Mykonos): between Syros and Mykonos
  'Ermoupoli (Syros)': [[37.44, 25.1]],

  // Ornos Bay → Naxos: south through Cyclades
  'Ornos Bay (Mykonos)': [[37.3, 25.35]],

  // === TURKEY ===
  // Bodrum → Marmaris: around Datça Peninsula
  'Bodrum': [[36.92, 27.55], [36.7, 27.85], [36.72, 28.1]],

  // Alanya → Anamur: along Turkish south coast
  'Alanya': [[36.4, 32.2], [36.2, 32.55]],

  // Anamur → Larnaca: CRITICAL - must go west of Cyprus island
  // Route: south from Anamur, west of Cape Kormakitis, south to Larnaca
  'Anamur': [[35.6, 32.2], [34.8, 32.1], [34.65, 33.0]],

  // Larnaca → Anamur: reverse of above
  'Larnaca': [[34.65, 33.0], [34.8, 32.1], [35.6, 32.2]],

  // Side → Antalya: along coast
  'Side': [[36.8, 31.05]],

  // === DODECANESE/CRETE ===
  // Kastellorizo → Lindos: west along Turkish/Greek coast
  'Kastellorizo': [[36.15, 29.0], [36.12, 28.5]],

  // Lindos → Chalki: around south Rhodes
  'Lindos (Rhodes)': [[36.0, 27.85]],

  // Chalki → Karpathos: between islands
  'Chalki': [[35.9, 27.4]],

  // === PELOPONNESE ===
  // Gytheio → Kalamata: around Mani Peninsula
  'Gytheio': [[36.65, 22.35], [36.8, 22.15]],

  // Katakolo → Zakynthos: across to island
  'Katakolo': [[37.72, 21.1]],

  // === CROSSING TO ITALY ===
  // Othoni → Santa Maria di Leuca: Strait of Otranto
  'Othoni': [[39.85, 19.0], [39.82, 18.7]],

  // === CALABRIA COAST (Italy) ===
  // Taranto → Policoro: along Gulf of Taranto
  'Taranto': [[40.35, 16.95]],

  // Policoro → Sibari: south along coast
  'Policoro': [[39.95, 16.58]],

  // Sibari → Rossano: along coast
  'Sibari': [[39.65, 16.55]],

  // Rossano → Crotone: around Cape Colonna
  'Rossano': [[39.35, 16.75], [39.12, 17.05]],

  // Roccella Ionica → Reggio Calabria: around the toe of Italy
  'Roccella Ionica': [[38.15, 16.2], [37.98, 15.85], [38.02, 15.68]],

  // Reggio Calabria → Giardini Naxos: across Strait of Messina
  'Reggio Calabria': [[38.0, 15.6], [37.92, 15.42]],

  // Giardini Naxos → Syracuse: down east Sicily coast
  'Giardini Naxos': [[37.5, 15.22], [37.2, 15.25]],

  // Syracuse → Marina di Ragusa: around SE corner of Sicily
  'Syracuse': [[36.9, 15.3], [36.73, 14.95], [36.74, 14.65]],
};

// Apply manual waypoints
let applied = 0;
let skipped = 0;

for (let i = 0; i < stops.length - 1; i++) {
  const stop = stops[i];
  const wp = manualWaypoints[stop.name];

  if (wp) {
    // Only apply if this stop doesn't already have waypoints
    if (!stop.routeWaypoints) {
      stop.routeWaypoints = wp;
      console.log(`  ✓ ${stop.id} ${stop.name} → ${stops[i+1].name}: ${wp.length} waypoint(s)`);
      applied++;
    } else {
      console.log(`  - ${stop.id} ${stop.name}: already has ${stop.routeWaypoints.length} waypoints (skip)`);
      skipped++;
    }
  }
}

// Handle special case: Anamur appears twice (outbound and return)
// The loop above only matches the FIRST Anamur. Fix the second one.
for (let i = 0; i < stops.length - 1; i++) {
  const stop = stops[i];
  const next = stops[i + 1];

  // Anamur → Alanya (return leg, index ~71)
  if (stop.name === 'Anamur' && next.name === 'Alanya' && !stop.routeWaypoints) {
    stop.routeWaypoints = [[36.2, 32.55], [36.4, 32.2]];
    console.log(`  ✓ ${stop.id} ${stop.name} → ${next.name}: 2 waypoint(s) [return leg]`);
    applied++;
  }

  // Larnaca → Anamur (index ~70) - check this was applied correctly
  if (stop.name === 'Larnaca' && next.name === 'Anamur' && !stop.routeWaypoints) {
    stop.routeWaypoints = [[34.65, 33.0], [34.8, 32.1], [35.6, 32.2]];
    console.log(`  ✓ ${stop.id} ${stop.name} → ${next.name}: 3 waypoint(s) [return to Turkey]`);
    applied++;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Applied: ${applied}`);
console.log(`Skipped (already had): ${skipped}`);

// Count remaining without waypoints where they might need them
let remaining = 0;
for (let i = 0; i < stops.length - 1; i++) {
  if (!stops[i].routeWaypoints) remaining++;
}
console.log(`Routes without waypoints: ${remaining} (these should be direct clear-water routes)`);

fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2));
console.log('\nSaved to stops.json');
