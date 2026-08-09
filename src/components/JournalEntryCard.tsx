import { useState, useEffect, useRef, useMemo } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import { effectiveArrival, effectiveDeparture } from '../services/routeEngine';
import { parseContent, isVideoPath, buildPhotoNumberMap, toShortForm, toFullForm, shortFormPhotoIds } from '../utils/journalContent';
import { downsampleImage } from '../utils/imageResize';
import {
  startGooglePhotosSession,
  waitForGooglePhotosSelection,
  isGooglePhotosConfigured,
  type GooglePickerStatus,
  type GooglePhotosSessionHandle,
} from '../services/googlePhotosPicker';

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
  const [sharing, setSharing] = useState(false);
  const [googlePickerStatus, setGooglePickerStatus] = useState<GooglePickerStatus | null>(null);
  // Set once authorization + session creation succeed. While this is set, the
  // status-row button is replaced by a real <a target="_blank"> link — the
  // only reliable way to open the picker tab; see googlePhotosPicker.ts for
  // why window.open() doesn't work here even called synchronously on click.
  const [googleSession, setGoogleSession] = useState<GooglePhotosSessionHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guards against a rapid double-tap firing the OS file chooser twice before
  // React's disabled-button re-render catches up — a plausible cause of the
  // native picker getting stuck reopening. A ref (not state) so the check is
  // synchronous, not deferred to the next render.
  const pickerOpenRef = useRef(false);
  // photoId -> small number, so the editor shows {{photo 3}} instead of the raw
  // UUID — a ref (not state) since it's read-modify-write within the same
  // synchronous handler/loop iteration (e.g. uploading several files in a row),
  // where a state update wouldn't be visible until the next render.
  const photoNumberMapRef = useRef<Map<string, number>>(new Map());
  const nextNumberFor = (photoId: string): number => {
    const map = photoNumberMapRef.current;
    let num = map.get(photoId);
    if (num === undefined) {
      num = map.size + 1;
      map.set(photoId, num);
    }
    return num;
  };

  useEffect(() => {
    photoNumberMapRef.current = buildPhotoNumberMap(content);
    setDraft(toShortForm(content, photoNumberMapRef.current));
  }, [content]);
  useEffect(() => {
    // A freshly-added entry with nothing yet starts straight into edit mode
    if (!notesLoading && !content && photos.length === 0) setEditing(true);
  }, [notesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // The change event never fires if the user cancels the native picker
    // without selecting anything, so the guard needs a second way to clear —
    // returning focus to the tab covers both the "picked" and "canceled" paths.
    const clearGuard = () => { pickerOpenRef.current = false; };
    window.addEventListener('focus', clearGuard);
    return () => window.removeEventListener('focus', clearGuard);
  }, []);

  const openPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (pickerOpenRef.current) return;
    pickerOpenRef.current = true;
    ref.current?.click();
  };

  const displayBlocks = useMemo(() => parseContent(content), [content]);
  const inlinePhotoIds = useMemo(
    () => new Set(displayBlocks.filter((b): b is { type: 'photo'; id: string } => b.type === 'photo').map(b => b.id)),
    [displayBlocks]
  );
  const galleryPhotos = useMemo(() => photos.filter(p => !inlinePhotoIds.has(p.id)), [photos, inlinePhotoIds]);
  // Separate from inlinePhotoIds (which tracks saved `content`) so the picker reflects
  // photos just inserted into `draft` during the current edit, before Save is clicked.
  // draft is in the short {{photo N}} form (see photoNumberMapRef above), so this
  // reverses through the same map rather than parseContent (which expects UUIDs).
  const draftInlinePhotoIds = useMemo(
    () => shortFormPhotoIds(draft, photoNumberMapRef.current),
    [draft]
  );

  const handleSave = async () => {
    await save(toFullForm(draft, photoNumberMapRef.current));
    setEditing(false);
  };

  const handleCancel = () => {
    photoNumberMapRef.current = buildPhotoNumberMap(content);
    setDraft(toShortForm(content, photoNumberMapRef.current));
    setEditing(false);
    if (!content && photos.length === 0) onEmptyAndCancelled?.();
  };

  const insertPhotoToken = (photoId: string) => {
    const ta = textareaRef.current;
    const token = `{{photo ${nextNumberFor(photoId)}}}`;
    const start = ta ? ta.selectionStart : draft.length;
    const end = ta ? ta.selectionEnd : draft.length;
    setDraft(prev => `${prev.slice(0, start)}\n\n${token}\n\n${prev.slice(end)}`);
    requestAnimationFrame(() => ta?.focus());
  };

  // Shared by both the local file picker and the Google Photos picker — uploads
  // each file to Supabase, appends an inline token for it, and tracks progress.
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploadProgress({ done: 0, total: files.length });
    for (const file of files) {
      const toUpload = await downsampleImage(file);
      const { data } = await upload(toUpload);
      if (data) {
        const num = nextNumberFor(data.id);
        setDraft(prev => `${prev}${prev.trim() ? '\n\n' : ''}{{photo ${num}}}`);
      }
      setUploadProgress(p => (p ? { ...p, done: p.done + 1 } : null));
    }
    setUploadProgress(null);
    setEditing(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    pickerOpenRef.current = false;
    const files = Array.from(e.target.files ?? []);
    await uploadFiles(files);
    e.target.value = '';
  };

  // Step 1: authorize + create the picker session. Deliberately doesn't try
  // to open anything itself — see googlePhotosPicker.ts for why. Once this
  // succeeds, the button is replaced by a real link to click (step 2).
  const handleGoogleAuthorize = async () => {
    if (googlePickerStatus || uploadProgress || googleSession) return;
    try {
      const session = await startGooglePhotosSession(setGooglePickerStatus);
      setGoogleSession(session);
      setGooglePickerStatus(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Google Photos authorization failed:', err);
      alert(`Couldn't connect to Google Photos: ${message}`);
      setGooglePickerStatus(null);
    }
  };

  // Step 2: fired by the <a target="_blank"> onClick — the browser handles
  // actually opening the tab natively; this just starts polling for when the
  // user finishes selecting there, then downloads and uploads the results.
  const handleOpenPickerAndWait = async () => {
    const session = googleSession;
    if (!session) return;
    setGoogleSession(null);
    try {
      const { files, failures } = await waitForGooglePhotosSelection(session, setGooglePickerStatus);
      setGooglePickerStatus('downloading'); // keep the label steady while these upload to Supabase
      if (files.length > 0) await uploadFiles(files);
      // Surface partial failures (e.g. a video still processing) without losing
      // whatever else was successfully imported alongside it.
      if (failures.length > 0) {
        alert(
          (files.length > 0 ? `Imported ${files.length} of ${files.length + failures.length}.\n\n` : '') +
          `Couldn't import:\n${failures.map(f => `• ${f}`).join('\n')}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Google Photos picker failed:', err);
      alert(`Couldn't get photos from Google Photos: ${message}`);
    } finally {
      setGooglePickerStatus(null);
    }
  };

  // Plain-text version of the entry for sharing — strips {{photo:ID}} tokens
  // (meaningless outside this app) and prefixes the stop/date for context.
  const buildCaption = () => {
    const textParts = displayBlocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text.trim())
      .filter(Boolean);
    const header = `${stop.name}, ${stop.country}${effectiveArrival(stop) ? ` — ${formatDate(effectiveArrival(stop))}` : ''}`;
    return [header, ...textParts, '#MediterraneanOdyssey #Sailing'].join('\n\n');
  };

  // Hands the entry's photos/videos + caption to the OS share sheet, where
  // Instagram (among other apps) can pick it up — there's no way to publish
  // to Instagram directly from a browser without a Business account + Meta
  // Graph API setup, so this is the share-sheet handoff every consumer app
  // uses instead. Instagram's own app silently drops any accompanying text
  // when it receives a photo/video share intent — it only accepts the media,
  // regardless of what's in `text`/`title` — so the caption is copied to the
  // clipboard unconditionally, ready to paste into Instagram's caption box.
  // Falls back to also opening the first photo in a new tab on browsers
  // without file-sharing support (desktop).
  const handleShare = async () => {
    if (photos.length === 0 || sharing) return;
    setSharing(true);
    const caption = buildCaption();
    await navigator.clipboard.writeText(caption).catch(() => {
      // clipboard access can fail (permissions) — nothing more to do silently
    });
    try {
      const files = await Promise.all(
        photos.map(async (p) => {
          const res = await fetch(getUrl(p.storage_path));
          const blob = await res.blob();
          const ext = p.storage_path.split('.').pop() || (isVideoPath(p.storage_path) ? 'mp4' : 'jpg');
          return new File([blob], `${stop.key}-${p.id}.${ext}`, { type: blob.type });
        })
      );

      if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare({ files }))) {
        throw new Error('File sharing not supported on this browser');
      }
      await navigator.share({ title: stop.name, text: caption, files });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // user cancelled the share sheet
      console.warn('Share failed, falling back to opening the photo directly:', err);
      if (photos[0]) window.open(getUrl(photos[0].storage_path), '_blank');
      alert("Your browser can't hand photos directly to Instagram. Caption copied to your clipboard, and the first photo opened in a new tab — save it, then paste the caption into Instagram.");
    } finally {
      setSharing(false);
    }
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
              {formatDate(effectiveArrival(stop))}{effectiveDeparture(stop) && effectiveArrival(stop) !== effectiveDeparture(stop) && ` → ${formatDate(effectiveDeparture(stop))}`}
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
              onClick={() => openPicker(fileInputRef)}
              disabled={!!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploadProgress ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…` : '📷 Add photos'}
            </button>
          )}
          {user && (
            <button
              onClick={() => openPicker(videoInputRef)}
              disabled={!!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploadProgress ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…` : '🎥 Add video'}
            </button>
          )}
          {/* Separate inputs — accept="image/*,video/*" on one input can make some
              Android browsers fall back to the slow legacy file picker (enumerating
              and thumbnailing the whole camera roll) instead of the fast native
              Photos picker that accept="image/*" alone triggers. */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          <input ref={videoInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleFileChange} />
          {/* Hidden until VITE_GOOGLE_CLIENT_ID is configured — mainly useful on
              desktop, where the OS file picker can't browse a cloud library the
              way Android's native Photos picker can.
              Two-step: authorize first (button), then a real link to open the
              picker tab — a native <a target="_blank"> click is the one thing
              browsers don't treat as a blockable pop-up here. */}
          {user && isGooglePhotosConfigured && !googleSession && (
            <button
              onClick={handleGoogleAuthorize}
              disabled={!!googlePickerStatus || !!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {googlePickerStatus === 'opening' ? 'Connecting…' : '🖼️ Google Photos'}
            </button>
          )}
          {user && googleSession && (
            <a
              href={googleSession.pickerUri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenPickerAndWait}
              className="text-xs text-cyan-400 hover:text-cyan-300 underline"
            >
              ▶️ Click to open Google Photos
            </a>
          )}
          {(googlePickerStatus === 'waiting' || googlePickerStatus === 'downloading') && (
            <span className="text-xs text-slate-500">
              {googlePickerStatus === 'waiting' ? 'Waiting for your picks…' : 'Importing…'}
            </span>
          )}
          <button
            onClick={handleShare}
            disabled={photos.length === 0 || sharing}
            className="text-xs text-pink-400 hover:text-pink-300 disabled:text-slate-500"
            title={photos.length === 0 ? 'Add a photo or video first — Instagram needs media to post' : "Share the photo(s)/video to Instagram or another app. Instagram ignores captions from other apps, so this also copies the caption to your clipboard — paste it in."}
          >
            {sharing ? 'Preparing…' : '📲 Share'}
          </button>
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
                      {isVideoPath(photo.storage_path) ? (
                        <video src={getUrl(photo.storage_path)} muted playsInline className="w-full h-full object-cover" />
                      ) : (
                        <img src={getUrl(photo.storage_path)} alt="" className="w-full h-full object-cover" />
                      )}
                      {isVideoPath(photo.storage_path) && (
                        <span className="absolute top-0 left-0 bg-black/70 text-white text-[9px] px-1">🎥</span>
                      )}
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
                      {isVideoPath(photo.storage_path) ? (
                        <video
                          src={getUrl(photo.storage_path)}
                          muted
                          playsInline
                          onClick={() => setLightboxId(photo.id)}
                          className="w-full max-h-[520px] object-cover cursor-zoom-in"
                        />
                      ) : (
                        <img
                          src={getUrl(photo.storage_path)}
                          alt={photo.caption || stop.name}
                          onClick={() => setLightboxId(photo.id)}
                          className="w-full max-h-[520px] object-cover cursor-zoom-in"
                        />
                      )}
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
                {isVideoPath(photo.storage_path) ? (
                  <video
                    src={getUrl(photo.storage_path)}
                    muted
                    playsInline
                    onClick={() => setLightboxId(photo.id)}
                    className="w-full h-full object-cover rounded cursor-zoom-in"
                  />
                ) : (
                  <img
                    src={getUrl(photo.storage_path)}
                    alt={photo.caption || stop.name}
                    onClick={() => setLightboxId(photo.id)}
                    className="w-full h-full object-cover rounded cursor-zoom-in"
                  />
                )}
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
          {isVideoPath(lightboxPhoto.storage_path) ? (
            <video
              src={getUrl(lightboxPhoto.storage_path)}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded"
            />
          ) : (
            <img
              src={getUrl(lightboxPhoto.storage_path)}
              alt={lightboxPhoto.caption || stop.name}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded"
            />
          )}
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
