import { useState, useEffect, useMemo } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useJournalEntryKeys } from '../hooks/useJournalEntries';
import { effectiveArrival } from '../services/routeEngine';
import { preloadGoogleIdentityServices, isGooglePhotosConfigured } from '../services/googlePhotosPicker';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import JournalEntryCard from './JournalEntryCard';

interface JournalViewProps {
  stops: Stop[];
  currentStop?: Stop | null;
  focusStop?: Stop | null;
  onToggleVisited?: (stop: Stop) => void;
  onLogArrival?: (stop: Stop) => void;
  onLogDeparture?: (stop: Stop) => void;
}

function JournalPlaceholder({ stop, onClick }: { stop: Stop; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 hover:border-cyan-600 rounded-lg text-left transition-colors"
    >
      <span className="text-lg shrink-0">{COUNTRY_FLAGS[stop.country] || ''}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-300 truncate">{stop.name}</p>
        <p className="text-xs text-slate-500">{formatDate(stop.arrival)} · {stop.country}</p>
      </div>
      {stop.visited && <span className="text-xs text-green-500 shrink-0" title="Visited">✓</span>}
      <span className="text-xs text-cyan-400 shrink-0">+ Write a post</span>
    </button>
  );
}

export default function JournalView({ stops, currentStop, focusStop, onToggleVisited, onLogArrival, onLogDeparture }: JournalViewProps) {
  const { user, signInWithProvider } = useAuth();
  const { keys, loading, refetch } = useJournalEntryKeys();
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  // Load the Google Identity Services script as soon as the Journal tab opens,
  // well before any "Google Photos" button click — Chrome's popup blocker
  // requires the OAuth popup to open within a user gesture's task, and
  // awaiting the script's first-ever network fetch inside the click handler
  // burns that window silently (no error, it just never opens).
  useEffect(() => {
    if (isGooglePhotosConfigured) preloadGoogleIdentityServices();
  }, []);

  // Every stop already has a slot — no separate "create an entry" step. Signed-out
  // visitors only see stops with real content; signed-in (the trip owner) sees every
  // stop as a ready-to-write placeholder.
  //
  // Ordering mirrors a blog feed: the current stop always pinned at the very top
  // (it's the active "write today" slot even before it has content), then actual
  // posts newest-first below that (the trip's first stop naturally sinks to the
  // bottom), then not-yet-written future placeholders trailing at the very end in
  // normal trip order — so an empty slot for a stop months away doesn't outrank
  // yesterday's real post.
  const entryStops = useMemo(() => {
    const rest = stops.filter(s => s.key !== currentStop?.key);
    const withContent = rest.filter(s => keys.has(s.key));
    const withoutContent = rest.filter(s => !keys.has(s.key));
    withContent.sort((a, b) => effectiveArrival(b).localeCompare(effectiveArrival(a)));

    const ordered = currentStop ? [currentStop, ...withContent, ...withoutContent] : [...withContent, ...withoutContent];
    if (user) return ordered;
    return ordered.filter(s => keys.has(s.key) || s.key === currentStop?.key);
  }, [stops, currentStop, user, keys]);

  // Clicking a stop anywhere else in the app (sidebar list, search, map pin) jumps
  // straight to its journal slot and opens it for writing — same synced stop list,
  // no separate picker needed.
  useEffect(() => {
    if (!focusStop) return;
    setOpenKeys(prev => (prev.has(focusStop.key) ? prev : new Set(prev).add(focusStop.key)));
    const id = `journal-${focusStop.key}`;
    const scrollToIt = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Cards above the target can still be loading photos, which shifts layout after
    // the first scroll fires — re-correct once things have had time to settle.
    const timers = [100, 500, 1200].map(ms => setTimeout(scrollToIt, ms));
    return () => timers.forEach(clearTimeout);
  }, [focusStop]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-1">📖 Trip Journal</h1>
          <p className="text-sm text-slate-400">Notes and photos from along the way</p>
          {!user && (
            <button onClick={() => signInWithProvider('google')} className="mt-2 text-cyan-400 hover:text-cyan-300 text-sm">
              Sign in to write →
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-slate-500">Loading journal…</p>
        ) : entryStops.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <p>No journal entries yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entryStops.map(stop => {
              const isCurrent = currentStop?.key === stop.key;
              const isOpen = isCurrent || keys.has(stop.key) || openKeys.has(stop.key);
              return (
                <div key={stop.key} id={`journal-${stop.key}`}>
                  {isOpen ? (
                    <JournalEntryCard
                      stop={stop}
                      isCurrent={isCurrent}
                      onToggleVisited={onToggleVisited}
                      onLogArrival={onLogArrival}
                      onLogDeparture={onLogDeparture}
                      onEmptyAndCancelled={() => {
                        setOpenKeys(prev => {
                          const next = new Set(prev);
                          next.delete(stop.key);
                          return next;
                        });
                        refetch();
                      }}
                    />
                  ) : (
                    <JournalPlaceholder stop={stop} onClick={() => setOpenKeys(prev => new Set(prev).add(stop.key))} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
