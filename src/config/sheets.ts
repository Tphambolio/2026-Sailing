// Google Sheets configuration

// Spreadsheet IDs
export const SPREADSHEET_IDS = {
  // Primary: Mediterranean Master Planning (coordinates + stops)
  masterPlanning: '15w7iwO6orja_VVgn3VwX95Aa3n-Bvbgnfg3QbvydPlk',

  // Secondary: med_sailing_itinerary_v2 (structure + culture)
  itineraryV2: '1H001ax3flbRtyxXTpEuGsE3mtRAxZx3LxkRrIp1Xxjo',
};

// Sheet names and ranges
export const SHEET_RANGES = {
  // Master Planning spreadsheet
  stops: 'Stops!A1:L100',

  // Itinerary V2 spreadsheet
  timeBudget: 'Time_Budget!A1:C10',
  phaseStructure: 'Phase_Structure!A1:E15',
  dailyItinerary: 'Daily_Itinerary!A1:I200',
  portsCulture: 'Ports_&_Culture!A1:H50',
  finalSummary: 'Final_Summary!A1:D15',
};

// Column mappings for Master Planning Stops sheet
export const STOPS_COLUMNS = {
  name: 0,           // A
  country: 1,        // B
  type: 2,           // C
  arrival: 3,        // D
  departure: 4,      // E
  duration: 5,       // F
  lat: 6,            // G
  lon: 7,            // H
  distanceToNext: 8, // I
  link: 9,           // J
  notes: 10,         // K
  season: 11,        // L
};

// Column mappings for Ports & Culture sheet
export const CULTURE_COLUMNS = {
  stop: 0,              // A
  country: 1,           // B
  schengenYN: 2,        // C
  recommendedMarina: 3, // D
  marinaUrl: 4,         // E
  cultureStop: 5,       // F
  cultureUrl: 6,        // G
  foodGuide: 7,         // H
};

// Column mappings for Phase Structure sheet
export const PHASE_COLUMNS = {
  phase: 0,       // A
  startDate: 1,   // B
  endDate: 2,     // C
  days: 3,        // D
  notes: 4,       // E
};

// Google Sheets API base URL (for public sheets)
export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Cache settings
export const CACHE_KEY = 'med_odyssey_data';
export const CACHE_DURATION = 1000 * 60 * 60; // 1 hour
