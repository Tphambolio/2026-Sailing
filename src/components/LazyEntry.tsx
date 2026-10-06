import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Stop } from '../types';
import { COUNTRY_FLAGS } from '../data/constants';

interface LazyEntryProps {
  stop: Stop;
  dateLine: string;
  /** Mount immediately (current stop, deep-linked/focused stop) */
  eager?: boolean;
  children: ReactNode;
}

/**
 * Defers mounting a journal entry (and so its two Supabase fetches) until it's
 * within ~1.5 screens of the viewport. Opening the journal used to fire every
 * entry's requests at once (~230); now only the first few load, and the rest
 * follow as you scroll. Once mounted, an entry stays mounted.
 */
export default function LazyEntry({ stop, dateLine, eager = false, children }: LazyEntryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(eager);
  // Latch: once rendered (eagerly or on scroll) an entry stays mounted, so a
  // draft being written isn't lost when it stops being the focused stop.
  if (eager && !seen) setSeen(true);
  const mounted = eager || seen;

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    // No IntersectionObserver (very old browsers / tests): just render it.
    if (!el || typeof IntersectionObserver === 'undefined') {
      const t = setTimeout(() => setSeen(true), 0);
      return () => clearTimeout(t);
    }
    // The journal scrolls inside its own panel, not the window — observe relative
    // to that panel, or the look-ahead margin is clipped away and entries only
    // load once already on screen.
    let root: HTMLElement | null = el.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setSeen(true); },
      { root, rootMargin: '1200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  if (mounted) return <>{children}</>;
  return (
    <div
      ref={ref}
      className="rounded-2xl bg-slate-800/40 ring-1 ring-slate-700/60 p-5 sm:p-6 min-h-[90vh]"
      aria-label={`${stop.name} — loading`}
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white/80 leading-tight">
        {stop.name} <span className="text-xl align-middle">{COUNTRY_FLAGS[stop.country] || ''}</span>
      </h2>
      <p className="mt-1 text-sm text-slate-500">{dateLine}</p>
      <div className="mt-6 space-y-3" aria-hidden>
        <div className="h-3 rounded bg-slate-700/50 w-11/12" />
        <div className="h-3 rounded bg-slate-700/50 w-10/12" />
        <div className="h-3 rounded bg-slate-700/50 w-9/12" />
      </div>
    </div>
  );
}
