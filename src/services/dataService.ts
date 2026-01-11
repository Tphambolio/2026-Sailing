// Data service with caching and fallback

import { fetchAllData, isApiKeyConfigured } from './sheetsApi';
import { CACHE_KEY, CACHE_DURATION } from '../config/sheets';
import type { Stop, Phase, TripStats } from '../types';

// Static fallback data (will be populated with real data export)
import fallbackStops from '../data/stops.json';
import fallbackPhases from '../data/phases.json';
import fallbackStats from '../data/stats.json';

interface CachedData {
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
  timestamp: number;
}

/**
 * Get data from localStorage cache
 */
function getCachedData(): CachedData | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data: CachedData = JSON.parse(cached);

    // Check if cache is still valid
    if (Date.now() - data.timestamp > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Save data to localStorage cache
 */
function setCachedData(data: { stops: Stop[]; phases: Phase[]; stats: TripStats }): void {
  try {
    const cached: CachedData = {
      ...data,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch (error) {
    console.warn('Failed to cache data:', error);
  }
}

/**
 * Load static fallback data
 */
function loadFallbackData(): { stops: Stop[]; phases: Phase[]; stats: TripStats } {
  return {
    stops: fallbackStops as Stop[],
    phases: fallbackPhases as Phase[],
    stats: fallbackStats as TripStats,
  };
}

/**
 * Main function to get data (with caching and fallback)
 */
export async function getData(forceRefresh = false): Promise<{
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
  source: 'live' | 'cache' | 'fallback';
}> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = getCachedData();
    if (cached) {
      return {
        stops: cached.stops,
        phases: cached.phases,
        stats: cached.stats,
        source: 'cache',
      };
    }
  }

  // Try to fetch from Google Sheets
  if (isApiKeyConfigured()) {
    try {
      const data = await fetchAllData();
      setCachedData(data);
      return { ...data, source: 'live' };
    } catch (error) {
      console.error('Failed to fetch from Google Sheets, using fallback:', error);
    }
  }

  // Use fallback data
  const fallback = loadFallbackData();
  return { ...fallback, source: 'fallback' };
}

/**
 * Clear the data cache
 */
export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Get cache status
 */
export function getCacheStatus(): { exists: boolean; age: number | null } {
  const cached = getCachedData();
  if (!cached) {
    return { exists: false, age: null };
  }
  return {
    exists: true,
    age: Date.now() - cached.timestamp,
  };
}
