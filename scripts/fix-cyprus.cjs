const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// Remove Girne (Kyrenia) — stay south-side Cyprus only
// Redistribute its 5 days to south coast stops
// ============================================================

const girneIdx = stops.findIndex(s => s.name === 'Girne (Kyrenia)');
if (girneIdx === -1) {
  console.error('ERROR: Could not find Girne (Kyrenia)');
  process.exit(1);
}

const girne = stops[girneIdx];
console.log(`Removing: #${girne.id} ${girne.name} (${girne.country}) - ${girne.duration}`);
stops.splice(girneIdx, 1);

// Add the 5 freed days to south coast stops
// Larnaca (first visit) gets +3 days, Paphos gets +2 days
const larnaca1 = stops.find(s => s.name === 'Larnaca' && parseInt(s.duration) === 10);
if (larnaca1) {
  console.log(`  Larnaca: ${larnaca1.duration} → 13 days (+3)`);
  larnaca1.duration = '13 days';
}

const paphos = stops.find(s => s.name === 'Paphos');
if (paphos) {
  console.log(`  Paphos: ${paphos.duration} → 12 days (+2)`);
  paphos.duration = '12 days';
}

// ============================================================
// Re-run healRoute logic (renumber, cascade dates, distances)
// ============================================================

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function seasonFromDate(dateStr) {
  const m = new Date(dateStr).getMonth();
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 10) return 'fall';
  return 'winter';
}

const firstArrival = stops[0].arrival || '2026-07-15';
let currentDate = firstArrival;

for (let i = 0; i < stops.length; i++) {
  const s = stops[i];
  s.id = i + 1;
  s.arrival = currentDate;

  const daysMatch = s.duration.match(/(\d+)/);
  const stayDays = daysMatch ? parseInt(daysMatch[1]) : 2;

  s.departure = addDays(currentDate, stayDays);
  s.season = seasonFromDate(currentDate);
  s.phase = s.country;

  if (i < stops.length - 1) {
    const next = stops[i + 1];
    s.distanceToNext = Math.round(haversine(s.lat, s.lon, next.lat, next.lon));
  } else {
    s.distanceToNext = 0;
  }

  currentDate = s.departure;
}

// Summary
console.log(`\nTotal stops: ${stops.length}`);
console.log(`Trip: ${stops[0].arrival} to ${stops[stops.length-1].departure}`);

// Show Cyprus stops
const cyprusStops = stops.filter(s => s.country === 'Cyprus' || s.country === 'Northern Cyprus');
console.log(`\nCyprus stops (${cyprusStops.length}):`);
cyprusStops.forEach(s => console.log(`  ${s.id} ${s.name} (${s.country}) ${s.arrival}→${s.departure} ${s.duration}`));

// Verify no Northern Cyprus
const ncStops = stops.filter(s => s.country === 'Northern Cyprus');
console.log(`\nNorthern Cyprus stops: ${ncStops.length} (should be 0)`);

fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2) + '\n');
console.log('Saved to stops.json');
