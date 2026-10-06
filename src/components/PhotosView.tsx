import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import type { Stop } from '../types';
import type { StopPhoto } from '../hooks/useStopContent';
import { supabase, getStopPhotoUrl } from '../lib/supabase';
import { effectiveArrival, formatStay } from '../services/routeEngine';
import { isVideoPath } from '../utils/journalContent';
import { COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import StopImage from './StopImage';

// Video tiles only fetch their first frame once scrolled near — otherwise opening
// the tab fires a range request for every video in the trip at once.
function LazyVideoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    let root: HTMLElement | null = el.parentElement; // the tab's own scroll panel
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={ref} className="w-full h-full">
      {near && <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />}
    </div>
  );
}

interface PhotosViewProps {
  stops: Stop[];
  currentStop?: Stop | null;
  onOpenEntry: (stop: Stop) => void;
}

/**
 * Every photo and video from the trip in one place, grouped by stop (latest
 * first), using the 480px variants for the grid. One query for the whole page.
 */
export default function PhotosView({ stops, currentStop, onOpenEntry }: PhotosViewProps) {
  const [photos, setPhotos] = useState<StopPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    let ignore = false;
    supabase.from('sailing_stop_photos').select('*').order('created_at', { ascending: true }).then(({ data, error }) => {
      if (ignore) return;
      if (error) setFailed(true);
      else setPhotos((data ?? []) as StopPhoto[]);
    });
    return () => { ignore = true; };
  }, []);

  // Groups in reverse trip order; one flat list (same order) drives the viewer.
  const groups = useMemo(() => {
    if (!photos) return [];
    const byKey = new Map<string, StopPhoto[]>();
    photos.forEach(p => byKey.set(p.stop_key, [...(byKey.get(p.stop_key) ?? []), p]));
    return stops
      .filter(s => byKey.has(s.key))
      .sort((a, b) => effectiveArrival(b).localeCompare(effectiveArrival(a)))
      .map(stop => ({ stop, photos: byKey.get(stop.key)! }));
  }, [photos, stops]);
  const flat = useMemo(() => groups.flatMap(g => g.photos.map(photo => ({ photo, stop: g.stop }))), [groups]);

  const total = flat.length;
  const step = (delta: number) => setOpenIndex(i => (i === null ? i : (i + delta + total) % total));
  const isOpen = openIndex !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIndex(null);
      else if (e.key === 'ArrowRight') setOpenIndex(i => (i === null ? i : (i + 1) % total));
      else if (e.key === 'ArrowLeft') setOpenIndex(i => (i === null ? i : (i - 1 + total) % total));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, total]);

  const open = openIndex !== null ? flat[openIndex] : null;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-8 sm:py-12">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400 mb-2">Sveti Ivan · 2026–27</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-white mb-2">Photos</h1>
          <p className="text-sm text-slate-400">{photos ? `${flat.length} photos and videos from along the way` : 'Every photo from along the way'}</p>
        </div>

        {failed ? (
          <p className="text-center text-slate-400">Couldn't load photos — check your connection and try again.</p>
        ) : !photos ? (
          <p className="text-center text-slate-500">Loading photos…</p>
        ) : (
          <div className="space-y-10">
            {groups.map(({ stop, photos: group }) => (
              <section key={stop.key} aria-labelledby={`photos-${stop.key}`}>
                <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
                  <h2 id={`photos-${stop.key}`} className="font-serif text-xl font-bold text-white">
                    {stop.name} <span className="text-base align-middle">{COUNTRY_FLAGS[stop.country] || ''}</span>
                  </h2>
                  <span className="shrink-0 text-xs text-slate-400">{formatStay(stop, stop.key === currentStop?.key, formatDate)}</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
                  {group.map(photo => {
                    const index = flat.findIndex(f => f.photo.id === photo.id);
                    const src = getStopPhotoUrl(photo.storage_path);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => setOpenIndex(index)}
                        className="relative aspect-square overflow-hidden rounded bg-slate-800 cursor-zoom-in"
                        aria-label={`Open ${isVideoPath(photo.storage_path) ? 'video' : 'photo'} from ${stop.name}${photo.caption ? `: ${photo.caption}` : ''}`}
                      >
                        {isVideoPath(photo.storage_path) ? (
                          <>
                            <LazyVideoThumb src={src} />
                            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="w-8 h-8 rounded-full bg-black/55 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                              </span>
                            </span>
                          </>
                        ) : (
                          <StopImage src={src} alt={photo.caption || stop.name} sizes="(min-width: 1024px) 160px, (min-width: 640px) 25vw, 33vw" className="w-full h-full object-cover" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-[2000] bg-black flex flex-col" onClick={() => setOpenIndex(null)}>
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-sm text-slate-300" onClick={(e) => e.stopPropagation()}>
            <span>{(openIndex ?? 0) + 1} / {flat.length}</span>
            <button onClick={() => setOpenIndex(null)} className="w-11 h-11 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white" aria-label="Close">
              <X size={22} aria-hidden />
            </button>
          </div>
          <div
            className="flex-1 min-h-0 flex items-center justify-center px-2"
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start === null) return;
              const dx = e.changedTouches[0].clientX - start;
              if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
            }}
          >
            {isVideoPath(open.photo.storage_path) ? (
              <video key={open.photo.id} src={getStopPhotoUrl(open.photo.storage_path)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
            ) : (
              <img key={open.photo.id} src={getStopPhotoUrl(open.photo.storage_path)} alt={open.photo.caption || open.stop.name} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          <div className="px-4 pt-3 text-center" onClick={(e) => e.stopPropagation()}>
            {open.photo.caption && <p className="font-serif italic text-slate-200 mb-1">{open.photo.caption}</p>}
            <button
              onClick={() => { setOpenIndex(null); onOpenEntry(open.stop); }}
              className="inline-flex items-center gap-1.5 text-sm text-cyan-300 hover:text-cyan-200"
            >
              <BookOpen size={15} aria-hidden /> {open.stop.name} — read the entry
            </button>
          </div>
          <div className="flex items-center justify-center gap-8 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => step(-1)} className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white" aria-label="Previous photo">
              <ChevronLeft size={26} aria-hidden />
            </button>
            <button onClick={() => step(1)} className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white" aria-label="Next photo">
              <ChevronRight size={26} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
