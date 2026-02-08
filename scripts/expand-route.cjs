const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// STEP 1: Extend durations for existing Montenegro/Albania stops
// ============================================================
const durationExtensions = {
  'Herceg Novi': '3 days',    // was 2
  'Kotor': '4 days',          // was 2
  'Budva': '3 days',          // was 2
  'Bar': '3 days',            // was 2
  'Durrës': '3 days',         // was 2
  'Vlorë': '3 days',          // was 2
  'Sarandë': '3 days',        // was 2
};

stops.forEach(s => {
  if (durationExtensions[s.name]) {
    console.log(`  Extended: ${s.name} "${s.duration}" → "${durationExtensions[s.name]}"`);
    s.duration = durationExtensions[s.name];
  }
});

// ============================================================
// STEP 2: Insert new stops
// ============================================================

// Template for a new stop (healRoute will fix dates, distances, IDs)
function newStop(name, country, lat, lon, type, duration, marinaName, marinaUrl, cultureHighlight, notes) {
  return {
    id: 0, // healRoute will renumber
    name,
    country,
    lat,
    lon,
    type,
    arrival: '',
    departure: '',
    duration,
    distanceToNext: 0,
    phase: country,
    season: 'summer',
    marinaName,
    marinaUrl,
    cultureHighlight,
    notes,
  };
}

// New Montenegro stops (insert in order)
const newMontenegroStops = [
  {
    after: 'Herceg Novi',
    stop: newStop('Rose', 'Montenegro', 42.4897, 18.581, 'anchorage', '2 days',
      'Rose Village Anchorage',
      'https://en.wikipedia.org/wiki/Rose,_Montenegro',
      'Stone fishing village at Bay of Kotor entrance',
      'Quiet anchorage, pristine swimming, Venetian-era architecture')
  },
  {
    after: 'Rose',
    stop: newStop('Perast', 'Montenegro', 42.4867, 18.698, 'anchorage', '3 days',
      'Perast Harbour',
      'https://en.wikipedia.org/wiki/Perast',
      'Our Lady of the Rocks & St. George islands',
      'UNESCO Bay of Kotor gem, baroque palaces, two island churches')
  },
  {
    after: 'Tivat',
    stop: newStop('Lustica Bay', 'Montenegro', 42.383, 18.593, 'anchorage', '2 days',
      'Lustica Bay Anchorage',
      'https://en.wikipedia.org/wiki/Lu%C5%A1tica',
      'Lustica Peninsula & Blue Grotto',
      'Sheltered bay, clear water, peninsula hiking trails')
  },
  {
    after: 'Lustica Bay',
    stop: newStop('Bigova', 'Montenegro', 42.3811, 18.658, 'anchorage', '2 days',
      'Bigova Bay',
      'https://en.wikipedia.org/wiki/Bigova',
      'Authentic fishing village harbour',
      'Sheltered bay popular for anchoring, excellent seafood')
  },
  {
    after: 'Budva',
    stop: newStop('Sveti Stefan', 'Montenegro', 42.257, 18.895, 'anchorage', '2 days',
      'Przno Bay Anchorage',
      'https://en.wikipedia.org/wiki/Sveti_Stefan',
      'Iconic fortified island village',
      'Anchor in Przno/Milocer Bay, spectacular coastal scenery')
  },
  {
    after: 'Sveti Stefan',
    stop: newStop('Petrovac', 'Montenegro', 42.2062, 18.941, 'anchorage', '2 days',
      'Petrovac Bay',
      'https://en.wikipedia.org/wiki/Petrovac,_Montenegro',
      'Venetian Castello fortress & beach',
      'Scenic beach town, Roman mosaics nearby')
  },
];

// New Albania stops
const newAlbaniaStops = [
  {
    after: 'Durrës',
    stop: newStop('Karpen Beach', 'Albania', 41.1335, 19.4842, 'anchorage', '2 days',
      'Karpen Beach Anchorage',
      'https://en.wikipedia.org/wiki/Kavaj%C3%AB',
      'Quiet rural Albanian coast',
      'Unspoiled beach anchorage south of Durrës')
  },
  {
    after: 'Vlorë',
    stop: newStop('Orikum', 'Albania', 40.3363, 19.4717, 'anchorage', '2 days',
      'Orikum Marina',
      'https://marinaorikum.com/',
      'Albanian Riviera gateway & ancient Orikum ruins',
      'First dedicated Albanian yacht marina, sheltered bay in Vlorë Bay')
  },
  {
    after: 'Orikum',
    stop: newStop('Drymades Beach', 'Albania', 40.148, 19.59, 'anchorage', '2 days',
      'Drymades Bay Anchorage',
      'https://en.wikipedia.org/wiki/Dhermi',
      'White-pebble Albanian Riviera beach',
      'Dramatic cliff backdrop, crystal-clear water, excellent swimming')
  },
  {
    after: 'Drymades Beach',
    stop: newStop('Himara', 'Albania', 40.101, 19.745, 'anchorage', '2 days',
      'Himara Bay',
      'https://en.wikipedia.org/wiki/Himara',
      'Riviera town with castle ruins',
      'Greek minority heritage, Livadhi beach, growing tourism hub')
  },
  {
    after: 'Sarandë',
    stop: newStop('Ksamil', 'Albania', 39.7783, 20.0004, 'anchorage', '1 day',
      'Ksamil Islands Anchorage',
      'https://en.wikipedia.org/wiki/Ksamil',
      'Crystal islands adjacent to Butrint',
      'Final Albanian anchorage, stunning islets before crossing to Corfu')
  },
];

