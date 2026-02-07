// Data service with localStorage persistence for user edits

import type { Stop, Phase, TripStats } from '../types';
import { healRoute, computePhases, computeStats } from './routeEngine';
import fallbackStops from '../data/stops.json';

const STORAGE_KEY = 'med_odyssey_user_stops';

/**
 * Load stops: user edits from localStorage, or fallback JSON
 */
export function getData(): {
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
  isUserEdited: boolean;
} {
  // Check for user-edited stops in localStorage
  const saved = getUserStops();
  const rawStops = saved || (fallbackStops as Stop[]);
  const stops = healRoute(rawStops);
  const phases = computePhases(stops);
  const stats = computeStats(stops);

  return { stops, phases, stats, isUserEdited: !!saved };
}

/**
 * Get the base (committed) stops without user edits
 */
export function getBaseStops(): Stop[] {
  return fallbackStops as Stop[];
}

/**
 * Save user-edited stops to localStorage
 */
export function saveUserStops(stops: Stop[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
  } catch (error) {
    console.warn('Failed to save stops:', error);
  }
}

/**
 * Load user-edited stops from localStorage
 */
function getUserStops(): Stop[] | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

/**
 * Clear user edits (reset to base data)
 */
export function clearUserStops(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Export stops as a downloadable JSON file
 */
export function exportStopsJson(stops: Stop[]): void {
  const json = JSON.stringify(stops, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stops.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
