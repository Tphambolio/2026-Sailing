import { useState, useMemo } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useJournalEntryKeys } from '../hooks/useJournalEntries';
import JournalEntryCard from './JournalEntryCard';

interface JournalViewProps {
  stops: Stop[];
  currentStop?: Stop | null;
  onToggleVisited?: (stop: Stop) => void;
  onLogArrival?: (stop: Stop) => void;
  onLogDeparture?: (stop: Stop) => void;
}

export default function JournalView({ stops, currentStop, onToggleVisited, onLogArrival, onLogDeparture }: JournalViewProps) {
  const { user, signInWithProvider } = useAuth();
  const { keys, loading, refetch } = useJournalEntryKeys();
  const [pickerValue, setPickerValue] = useState('');
  const [extraKeys, setExtraKeys] = useState<Set<string>>(new Set());

  // Today's stop always gets a card, even before it has any content — that's the
  // whole point of hopping into the Journal while traveling.
  const visibleKeys = useMemo(() => {
    const s = new Set([...keys, ...extraKeys]);
    if (currentStop) s.add(currentStop.key);
    return s;
  }, [keys, extraKeys, currentStop]);

  const entryStops = useMemo(() => {
    const rest = stops.filter(s => visibleKeys.has(s.key) && s.key !== currentStop?.key);
    return currentStop && visibleKeys.has(currentStop.key) ? [currentStop, ...rest] : rest;
  }, [stops, visibleKeys, currentStop]);

  const stopsWithoutEntry = useMemo(
    () => stops.filter(s => !visibleKeys.has(s.key)),
    [stops, visibleKeys]
  );

  const handleAddEntry = () => {
    if (!pickerValue) return;
    setExtraKeys(prev => new Set(prev).add(pickerValue));
    setPickerValue('');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-1">📖 Trip Journal</h1>
          <p className="text-sm text-slate-400">Notes and photos from along the way</p>
        </div>

        {user && (
          <div className="mb-8 flex gap-2">
            <select
              value={pickerValue}
              onChange={(e) => setPickerValue(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">+ Add an entry for a stop…</option>
              {stopsWithoutEntry.map(s => (
                <option key={s.key} value={s.key}>{s.name} — {s.country}</option>
              ))}
            </select>
            <button
              onClick={handleAddEntry}
              disabled={!pickerValue}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm text-white font-medium"
            >
              Add
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-center text-slate-500">Loading journal…</p>
        ) : entryStops.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <p className="mb-2">No journal entries yet.</p>
            {!user && (
              <button onClick={() => signInWithProvider('google')} className="text-cyan-400 hover:text-cyan-300 text-sm">
                Sign in to start writing →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {entryStops.map(stop => (
              <JournalEntryCard
                key={stop.key}
                stop={stop}
                isCurrent={currentStop?.key === stop.key}
                onToggleVisited={onToggleVisited}
                onLogArrival={onLogArrival}
                onLogDeparture={onLogDeparture}
                onEmptyAndCancelled={() => {
                  setExtraKeys(prev => {
                    const next = new Set(prev);
                    next.delete(stop.key);
                    return next;
                  });
                  refetch();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
