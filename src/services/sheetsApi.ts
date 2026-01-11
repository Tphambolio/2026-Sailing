// Google Sheets API service for fetching live data

import {
  SPREADSHEET_IDS,
  SHEET_RANGES,
  SHEETS_API_BASE,
  STOPS_COLUMNS,
  CULTURE_COLUMNS,
  PHASE_COLUMNS,
} from '../config/sheets';
import type { Stop, Phase, TripStats, SheetsResponse } from '../types';
import { PHASE_COLORS } from '../types';

// API Key - set this in environment or replace with your key
const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY || '';

/**
 * Fetch data from a Google Sheet
 */
async function fetchSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  if (!API_KEY) {
    throw new Error('Google Sheets API key not configured. Set VITE_GOOGLE_SHEETS_API_KEY environment variable.');
  }

  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Sheets API error: ${error.error?.message || response.statusText}`);
  }

  const data: SheetsResponse = await response.json();
  return data.values || [];
}

/**
 * Parse stops from Master Planning spreadsheet
 */
function parseStops(rows: string[][]): Partial<Stop>[] {
  // Skip header row
  const dataRows = rows.slice(1);

  return dataRows.map((row, index) => {
    const typeRaw = row[STOPS_COLUMNS.type]?.toLowerCase();
    const seasonRaw = row[STOPS_COLUMNS.season]?.toLowerCase();

    const stop: Partial<Stop> = {
      id: index + 1,
      name: row[STOPS_COLUMNS.name] || `Stop ${index + 1}`,
      country: row[STOPS_COLUMNS.country] || 'Unknown',
      type: typeRaw === 'marina' ? 'marina' : 'anchorage',
      arrival: row[STOPS_COLUMNS.arrival] || '',
      departure: row[STOPS_COLUMNS.departure] || '',
      duration: row[STOPS_COLUMNS.duration] || '',
      lat: parseFloat(row[STOPS_COLUMNS.lat]) || 0,
      lon: parseFloat(row[STOPS_COLUMNS.lon]) || 0,
      distanceToNext: parseFloat(row[STOPS_COLUMNS.distanceToNext]) || 0,
      notes: row[STOPS_COLUMNS.notes] || '',
      season: ['summer', 'fall', 'winter'].includes(seasonRaw)
        ? seasonRaw as 'summer' | 'fall' | 'winter'
        : 'summer',
      marinaUrl: row[STOPS_COLUMNS.link] || '',
    };
    return stop;
  }).filter(stop => stop.lat !== 0 && stop.lon !== 0);
}

/**
 * Parse culture data from Ports & Culture sheet
 */
function parseCultureData(rows: string[][]): Map<string, Partial<Stop>> {
  const cultureMap = new Map<string, Partial<Stop>>();

  // Skip header row
  const dataRows = rows.slice(1);

  dataRows.forEach(row => {
    const stopName = row[CULTURE_COLUMNS.stop];
    if (!stopName) return;

    cultureMap.set(stopName.toLowerCase(), {
      schengen: row[CULTURE_COLUMNS.schengenYN]?.toUpperCase() === 'Y',
      marinaName: row[CULTURE_COLUMNS.recommendedMarina] || '',
      marinaUrl: row[CULTURE_COLUMNS.marinaUrl] || '',
      cultureHighlight: row[CULTURE_COLUMNS.cultureStop] || '',
      cultureUrl: row[CULTURE_COLUMNS.cultureUrl] || '',
      foodGuide: row[CULTURE_COLUMNS.foodGuide] || '',
    });
  });

  return cultureMap;
}

/**
 * Parse phases from Phase Structure sheet
 * Note: This returns a simplified Phase structure since we now use country-based phases
 */
function parsePhases(rows: string[][]): Phase[] {
  // Skip header row
  const dataRows = rows.slice(1);

  return dataRows
    .filter(row => row[PHASE_COLUMNS.phase])
    .map((row, index) => {
      const phaseName = row[PHASE_COLUMNS.phase] || '';
      return {
        id: `phase-${index}`,
        name: phaseName,
        stops: 0,  // Will be calculated from stops
        days: parseInt(row[PHASE_COLUMNS.days]) || 0,
        schengen: true,  // Default, will be set based on country
        color: PHASE_COLORS[phaseName] || '#6b7280',
      };
    });
}

/**
 * Merge culture data into stops
 */
function mergeStopsWithCulture(
  stops: Partial<Stop>[],
  cultureData: Map<string, Partial<Stop>>
): Stop[] {
  return stops.map(stop => {
    const culture = cultureData.get(stop.name?.toLowerCase() || '');

    return {
      ...stop,
      id: stop.id || 0,
      name: stop.name || '',
      country: stop.country || '',
      lat: stop.lat || 0,
      lon: stop.lon || 0,
      type: stop.type || 'anchorage',
      arrival: stop.arrival || '',
      departure: stop.departure || '',
      duration: stop.duration || '',
      distanceToNext: stop.distanceToNext || 0,
      season: stop.season || 'summer',
      phase: stop.phase || '',
      schengen: culture?.schengen ?? true,
      marinaName: culture?.marinaName || stop.marinaName,
      marinaUrl: culture?.marinaUrl || stop.marinaUrl,
      cultureHighlight: culture?.cultureHighlight,
      cultureUrl: culture?.cultureUrl,
      foodGuide: culture?.foodGuide,
      notes: stop.notes,
    } as Stop;
  });
}

/**
 * Assign phases to stops based on country
 * Note: Phases are now country-based, stops already have phase assigned from data
 */
function assignPhasesToStops(stops: Stop[], _phases: Phase[]): Stop[] {
  // Phases are now country-based and already assigned in the data
  // This function is kept for API compatibility
  return stops;
}

/**
 * Main function to fetch all data from Google Sheets
 */
export async function fetchAllData(): Promise<{
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
}> {
  try {
    // Fetch data from both spreadsheets in parallel
    const [stopsData, cultureData, phasesData] = await Promise.all([
      fetchSheet(SPREADSHEET_IDS.masterPlanning, SHEET_RANGES.stops),
      fetchSheet(SPREADSHEET_IDS.itineraryV2, SHEET_RANGES.portsCulture),
      fetchSheet(SPREADSHEET_IDS.itineraryV2, SHEET_RANGES.phaseStructure),
    ]);

    // Parse the data
    const rawStops = parseStops(stopsData);
    const cultureMap = parseCultureData(cultureData);
    const phases = parsePhases(phasesData);

    // Merge and enrich stops
    let stops = mergeStopsWithCulture(rawStops, cultureMap);
    stops = assignPhasesToStops(stops, phases);

    // Calculate stats
    const stats: TripStats = {
      totalDays: phases.reduce((sum, p) => sum + p.days, 0),
      sailingDays: stops.filter(s => s.distanceToNext > 0).length,
      restDays: stops.filter(s => s.distanceToNext === 0).length,
      extendedStayDays: 0,
      totalSchengenDays: stops.filter(s => s.schengen).length * 3, // Approximate
      schengen2026: 72,  // From spreadsheet
      schengen2027: 48,
    };

    return { stops, phases, stats };
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
    throw error;
  }
}

/**
 * Check if API key is configured
 */
export function isApiKeyConfigured(): boolean {
  return Boolean(API_KEY);
}
