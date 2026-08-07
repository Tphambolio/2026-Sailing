import { useState, useEffect, useMemo, useRef } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { formatDate } from '../utils/geo';
import { parseContent } from '../utils/journalContent';

interface NotesModalProps {
  stop: Stop;
  onClose: () => void;
}

export default function NotesModal({ stop, onClose }: NotesModalProps) {
  const { user, signInWithProvider } = useAuth();
  const { content, loading: notesLoading, saving, save } = useStopNotes(stop.key);
  const { photos, loading: photosLoading, uploading, upload, remove, getUrl } = useStopPhotos(stop.key);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(content); }, [content]);

  // `content` may contain {{photo:ID}} tokens placed by the Journal tab's inline
  // photo picker. Render them as images here too, instead of leaking the raw token.
  const displayBlocks = useMemo(() => parseContent(content), [content]);

  const handleSave = async () => {
    await save(draft);
    setEditing(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await upload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000] p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full border border-slate-700 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white">{stop.name}</h2>
            <p className="text-xs text-slate-400">{formatDate(stop.arrival)}{stop.departure && stop.arrival !== stop.departure && ` → ${formatDate(stop.departure)}`}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase">Notes</h3>
              {user && !editing && (
                <button onClick={() => setEditing(true)} className="text-xs text-cyan-400 hover:text-cyan-300">✏️ Edit</button>
              )}
            </div>

            {notesLoading || photosLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : editing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="Write something about this stop…"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded text-sm text-white font-medium"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setDraft(content); setEditing(false); }}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : displayBlocks.length > 0 ? (
              <div className="space-y-2">
                {displayBlocks.map((block, i) =>
                  block.type === 'text' ? (
                    <p key={i} className="text-sm text-slate-200 whitespace-pre-wrap">{block.text}</p>
                  ) : (
                    (() => {
                      const photo = photos.find(p => p.id === block.id);
                      if (!photo) return null;
                      return (
                        <img
                          key={i}
                          src={getUrl(photo.storage_path)}
                          alt={photo.caption || stop.name}
                          className="w-full max-h-72 object-cover rounded-lg"
                        />
                      );
                    })()
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">
                {user ? 'No notes yet — click Edit to add some.' : 'No notes yet.'}
              </p>
            )}
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase">Photos</h3>
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

            {photosLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : photos.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No photos yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative group aspect-square">
                    <img
                      src={getUrl(photo.storage_path)}
                      alt={photo.caption || stop.name}
                      className="w-full h-full object-cover rounded-lg"
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

          {/* Sign-in prompt for read-only visitors */}
          {!user && (
            <div className="pt-2 border-t border-slate-700">
              <button
                onClick={() => signInWithProvider('google')}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Sign in to add notes or photos →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
