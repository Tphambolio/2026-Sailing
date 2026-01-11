// Core data types for Mediterranean Odyssey

export interface Stop {
  id: number;
  name: string;
  country: string;
  lat: number;
  lon: number;
  type: 'marina' | 'anchorage';
  arrival: string;           // ISO date string (YYYY-MM-DD)
  departure: string;
  duration: string;          // e.g., "3 days"
  distanceToNext: number;    // km
  season: 'summer' | 'fall' | 'winter';
  phase: string;             // e.g., "Venice → Montenegro"
  schengen: boolean;

  // From Ports_&_Culture sheet (merged)
  marinaUrl?: string;
  marinaName?: string;
  cultureHighlight?: string;
  cultureUrl?: string;
  foodGuide?: string;

  // New enrichment fields
  wikiUrl?: string;           // Wikipedia link for the location
  foodUrl?: string;           // Restaurant/food guide URL
  adventureUrl?: string;      // Nature/adventure activities URL
  provisionsUrl?: string;     // Provisioning/supplies URL

  // Notes/description
  notes?: string;

  // Navigation to next stop
  hoursToNext?: number;
  nmToNext?: number;         // nautical miles
}

export interface Phase {
  id: string;
  name: string;              // Country name
  stops: number;             // Number of stops in this country
  days: number;              // Total days in this country
  schengen: boolean;         // Is this a Schengen country?
  color: string;             // hex color for map display
}

export interface TripStats {
  totalDays: number;
  sailingDays: number;
  restDays: number;
  extendedStayDays: number;
  totalSchengenDays: number;
  schengen2026: number;
  schengen2027: number;
}

// Filter state for the sidebar
export interface FilterState {
  countries: string[];
  types: ('marina' | 'anchorage')[];
  phases: string[];
  seasons: ('summer' | 'fall' | 'winter')[];
  searchQuery: string;
}

// Map state
export interface MapState {
  center: [number, number];
  zoom: number;
  selectedStop: Stop | null;
}

// App state
export interface AppState {
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
  filters: FilterState;
  map: MapState;
  loading: boolean;
  error: string | null;
}

// Google Sheets API response types
export interface SheetRow {
  [key: string]: string | number | undefined;
}

export interface SheetsResponse {
  range: string;
  majorDimension: string;
  values: string[][];
}

// Phase colors mapping
export const PHASE_COLORS: Record<string, string> = {
  'Venice → Montenegro': '#06b6d4',      // cyan
  'Montenegro/Albania': '#8b5cf6',        // violet
  'Greece (Ionian)': '#f59e0b',           // amber
  'Corinth & Saronic': '#14b8a6',         // teal
  'Athens → Turkey': '#3b82f6',           // blue
  'Turkey south coast': '#ef4444',        // red
  'Turkey → Cyprus': '#ec4899',           // pink
  'Cyprus': '#6366f1',                    // indigo
  'Cyprus → Turkey': '#10b981',           // emerald
  'Turkey → Crete': '#f97316',            // orange
  'Crete': '#a855f7',                     // purple
  'Crete → Ionian': '#84cc16',            // lime
  'Italy': '#0ea5e9',                     // sky
};

// Country flag emojis
export const COUNTRY_FLAGS: Record<string, string> = {
  'Italy': '🇮🇹',
  'Croatia': '🇭🇷',
  'Montenegro': '🇲🇪',
  'Albania': '🇦🇱',
  'Greece': '🇬🇷',
  'Turkey': '🇹🇷',
  'Cyprus': '🇨🇾',
  'Cyprus (UK base)': '🇬🇧',
  'Northern Cyprus': '🇹🇷',
};

// Default map settings
export const DEFAULT_MAP_CENTER: [number, number] = [38.5, 20.0];
export const DEFAULT_MAP_ZOOM = 6;
