import { useState, useEffect, useRef, useMemo } from 'react';
import type { Stop } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import { effectiveArrival, formatStay, currentStopLabel } from '../services/routeEngine';
import { parseContent, isVideoPath, buildPhotoNumberMap, toShortForm, toFullForm, shortFormPhotoIds } from '../utils/journalContent';
import { downsampleImage } from '../utils/imageResize';
import { trimVideoToSizeLimit } from '../utils/videoTrim';
import StopImage from './StopImage';
import { MapPin, Landmark, Pencil, Camera, Video, Images, Share2, Flag, LogIn, X, ChevronLeft, ChevronRight, Link2, Check } from 'lucide-react';
import {
  startGooglePhotosSession,
  waitForGooglePhotosSelection,
  isGooglePhotosConfigured,
  type GooglePickerStatus,
  type GooglePhotosSessionHandle,
  pickerOpenUrl,
} from '../services/googlePhotosPicker';

// Video thumbnails otherwise look identical to photos until clicked — this overlay
// is the reader's only cue that a tile plays rather than just enlarges.
function PlayBadge({ small }: { small?: boolean } = {}) {
  const size = small ? 'w-8 h-8' : 'w-14 h-14';
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className={`${size} rounded-full bg-black/55 flex items-center justify-center`}>
        <svg viewBox="0 0 24 24" fill="white" className={small ? 'w-4 h-4 ml-0.5' : 'w-6 h-6 ml-1'}>
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    </div>
  );
}

// Renders a video's first frame as its thumbnail. preload="metadata" fetches
// only the first few hundred KB (a Range request), and the #t=0.1 fragment is
// what makes iOS Safari actually paint that frame instead of a blank box.
// Full playback happens in the lightbox.
function VideoFrame({ src, className, onClick, width, height }: { src: string; className: string; onClick?: () => void; width?: number | null; height?: number | null }) {
  return <video src={`${src}#t=0.1`} muted playsInline preload="metadata" onClick={onClick} width={width ?? undefined} height={height ?? undefined} className={className} />;
}

function HereNowChip({ stop }: { stop: Stop }) {
  return (
    <span className="mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-coral-400 text-slate-950">
      <MapPin size={12} aria-hidden /> {currentStopLabel(stop)}
    </span>
  );
}

interface JournalEntryCardProps {
  stop: Stop;
  isCurrent?: boolean;
  onToggleVisited?: (stop: Stop) => void;
  onLogArrival?: (stop: Stop) => void;
  onLogDeparture?: (stop: Stop) => void;
  onEmptyAndCancelled?: () => void; // called when a freshly-added blank entry is cancelled with nothing written
}