// Insert all new stops in order
const allInsertions = [...newMontenegroStops, ...newAlbaniaStops];

for (const insertion of allInsertions) {
  const afterIdx = stops.findIndex(s => s.name === insertion.after);
  if (afterIdx === -1) {
    console.error(`ERROR: Could not find stop "${insertion.after}" to insert after`);
    continue;
  }
  stops.splice(afterIdx + 1, 0, insertion.stop);
  console.log(`  Inserted: ${insertion.stop.name} after ${insertion.after}`);
}

// ============================================================
// STEP 3: Compress Cyprus winter layover
// ============================================================
const limassol = stops.find(s => s.name === 'Limassol' && s.duration === '62 days');
if (limassol) {
  console.log(`  Compressed: Limassol "62 days" → "32 days"`);
  limassol.duration = '32 days';
}

// ============================================================
// STEP 4: Renumber IDs and fix dates using healRoute logic
// ============================================================

function daysBetweenDates(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

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

// First stop keeps its arrival date
const firstArrival = stops[0].arrival || '2026-07-15';
let currentDate = firstArrival;

for (let i = 0; i < stops.length; i++) {
  const s = stops[i];
  s.id = i + 1;
  s.arrival = currentDate;

  // Parse duration
  const daysMatch = s.duration.match(/(\d+)/);
  const stayDays = daysMatch ? parseInt(daysMatch[1]) : 2;

  s.departure = addDays(currentDate, stayDays);
  s.season = seasonFromDate(currentDate);
  s.phase = s.country;

  // Calculate distance to next
  if (i < stops.length - 1) {
    const next = stops[i + 1];
    s.distanceToNext = Math.round(haversine(s.lat, s.lon, next.lat, next.lon));
  } else {
    s.distanceToNext = 0;
  }

  currentDate = s.departure;
}

// ============================================================
// Summary
// ============================================================
const totalStops = stops.length;
const tripStart = stops[0].arrival;
const tripEnd = stops[stops.length - 1].departure;
const totalDays = daysBetweenDates(tripStart, tripEnd);

const meStops = stops.filter(s => s.country === 'Montenegro');
const alStops = stops.filter(s => s.country === 'Albania');
const meDays = meStops.reduce((sum, s) => sum + parseInt(s.duration), 0);
const alDays = alStops.reduce((sum, s) => sum + parseInt(s.duration), 0);

console.log('\n=== SUMMARY ===');
console.log(`Total stops: ${totalStops}`);
console.log(`Trip: ${tripStart} to ${tripEnd} (${totalDays} days)`);
console.log(`Montenegro: ${meStops.length} stops, ${meDays} days`);
console.log(`Albania: ${alStops.length} stops, ${alDays} days`);
console.log(`Combined ME+AL: ${meStops.length + alStops.length} stops, ${meDays + alDays} days`);

// Show key transition dates
const kassiopi = stops.find(s => s.name === 'Kassiopi');
const turkeyFirst = stops.find(s => s.country === 'Turkey');
const cyprusFirst = stops.find(s => s.country === 'Cyprus' || s.country === 'Northern Cyprus');
const greeceReturn = stops.find(s => s.country === 'Greece' && new Date(s.arrival) > new Date('2027-01-01'));
const italyFirst = stops.find(s => s.country === 'Italy' && new Date(s.arrival) > new Date('2027-01-01'));

console.log(`\nKey dates:`);
console.log(`  Greece entry (Kassiopi): ${kassiopi?.arrival}`);
console.log(`  Turkey entry: ${turkeyFirst?.arrival}`);
console.log(`  Cyprus entry: ${cyprusFirst?.arrival}`);
console.log(`  Greece return: ${greeceReturn?.arrival}`);
console.log(`  Italy entry: ${italyFirst?.arrival}`);
console.log(`  Trip end: ${tripEnd}`);

// Save
fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2) + '\n');
console.log('\nSaved to stops.json');
