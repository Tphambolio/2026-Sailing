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
  phase: string;             // country name (e.g., "Croatia")

  // Marina details
  marinaUrl?: string;
  marinaName?: string;

  // Culture & enrichment
  cultureHighlight?: string;
  cultureUrl?: string;
  foodGuide?: string;
  wikiUrl?: string;
  foodUrl?: string;
  adventureUrl?: string;
  provisionsUrl?: string;

  // Notes/description
  notes?: string;

  // Navigation to next stop
  hoursToNext?: number;
  nmToNext?: number;

  // Route waypoints to avoid land crossings
  routeWaypoints?: [number, number][];
}

export interface Phase {
  id: string;
  name: string;              // Country name
  stops: number;
  days: number;
  schengen: boolean;
  color: string;
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

// Default map settings
export const DEFAULT_MAP_CENTER: [number, number] = [38.5, 20.0];
export const DEFAULT_MAP_ZOOM = 6;