export default function JournalEntryCard({ stop, isCurrent, onToggleVisited, onLogArrival, onLogDeparture, onEmptyAndCancelled }: JournalEntryCardProps) {
  const { isEditor } = useAuth();
  const { content, loading: notesLoading, saving, save, error: notesError, loadFailed, refetch: refetchNotes } = useStopNotes(stop.key);
  const { photos, loading: photosLoading, upload, remove, setCaption, getUrl } = useStopPhotos(stop.key);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [googlePickerStatus, setGooglePickerStatus] = useState<GooglePickerStatus | null>(null);
  // Set once authorization + session creation succeed. While this is set, the
  // status-row button is replaced by a real <a target="_blank"> link — the
  // only reliable way to open the picker tab; see googlePhotosPicker.ts for
  // why window.open() doesn't work here even called synchronously on click.
  const [googleSession, setGoogleSession] = useState<GooglePhotosSessionHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const touchStartX = useRef<number | null>(null);
  const showLightboxRef = useRef<(delta: number) => void>(() => {});
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
    // A freshly-added entry with nothing yet starts straight into edit mode —
    // for editors only; readers would otherwise land on an empty, editable box.
    if (isEditor && !notesLoading && !loadFailed && !content && photos.length === 0) setEditing(true);
  }, [notesLoading, isEditor, loadFailed]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // The entry's first still photo becomes a full-bleed header (stop name and dates
  // over it) and isn't repeated further down. While editing, everything stays
  // exactly where the author placed it, so there's no hero then.
  const heroPhoto = useMemo(() => {
    if (editing) return null;
    for (const b of displayBlocks) {
      if (b.type !== 'photo') continue;
      const p = photos.find(x => x.id === b.id);
      if (p && !isVideoPath(p.storage_path)) return p;
    }
    return galleryPhotos.find(p => !isVideoPath(p.storage_path)) ?? null;
  }, [editing, displayBlocks, photos, galleryPhotos]);
  // Separate from inlinePhotoIds (which tracks saved `content`) so the picker reflects
  // photos just inserted into `draft` during the current edit, before Save is clicked.
  // draft is in the short {{photo N}} form (see photoNumberMapRef above), so this
  // reverses through the same map rather than parseContent (which expects UUIDs).
  const draftInlinePhotoIds = useMemo(
    () => shortFormPhotoIds(draft, photoNumberMapRef.current),
    [draft]
  );

  const handleSave = async () => {
    const result = await save(toFullForm(draft, photoNumberMapRef.current));
    // On failure stay in the editor with the draft intact (the error shows below);
    // closing would silently discard what was just written.
    if (!result?.error) setEditing(false);
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

  // Uploads go straight to R2 (no Supabase 50MB cap any more). 200MB keeps a
  // single upload sane over boat Starlink — well over a minute of phone video.
  // Anything bigger is trimmed losslessly to fit (see videoTrim.ts), and the
  // user is told so; non-video files that big are rejected up front.
  const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
  const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

  // Shared by both the local file picker and the Google Photos picker — uploads
  // each file to Supabase, appends an inline token for it, and tracks progress.
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploadProgress({ done: 0, total: files.length });
    const failures: string[] = [];
    const notices: string[] = [];
    for (const file of files) {
      let toUpload: File = file;
      if (file.size > MAX_UPLOAD_BYTES) {
        if (!file.type.startsWith('video/')) {
          failures.push(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(0)}MB — over the ${MAX_UPLOAD_MB}MB upload limit.`);
          setUploadProgress(p => (p ? { ...p, done: p.done + 1 } : null));
          continue;
        }
        try {
          toUpload = await trimVideoToSizeLimit(file, MAX_UPLOAD_BYTES);
          notices.push(`"${file.name}" was ${(file.size / (1024 * 1024)).toFixed(0)}MB, so only the first ~${Math.round((toUpload.size / file.size) * 100)}% was kept to fit the ${MAX_UPLOAD_MB}MB limit.`);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failures.push(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(0)}MB and couldn't be trimmed automatically (${reason}) — export a shorter clip and try again.`);
          setUploadProgress(p => (p ? { ...p, done: p.done + 1 } : null));
          continue;
        }
      }
      toUpload = await downsampleImage(toUpload);
      const { data, error } = await upload(toUpload);
      if (data) {
        const num = nextNumberFor(data.id);
        setDraft(prev => `${prev}${prev.trim() ? '\n\n' : ''}{{photo ${num}}}`);
      } else if (error) {
        failures.push(`"${file.name}": ${error.message}`);
      }
      setUploadProgress(p => (p ? { ...p, done: p.done + 1 } : null));
    }
    setUploadProgress(null);
    setEditing(true);
    // Previously these were swallowed silently — data-only destructuring meant
    // a failed upload (e.g. an oversized video) just vanished with no trace,
    // looking indistinguishable from "nothing happened". Live-confirmed: a
    // video that downloaded fine via the Google Photos relay never appeared
    // because the follow-up Supabase upload rejected it over the size limit,
    // and nothing told the user why.
    if (failures.length > 0 || notices.length > 0) {
      alert([
        failures.length > 0 ? `Couldn't upload:\n${failures.map(f => `• ${f}`).join('\n')}` : '',
        notices.length > 0 ? `Trimmed:\n${notices.map(n => `• ${n}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'));
    }
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

  // A direct link to this entry (App opens #<stop-key> on load). The phone's own
  // share sheet when available, otherwise copy to the clipboard.
  const handleSendLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${encodeURIComponent(stop.key)}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${stop.name} — Mediterranean Odyssey`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // closed the share sheet
      window.prompt('Copy this link:', url);
    }
  };

  // Escape closes the lightbox
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxId(null);
      // Don't flip photos while the editor is typing a caption
      else if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      else if (e.key === 'ArrowRight') showLightboxRef.current(1);
      else if (e.key === 'ArrowLeft') showLightboxRef.current(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxId]);

  // Lightbox steps through photos in reading order (header photo, then inline
  // photos as they appear, then the gallery), not upload order.
  const readingOrder = useMemo(() => {
    const seen = new Set<string>();
    const ordered: typeof photos = [];
    const add = (p: (typeof photos)[number] | undefined | null) => { if (p && !seen.has(p.id)) { seen.add(p.id); ordered.push(p); } };
    add(heroPhoto);
    for (const b of displayBlocks) if (b.type === 'photo') add(photos.find(p => p.id === b.id));
    galleryPhotos.forEach(add);
    photos.forEach(add); // anything else (e.g. while editing)
    return ordered;
  }, [heroPhoto, displayBlocks, photos, galleryPhotos]);
  const lightboxIndex = lightboxId ? readingOrder.findIndex(p => p.id === lightboxId) : -1;
  const lightboxPhoto = lightboxIndex >= 0 ? readingOrder[lightboxIndex] : null;
  const showLightbox = (delta: number) => {
    if (lightboxIndex < 0 || readingOrder.length === 0) return;
    const next = (lightboxIndex + delta + readingOrder.length) % readingOrder.length;
    setLightboxId(readingOrder[next].id);
  };
  // The keydown listener is registered once per open; read the latest index through a ref.
  showLightboxRef.current = showLightbox;

  const dateLine = `${formatStay(stop, isCurrent, formatDate)} · ${stop.country}`;

  // One full-width photo/video block, used both for photos placed in the text and
  // for any not placed — so a forgotten photo still reads as part of the story,
  // never as a stray thumbnail at the bottom.
  const renderPhotoBlock = (photo: (typeof photos)[number], key: string) => (
      <div key={key} className="relative group my-7 -mx-5 sm:-mx-6 bg-slate-800">
        {isVideoPath(photo.storage_path) ? (
          <VideoFrame
            src={getUrl(photo.storage_path)}
            width={photo.width}
            height={photo.height}
            onClick={() => setLightboxId(photo.id)}
            className="w-full h-auto max-h-[560px] object-cover cursor-zoom-in"
          />
        ) : (
          <button type="button" onClick={() => setLightboxId(photo.id)} className="block w-full cursor-zoom-in" aria-label={`Open photo from ${stop.name}`}>
            <StopImage
              src={getUrl(photo.storage_path)}
              alt={photo.caption || stop.name}
              width={photo.width}
              height={photo.height}
              sizes="(min-width: 672px) 672px, 100vw"
              className="w-full h-auto max-h-[560px] object-cover"
            />
          </button>
        )}
        {isVideoPath(photo.storage_path) && <PlayBadge />}
        {photo.caption && (
          <p className="px-5 sm:px-6 py-2 font-serif text-sm italic text-slate-400 bg-slate-900/40">{photo.caption}</p>
        )}
        {isEditor && (
          <button
            onClick={() => remove(photo)}
            className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/70 rounded-full text-white"
            title="Delete photo"
            aria-label="Delete photo"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
  );

  return (
    <article className={`rounded-2xl overflow-hidden bg-slate-800/60 ring-1 ${isCurrent ? 'ring-coral-400/70' : 'ring-slate-700/70'}`}>
      {heroPhoto && (
        <button
          type="button"
          onClick={() => setLightboxId(heroPhoto.id)}
          className="relative block w-full aspect-[4/3] sm:aspect-[16/9] bg-slate-800 cursor-zoom-in"
          aria-label={`Open photo from ${stop.name}`}
        >
          <StopImage
            src={getUrl(heroPhoto.storage_path)}
            alt={heroPhoto.caption || stop.name}
            width={heroPhoto.width}
            height={heroPhoto.height}
            sizes="(min-width: 672px) 672px, 100vw"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-left">
            {isCurrent && <HereNowChip stop={stop} />}
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white leading-tight drop-shadow">
              {stop.name} <span className="text-2xl align-middle">{COUNTRY_FLAGS[stop.country] || ''}</span>
            </h2>
            <p className="mt-1 text-sm text-slate-200">{dateLine}</p>
          </div>
        </button>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-2">
          {!heroPhoto ? (
            <div>
              {isCurrent && <HereNowChip stop={stop} />}
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white leading-tight">
                {stop.name} <span className="text-xl align-middle">{COUNTRY_FLAGS[stop.country] || ''}</span>
              </h2>
              <p className="mt-1 text-sm text-slate-400">{dateLine}</p>
            </div>
          ) : <span />}
          {isEditor && !editing && !loadFailed && (
            <button onClick={() => setEditing(true)} className="shrink-0 inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
              <Pencil size={14} aria-hidden /> Edit
            </button>
          )}
        </div>

        {/* Status row — mirrors the map's per-stop controls */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {isEditor && onToggleVisited && (
            <button
              onClick={() => onToggleVisited(stop)}
              className={`px-2 py-0.5 rounded text-xs font-medium border ${stop.visited ? 'bg-green-600/80 border-green-500 text-white' : 'border-slate-500 text-slate-400 hover:text-white hover:border-slate-300'}`}
            >
              {stop.visited ? '✓ Visited' : 'Mark Visited'}
            </button>
          )}
          {isEditor && onLogArrival && (
            <button onClick={() => onLogArrival(stop)} className="text-xs text-sky-400 hover:text-sky-300" title="Log today as the actual arrival date"><span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden /> Arrived today</span></button>
          )}
          {isEditor && onLogDeparture && (
            <button onClick={() => onLogDeparture(stop)} className="text-xs text-sky-400 hover:text-sky-300" title="Log today as the actual departure date"><span className="inline-flex items-center gap-1"><Flag size={14} aria-hidden /> Departed today</span></button>
          )}
          {isEditor && (
            <button
              onClick={() => openPicker(fileInputRef)}
              disabled={!!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploadProgress ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…` : <span className="inline-flex items-center gap-1"><Camera size={14} aria-hidden /> Add photos</span>}
            </button>
          )}
          {isEditor && (
            <button
              onClick={() => openPicker(videoInputRef)}
              disabled={!!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {uploadProgress ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…` : <span className="inline-flex items-center gap-1"><Video size={14} aria-hidden /> Add video</span>}
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
          {isEditor && isGooglePhotosConfigured && !googleSession && (
            <button
              onClick={handleGoogleAuthorize}
              disabled={!!googlePickerStatus || !!uploadProgress}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-500"
            >
              {googlePickerStatus === 'opening' ? 'Connecting…' : <span className="inline-flex items-center gap-1"><Images size={14} aria-hidden /> Google Photos</span>}
            </button>
          )}
          {isEditor && googleSession && (
            <a
              href={pickerOpenUrl(googleSession.pickerUri)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenPickerAndWait}
              className="text-xs text-cyan-400 hover:text-cyan-300 underline"
            >
              <span className="inline-flex items-center gap-1"><LogIn size={14} aria-hidden /> Click to open Google Photos</span>
            </a>
          )}
          {(googlePickerStatus === 'waiting' || googlePickerStatus === 'downloading') && (
            <span className="text-xs text-slate-500">
              {googlePickerStatus === 'waiting' ? 'Waiting for your picks…' : 'Importing…'}
            </span>
          )}
          <button
            onClick={handleSendLink}
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
            title="Send a link straight to this entry"
          >
            {linkCopied ? <><Check size={14} aria-hidden /> Link copied</> : <><Link2 size={14} aria-hidden /> Send link</>}
          </button>
          {isEditor && <button
            onClick={handleShare}
            disabled={photos.length === 0 || sharing}
            className="text-xs text-pink-400 hover:text-pink-300 disabled:text-slate-500"
            title={photos.length === 0 ? 'Add a photo or video first — Instagram needs media to post' : "Share the photo(s)/video to Instagram or another app. Instagram ignores captions from other apps, so this also copies the caption to your clipboard — paste it in."}
          >
            {sharing ? 'Preparing…' : <span className="inline-flex items-center gap-1"><Share2 size={14} aria-hidden /> Share</span>}
          </button>}
        </div>

        {stop.cultureHighlight && (
          <p className="flex items-center gap-1.5 text-sm text-cyan-300 mb-4"><Landmark size={15} aria-hidden className="shrink-0" /> {stop.cultureHighlight}</p>
        )}

        {loadFailed && !notesLoading ? (
          <div className="mt-3 rounded-lg border border-coral-400/50 bg-coral-500/10 px-4 py-3 text-sm text-slate-200" role="alert">
            Couldn't load this entry (connection problem?).{' '}
            <button onClick={() => refetchNotes()} className="underline text-cyan-300 hover:text-cyan-200">Try again</button>
          </div>
        ) : notesLoading || photosLoading ? (
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
                        <VideoFrame src={getUrl(photo.storage_path)} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <StopImage src={getUrl(photo.storage_path)} alt="" sizes="64px" className="w-full h-full object-cover" />
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
            {notesError && (
              <p className="text-sm text-coral-300" role="alert">Not saved: {notesError}</p>
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
          <div className="mt-2">
            {displayBlocks.map((block, i) =>
              block.type === 'text' ? (
                block.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).map((para, j) => (
                  <p key={`${i}-${j}`} className="font-serif text-[17px] sm:text-[18px] leading-[1.75] text-slate-100 whitespace-pre-wrap mb-5 last:mb-0">{para}</p>
                ))
              ) : (
                (() => {
                  const photo = photos.find(p => p.id === block.id);
                  if (!photo || photo.id === heroPhoto?.id) return null;
                  return renderPhotoBlock(photo, String(i));
                })()
              )
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic mt-3">{isEditor ? 'No notes for this stop.' : 'No entry yet — check back soon.'}</p>
        )}

        {/* Any photos not placed in the text still show — full width after it, like
            the rest, rather than as a thumbnail grid. Nothing is ever hidden. */}
        {!editing && galleryPhotos.filter(p => p.id !== heroPhoto?.id).map(photo => renderPhotoBlock(photo, photo.id))}
      </div>

      {lightboxPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photos from ${stop.name}`}
          className="fixed inset-0 z-[2000] bg-black flex flex-col"
          onClick={() => setLightboxId(null)}
        >
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-sm text-slate-300" onClick={(e) => e.stopPropagation()}>
            <span>{photos.length > 1 ? `${lightboxIndex + 1} / ${photos.length}` : ''}</span>
            <button
              onClick={() => setLightboxId(null)}
              className="w-11 h-11 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white"
              aria-label="Close"
            >
              <X size={22} aria-hidden />
            </button>
          </div>
          <div
            className="flex-1 min-h-0 flex items-center justify-center px-2"
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start === null || photos.length < 2) return;
              const dx = e.changedTouches[0].clientX - start;
              if (Math.abs(dx) > 50) showLightbox(dx < 0 ? 1 : -1);
            }}
          >
            {isVideoPath(lightboxPhoto.storage_path) ? (
              <video
                key={lightboxPhoto.id}
                src={getUrl(lightboxPhoto.storage_path)}
                controls
                autoPlay
                playsInline
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <img
                key={lightboxPhoto.id}
                src={getUrl(lightboxPhoto.storage_path)}
                alt={lightboxPhoto.caption || stop.name}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
          {isEditor ? (
            <form
              key={lightboxPhoto.id}
              className="px-4 pt-3 flex gap-2 max-w-xl w-full mx-auto"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem('caption') as HTMLInputElement);
                setCaption(lightboxPhoto, input.value).then(() => input.blur());
              }}
            >
              <label htmlFor={`caption-${lightboxPhoto.id}`} className="sr-only">Caption</label>
              <input
                id={`caption-${lightboxPhoto.id}`}
                name="caption"
                defaultValue={lightboxPhoto.caption ?? ''}
                placeholder="Add a caption…"
                maxLength={200}
                className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
              />
              <button type="submit" className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm text-white">Save</button>
            </form>
          ) : lightboxPhoto.caption && (
            <p className="px-6 pt-3 text-center text-sm text-slate-300 font-serif italic" onClick={(e) => e.stopPropagation()}>{lightboxPhoto.caption}</p>
          )}
          {photos.length > 1 && (
            <div className="flex items-center justify-center gap-8 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => showLightbox(-1)}
                className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white"
                aria-label="Previous photo"
              >
                <ChevronLeft size={26} aria-hidden />
              </button>
              <button
                onClick={() => showLightbox(1)}
                className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white"
                aria-label="Next photo"
              >
                <ChevronRight size={26} aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
