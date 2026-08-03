import { useState, useEffect, useRef } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';

interface JournalEntryCardProps {
  stop: Stop;
  isCurrent?: boolean;
  onToggleVisited?: (stop: Stop) => void;
  onLogArrival?: (stop: Stop) => void;
  onLogDeparture?: (stop: Stop) => void;
  onEmptyAndCancelled?: () => void; // called when a freshly-added blank entry is cancelled with nothing written
}

export default function JournalEntryCard({ stop, isCurrent, onToggleVisited, onLogArrival, onLogDeparture, onEmptyAndCancelled }: JournalEntryCardProps) {
  const { user } = useAuth();
  const { content, loading: notesLoading, saving, save } = useStopNotes(stop.key);
  const { photos, loading: photosLoading, uploading, upload, remove, getUrl } = useStopPhotos(stop.key);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(content); }, [content]);
  useEffect(() => {
    // A freshly-added entry with nothing yet starts straight into edit mode
    if (!notesLoading && !content && photos.length === 0) setEditing(true);
  }, [notesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    await save(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(content);
    setEditing(false);
    if (!content && photos.length === 0) onEmptyAndCancelled?.();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await upload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <article className={`bg-slate-800 border rounded-xl overflow-hidden ${isCurrent ? 'border-amber-500' : 'border-slate-700'}`}>
      {/* Photos as a hero strip */}
      {photosLoading ? null : photos.length > 0 && (
        <div className={`grid gap-0.5 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {photos.slice(0, 4).map((photo, i) => (
            <div key={photo.id} className={`relative group ${photos.length === 3 && i === 0 ? 'col-span-2' : ''}`}>
              <img
                src={getUrl(photo.storage_path)}
                alt={photo.caption || stop.name}
                className="w-full h-64 object-cover"
              />
              {user && (
                <button
                  onClick={() => remove(photo)}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-black/70 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete photo"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-xl font-bold text-white">
              {COUNTRY_FLAGS[stop.country] || ''} {stop.name}
            </h2>
            <p className="text-sm text-slate-400">
              {formatDate(stop.arrival)}{stop.departure && stop.arrival !== stop.departure && ` → ${formatDate(stop.departure)}`}
              {' · '}{stop.country}
            </p>
          </div>
          {user && !editing && (
            <button onClick={() => setEditing(true)} className="shrink-0 text-xs text-cyan-400 hover:text-cyan-300">✏️ Edit</button>
          )}
        </div>

        {/* Status row — mirrors the map's per-stop controls */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {isCurrent && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-500 text-slate-900 font-semibold">📍 Here now</span>
          )}
          {onToggleVisited && (
            <button
              onClick={() => onToggleVisited(stop)}
              className={`px-2 py-0.5 rounded text-xs font-medium border ${stop.visited ? 'bg-green-600/80 border-green-500 text-white' : 'border-slate-500 text-slate-400 hover:text-white hover:border-slate-300'}`}
            >
              {stop.visited ? '✓ Visited' : 'Mark Visited'}
            </button>
          )}
          {user && onLogArrival && (
            <button onClick={() => onLogArrival(stop)} className="text-xs text-sky-400 hover:text-sky-300" title="Log today as the actual arrival date">📌 Arrived today</button>
          )}
          {user && onLogDeparture && (
            <button onClick={() => onLogDeparture(stop)} className="text-xs text-sky-400 hover:text-sky-300" title="Log today as the actual departure date">🏁 Departed today</button>
          )}
          {user && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploading ? 'Uploading…' : '📷 Add photo'}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        {stop.cultureHighlight && (
          <p className="text-sm text-cyan-400 mb-3">🏛️ {stop.cultureHighlight}</p>
        )}

        {notesLoading ? (
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        ) : editing ? (
          <div className="space-y-2 mt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              placeholder="Write something about this stop…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded text-sm text-white font-medium"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={handleCancel} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300">
                Cancel
              </button>
            </div>
          </div>
        ) : content ? (
          <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed mt-3">{content}</p>
        ) : (
          <p className="text-sm text-slate-500 italic mt-3">No notes for this stop.</p>
        )}
      </div>
    </article>
  );
}
