import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { Stop } from '../types';
import { sailedTrack, effectiveArrival } from '../services/routeEngine';
import { haversine, daysBetween, todayISO } from '../utils/geo';

interface RouteSoFarCardProps {
  stops: Stop[];
  onOpenMap: () => void;
}

const W = 600;
const H = 280;

/**
 * "The route so far" — a lightweight picture of the sailed track over a simplified
 * coastline, plus a few trip stats, at the top of the journal. Deliberately not a
 * Leaflet map: the real map is lazy-loaded so journal readers don't download it.
 * The coastline (~32KB) is loaded on demand too.
 */
export default function RouteSoFarCard({ stops, onOpenMap }: RouteSoFarCardProps) {
  const [coast, setCoast] = useState<number[][][] | null>(null);
  useEffect(() => {
    let ignore = false;
    import('../data/medCoastline.json').then(m => { if (!ignore) setCoast(m.default.polygons as number[][][]); });
    return () => { ignore = true; };
  }, []);

  const track = useMemo(() => sailedTrack(stops), [stops]);
  const visited = useMemo(() => stops.filter(s => s.visited), [stops]);

  const view = useMemo(() => {
    if (track.length < 2) return null;
    const lats = track.map(p => p[0]);
    const lons = track.map(p => p[1]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const k = Math.cos((midLat * Math.PI) / 180); // equirectangular, corrected for latitude
    const xs = lons.map(l => l * k);
    let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...lats), Math.max(...lats)];
    // pad, and keep a minimum span so a short trip isn't absurdly zoomed in
    const padX = Math.max((x1 - x0) * 0.12, 1.2);
    const padY = Math.max((y1 - y0) * 0.12, 0.8);
    [x0, x1, y0, y1] = [x0 - padX, x1 + padX, y0 - padY, y1 + padY];
    const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * scale) / 2;
    const oy = (H - (y1 - y0) * scale) / 2;
    const project = (lat: number, lon: number): [number, number] =>
      [ox + (lon * k - x0) * scale, oy + (y1 - lat) * scale];
    const inView = (ring: number[][]) => ring.some(([lon, lat]) => lon * k >= x0 && lon * k <= x1 && lat >= y0 && lat <= y1);
    return { project, inView };
  }, [track]);

  const stats = useMemo(() => {
    let km = 0;
    for (let i = 1; i < track.length; i++) km += haversine(track[i - 1][0], track[i - 1][1], track[i][0], track[i][1]);
    const first = visited[0] ? effectiveArrival(visited[0]) : '';
    return {
      nm: Math.round(km / 1.852),
      days: first ? daysBetween(first, todayISO()) : 0,
      stops: visited.length,
      countries: new Set(visited.map(s => s.country)).size,
    };
  }, [track, visited]);

  if (!view) return null;
  const pts = track.map(([lat, lon]) => view.project(lat, lon));
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];

  return (
    <section className="mb-10 rounded-2xl overflow-hidden bg-slate-800/60 ring-1 ring-slate-700/70" aria-labelledby="route-so-far">
      <div className="px-5 pt-5 sm:px-6 flex items-baseline justify-between gap-3">
        <h2 id="route-so-far" className="font-serif text-xl font-bold text-white">The route so far</h2>
        <button onClick={onOpenMap} className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300">
          <MapIcon size={15} aria-hidden /> View on map
        </button>
      </div>

      <button type="button" onClick={onOpenMap} className="block w-full mt-3" aria-label="Open the full map">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block bg-slate-900" role="img" aria-label={`Sailed track: ${stats.stops} stops, about ${stats.nm} nautical miles`}>
          {coast?.filter(view.inView).map((ring, i) => (
            <path
              key={i}
              d={'M' + ring.map(([lon, lat]) => view.project(lat, lon).map(n => n.toFixed(1)).join(',')).join('L') + 'Z'}
              className="fill-slate-700 stroke-slate-500"
              strokeWidth={0.6}
            />
          ))}
          <polyline points={line} fill="none" stroke="#07111b" strokeOpacity={0.5} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={line} fill="none" stroke="#ff9a6b" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={sx} cy={sy} r={4.5} className="fill-slate-100" />
          <circle cx={ex} cy={ey} r={9} fill="#ff9a6b" fillOpacity={0.25} />
          <circle cx={ex} cy={ey} r={5} fill="#ff9a6b" stroke="#07111b" strokeWidth={1.5} />
        </svg>
      </button>

      <dl className="grid grid-cols-4 divide-x divide-slate-700/70 text-center py-4">
        {[
          [stats.days, 'days'],
          [stats.nm.toLocaleString(), 'nautical miles'],
          [stats.stops, 'stops'],
          [stats.countries, stats.countries === 1 ? 'country' : 'countries'],
        ].map(([value, label]) => (
          <div key={label} className="px-1">
            <dt className="sr-only">{label}</dt>
            <dd className="font-serif text-xl sm:text-2xl font-bold text-white">{value}</dd>
            <dd className="text-[11px] sm:text-xs text-slate-400">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
