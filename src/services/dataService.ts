// Data service — itinerary persistence, synced through Supabase (shared across
// devices, same as journal notes/photos already were) with localStorage kept
// as a fast local cache and offline/pre-sign-in fallback.

import type { Stop, Phase, TripStats } from '../types';
import { healRoute, computePhases, computeStats } from './routeEngine';
import { todayISO } from '../utils/geo';
import { supabase } from '../lib/supabase';

// Last itinerary the server confirmed — the offline fallback for display.
const STORAGE_KEY = 'med_odyssey_user_stops';
// Changes saved on this device while the server couldn't be reached, plus the
// server version they were based on. Kept separate from STORAGE_KEY so a rejected
// or unsynced edit is never mistaken for the confirmed itinerary.
const PENDING_KEY = 'med_odyssey_pending_stops';
// Singleton row — this app has exactly one itinerary, not one per visitor.
const TRIP_STOPS_TABLE = 'sailing_trip_stops';
const TRIP_STOPS_ROW_ID = 1;

// The server version (updated_at) this device last loaded or saved. Saves only
// go through if the row still has this version — otherwise another editor saved
// in between, and writing our whole stops array would silently wipe their change.
let lastKnownUpdatedAt: string | null = null;
// Whether this page actually reached the server on load. If it fell back to the
// local cache or the bundled default (offline, Starlink drop), saving would push
// that stale copy over the real itinerary — so saves are refused until reload.
let serverRow: 'unknown' | 'absent' | 'present' = 'unknown';
// Set when a save is rejected as a conflict: every save still queued behind it
// is refused too, until the latest itinerary has been reloaded — otherwise the
// next queued save would carry this device's stale copy over the other editor's.
let conflictPending = false;
// Saves run one at a time so each uses the version the previous one produced
// (two quick taps would otherwise both send the same version and the second
// would be rejected as a false "someone else" conflict).
let saveQueue: Promise<unknown> = Promise.resolve();

export type SaveResult = { status: 'saved' | 'local-only' | 'conflict' | 'not-loaded' };

interface PendingStops { stops: Stop[]; baseVersion: string | null }
function readPending(): PendingStops | null {
  try { const raw = localStorage.getItem(PENDING_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writePending(p: PendingStops) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* quota/private mode */ }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}
function cacheConfirmed(stops: Stop[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stops)); } catch { /* quota/private mode */ }
}

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
  /** Offline changes are showing and still need syncing (see syncPendingStops). */
  hasPending: boolean;
  /** Offline changes were dropped because someone else changed the itinerary meanwhile. */
  droppedOfflineChanges: boolean;
}> {
  let rawStops: Stop[] | null = null;
  let hasPending = false;
  let droppedOfflineChanges = false;
  const pending = readPending();

  try {
    const { data, error } = await supabase
      .from(TRIP_STOPS_TABLE)
      .select('stops, updated_at')
      .eq('id', TRIP_STOPS_ROW_ID)
      .maybeSingle();
    if (error) throw error;
    serverRow = data?.stops ? 'present' : 'absent';
    conflictPending = false;
    if (data?.stops) {
      rawStops = data.stops as Stop[];
      lastKnownUpdatedAt = (data as { updated_at?: string }).updated_at ?? null;
      cacheConfirmed(rawStops);
    }
    if (pending) {
      if (pending.baseVersion === lastKnownUpdatedAt) {
        // Nobody else changed it while this device was offline — show the
        // offline changes; the caller syncs them with syncPendingStops().
        rawStops = pending.stops;
        hasPending = true;
      } else {
        clearPending();
        droppedOfflineChanges = true;
      }
    }
  } catch (err) {
    console.warn('Failed to load trip stops from Supabase, falling back to local copy:', err);
    rawStops = pending?.stops ?? getUserStops();
    hasPending = !!pending;
  }
  // Server reachable but no itinerary row yet: fall back to this device's copy.
  if (!rawStops) rawStops = getUserStops();

  const isUserEdited = !!rawStops;
  // The bundled default itinerary (~110KB) is only needed when there's no server
  // or cached copy at all, so it's loaded on demand rather than shipped to everyone.
  const base = rawStops ?? seedVisitedFromSchedule((await import('../data/stops.json')).default as Stop[]);
  const stops = healRoute(base);
  const phases = computePhases(stops);
  const stats = computeStats(stops);

  return { stops, phases, stats, isUserEdited, hasPending, droppedOfflineChanges };
}

/** Reload after a conflict — queued, so it can't interleave with a pending save. */
export function reloadData(): ReturnType<typeof getData> {
  const next = saveQueue.then(() => getData());
  saveQueue = next.catch(() => undefined);
  return next;
}

/** Push offline changes once the server is reachable (after load / on "online"). */
export function syncPendingStops(): Promise<SaveResult | null> {
  const pending = readPending();
  if (!pending) return Promise.resolve(null);
  return saveUserStops(pending.stops);
}

/**
 * Save user-edited stops: a versioned write to Supabase (see lastKnownUpdatedAt).
 * If the server can't be reached, the change is kept on this device as a
 * pending edit (PENDING_KEY) and synced later by syncPendingStops().
 */
export function saveUserStops(stops: Stop[]): Promise<SaveResult> {
  const next = saveQueue.then(() => saveNow(stops));
  saveQueue = next.catch(() => undefined);
  return next;
}

async function saveNow(stops: Stop[]): Promise<SaveResult> {
  if (conflictPending) return { status: 'conflict' };
  if (serverRow === 'unknown') return { status: 'not-loaded' };

  // getSession() reads the local session — unlike getUser() it needs no network,
  // so a Starlink drop isn't mistaken for "signed out".
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { status: 'local-only' }; // RLS would reject the write anyway

  const updatedAt = new Date().toISOString();
  try {
    if (lastKnownUpdatedAt === null) {
      // The server confirmed there's no itinerary row yet — the very first save.
      const { error } = await supabase
        .from(TRIP_STOPS_TABLE)
        .upsert({ id: TRIP_STOPS_ROW_ID, stops, updated_by: user.id, updated_at: updatedAt });
      if (error) throw error;
      lastKnownUpdatedAt = updatedAt;
      serverRow = 'present';
    } else {
      const { data, error } = await supabase
        .from(TRIP_STOPS_TABLE)
        .update({ stops, updated_by: user.id, updated_at: updatedAt })
        .eq('id', TRIP_STOPS_ROW_ID)
        .eq('updated_at', lastKnownUpdatedAt)
        .select('updated_at');
      if (error) throw error;
      if (!data || data.length === 0) {
        conflictPending = true;
        return { status: 'conflict' };
      }
      lastKnownUpdatedAt = (data[0] as { updated_at: string }).updated_at;
    }
    cacheConfirmed(stops);
    clearPending();
    return { status: 'saved' };
  } catch (error) {
    // Couldn't reach the server: keep it on this device until it can be synced.
    console.warn('Itinerary not saved to the server yet (kept on this device):', error);
    writePending({ stops, baseVersion: lastKnownUpdatedAt });
    return { status: 'local-only' };
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
