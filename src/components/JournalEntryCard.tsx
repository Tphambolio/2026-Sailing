import { useState, useEffect, useRef, useMemo } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import { parseContent } from '../utils/journalContent';

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
  const { photos, loading: photosLoading, upload, remove, getUrl } = useStopPhotos(stop.key);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(content); }, [content]);
  useEffect(() => {
    // A freshly-added entry with nothing yet starts straight into edit mode
    if (!notesLoading && !content && photos.length === 0) setEditing(true);
  }, [notesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayBlocks = useMemo(() => parseContent(content), [content]);
  const inlinePhotoIds = useMemo(
    () => new Set(displayBlocks.filter((b): b is { type: 'photo'; id: string } => b.type === 'photo').map(b => b.id)),
    [displayBlocks]
  );
  const galleryPhotos = useMemo(() => photos.filter(p => !inlinePhotoIds.has(p.id)), [photos, inlinePhotoIds]);
  // Separate from inlinePhotoIds (which tracks saved `content`) so the picker reflects
  // photos just inserted into `draft` during the current edit, before Save is clicked.
  const draftInlinePhotoIds = useMemo(
    () => new Set(parseContent(draft).filter((b): b is { type: 'photo'; id: string } => b.type === 'photo').map(b => b.id)),
    [draft]
  );

  const handleSave = async () => {
    await save(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(content);
    setEditing(false);
    if (!content && photos.length === 0) onEmptyAndCancelled?.();
  };

  const insertPhotoToken = (photoId: string) => {
    const ta = textareaRef.current;
    const token = `{{photo:${photoId}}}`;
    const start = ta ? ta.selectionStart : draft.length;
    const end = ta ? ta.selectionEnd : draft.length;
    setDraft(prev => `${prev.slice(0, start)}\n\n${token}\n\n${prev.slice(end)}`);
    requestAnimationFrame(() => ta?.focus());
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadProgress({ done: 0, total: files.length });
    for (const file of files) {
      const { data } = await upload(file);
      if (data) setDraft(prev => `${prev}${prev.trim() ? '\n\n' : ''}{{photo:${data.id}}}`);
      setUploadProgress(p => (p ? { ...p, done: p.done + 1 } : null));
    }
    setUploadProgress(null);
    setEditing(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Escape closes the lightbox
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxId]);

  const lightboxIndex = lightboxId ? photos.findIndex(p => p.id === lightboxId) : -1;
  const lightboxPhoto = lightboxIndex >= 0 ? photos[lightboxIndex] : null;
  const showLightbox = (delta: number) => {
    if (lightboxIndex < 0 || photos.length === 0) return;
    const next = (lightboxIndex + delta + photos.length) % photos.length;
    setLightboxId(photos[next].id);
  };

  return (
    <article className={`bg-slate-800 border rounded-xl overflow-hidden ${isCurrent ? 'border-amber-500' : 'border-slate-700'}`}>
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
              disabled={!!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploadProgress ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…` : '📷 Add photos'}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
        </div>

        {stop.cultureHighlight && (
          <p className="text-sm text-cyan-400 mb-3">🏛️ {stop.cultureHighlight}</p>
        )}

        {notesLoading || photosLoading ? (
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        ) : editing ? (
          <div className="space-y-2 mt-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              autoFocus
              placeholder="Write something about this stop…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-y font-mono"
            />
            {photos.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Click a photo to drop it into your text at the cursor:</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map(photo => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => insertPhotoToken(photo.id)}
                      className={`relative shrink-0 w-16 h-16 rounded overflow-hidden border-2 ${draftInlinePhotoIds.has(photo.id) ? 'border-cyan-500' : 'border-transparent hover:border-slate-500'}`}
                      title="Insert into text"
                    >
                      <img src={getUrl(photo.storage_path)} alt="" className="w-full h-full object-cover" />
                      {draftInlinePhotoIds.has(photo.id) && (
                        <span className="absolute bottom-0 right-0 bg-cyan-600 text-white text-[9px] px-1">in text</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
        ) : displayBlocks.length > 0 ? (
          <div className="mt-3">
            {displayBlocks.map((block, i) =>
              block.type === 'text' ? (
                block.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).map((para, j) => (
                  <p key={`${i}-${j}`} className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed mb-3 last:mb-0">{para}</p>
                ))
              ) : (
                (() => {
                  const photo = photos.find(p => p.id === block.id);
                  if (!photo) return null;
                  return (
                    <div key={i} className="relative group my-4 -mx-5">
                      <img
                        src={getUrl(photo.storage_path)}
                        alt={photo.caption || stop.name}
                        onClick={() => setLightboxId(photo.id)}
                        className="w-full max-h-[520px] object-cover cursor-zoom-in"
                      />
                      {user && (
                        <button
                          onClick={() => remove(photo)}
                          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-black/70 rounded-full text-white text-xs transition-opacity"
                          title="Delete photo"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })()
              )
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic mt-3">No notes for this stop.</p>
        )}

        {/* Any photos not placed inline still show up here — nothing is ever hidden */}
        {!editing && galleryPhotos.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-1">
            {galleryPhotos.map(photo => (
              <div key={photo.id} className="relative group aspect-square">
                <img
                  src={getUrl(photo.storage_path)}
                  alt={photo.caption || stop.name}
                  onClick={() => setLightboxId(photo.id)}
                  className="w-full h-full object-cover rounded cursor-zoom-in"
                />
                {user && (
                  <button
                    onClick={() => remove(photo)}
                    className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-black/70 rounded-full text-white text-xs transition-opacity"
                    title="Delete photo"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[2000] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxId(null)}
        >
          <button
            onClick={() => setLightboxId(null)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white"
          >✕</button>
          {photos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); showLightbox(-1); }}
              className="absolute left-4 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white text-xl"
            >‹</button>
          )}
          <img
            src={getUrl(lightboxPhoto.storage_path)}
            alt={lightboxPhoto.caption || stop.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded"
          />
          {photos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); showLightbox(1); }}
              className="absolute right-4 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white text-xl"
            >›</button>
          )}
        </div>
      )}
    </article>
  );
}
