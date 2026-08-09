// Data service — itinerary persistence, synced through Supabase (shared across
// devices, same as journal notes/photos already were) with localStorage kept
// as a fast local cache and offline/pre-sign-in fallback.

import type { Stop, Phase, TripStats } from '../types';
import { healRoute, computePhases, computeStats } from './routeEngine';
import { todayISO } from '../utils/geo';
import { supabase } from '../lib/supabase';
import fallbackStops from '../data/stops.json';

const STORAGE_KEY = 'med_odyssey_user_stops';
// Singleton row — this app has exactly one itinerary, not one per visitor.
const TRIP_STOPS_TABLE = 'sailing_trip_stops';
const TRIP_STOPS_ROW_ID = 1;

/**
 * On first load (no saved user edits yet), default `visited` from the planned schedule
 * so past stops aren't all unchecked. Fully overridable per-stop afterward.
 */
function seedVisitedFromSchedule(stops: Stop[]): Stop[] {
  const today = todayISO();
  return stops.map(s => ({ ...s, visited: s.visited ?? (!!s.departure && s.departure <= today) }));
}

/**
 * Load stops: Supabase (shared, cross-device) first, falling back to a locally
 * cached copy (e.g. offline, or before this device's first save under this
 * scheme lands), then finally the built-in default itinerary.
 */
export async function getData(): Promise<{
  stops: Stop[];
  phases: Phase[];
  stats: TripStats;
  isUserEdited: boolean;
}> {
  let rawStops: Stop[] | null = null;

  try {
    const { data, error } = await supabase
      .from(TRIP_STOPS_TABLE)
      .select('stops')
      .eq('id', TRIP_STOPS_ROW_ID)
      .maybeSingle();
    if (error) throw error;
    if (data?.stops) rawStops = data.stops as Stop[];
  } catch (err) {
    console.warn('Failed to load trip stops from Supabase, falling back to local cache:', err);
  }

  if (!rawStops) rawStops = getUserStops();

  const isUserEdited = !!rawStops;
  const stops = healRoute(rawStops ? rawStops : seedVisitedFromSchedule(fallbackStops as Stop[]));
  const phases = computePhases(stops);
  const stats = computeStats(stops);

  return { stops, phases, stats, isUserEdited };
}

/**
 * Get the base (committed) stops without user edits
 */
export function getBaseStops(): Stop[] {
  return fallbackStops as Stop[];
}

/**
 * Save user-edited stops. Always caches locally first (instant, works offline);
 * also pushes to Supabase when signed in so the edit is visible on other
 * devices too. A failed Supabase write is logged but never blocks the local
 * save — the edit still "sticks" for this browser, and the next successful
 * save (or a future reload once back online) will catch Supabase up.
 */
export async function saveUserStops(stops: Stop[]): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
  } catch (error) {
    console.warn('Failed to cache stops locally:', error);
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Not signed in — RLS would reject the write anyway; local cache above still holds.
    const { error } = await supabase
      .from(TRIP_STOPS_TABLE)
      .upsert({ id: TRIP_STOPS_ROW_ID, stops, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (error) {
    console.warn('Failed to sync trip stops to Supabase (kept in local cache):', error);
  }
}

/**
 * Load locally cached stops (used as a fallback when Supabase is unreachable
 * or hasn't been written to yet).
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
 * Clear user edits (reset to base data) — both the local cache and the shared
 * Supabase row, so Reset is a real reset rather than reappearing on next load.
 */
export async function clearUserStops(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  try {
    const { error } = await supabase.from(TRIP_STOPS_TABLE).delete().eq('id', TRIP_STOPS_ROW_ID);
    if (error) throw error;
  } catch (error) {
    console.warn('Failed to clear trip stops from Supabase:', error);
  }
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
