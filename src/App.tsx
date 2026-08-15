import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getData, saveUserStops, clearUserStops, exportStopsJson } from './services/dataService';
import { healRoute, computePhases, computeStats, insertStop, removeStop, updateStop, computeSchengenStatus, effectiveArrival, effectiveDeparture } from './services/routeEngine';
import type { Stop, Phase, TripStats } from './types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './types';
import { NON_SCHENGEN, COUNTRY_COLORS, COUNTRY_FLAGS } from './data/constants';
import { formatDate, daysBetween, todayISO } from './utils/geo';
import StopEditor from './components/StopEditor';
import NotesModal from './components/NotesModal';
import NotePreviewTile from './components/NotePreviewTile';
import JournalView from './components/JournalView';
import { useAuth } from './context/AuthContext';

// Calculate rolling 90/180 Schengen days for each stop
function calculateSchengenDays(stops: Stop[]): Map<number, { days: number; rolling: number; isPaused: boolean }> {
  const schengenMap = new Map<number, { days: number; rolling: number; isPaused: boolean }>();

  // Build a list of all Schengen day ranges (arrival to departure for each Schengen stop)
  const schengenRanges: { start: Date; end: Date }[] = [];

  stops.forEach((stop) => {
    const arrival = effectiveArrival(stop);
    const departure = effectiveDeparture(stop);
    if (!arrival || !departure) return;
    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    if (isSchengen) {
      const [y1, m1, d1] = arrival.split('-').map(Number);
      const [y2, m2, d2] = departure.split('-').map(Number);
      schengenRanges.push({
        start: new Date(y1, m1 - 1, d1),
        end: new Date(y2, m2 - 1, d2),
      });
    }
  });

  // For each stop, calculate rolling 90/180
  stops.forEach((stop) => {
    const arrival = effectiveArrival(stop);
    const departure = effectiveDeparture(stop);
    if (!arrival) {
      schengenMap.set(stop.id, { days: 0, rolling: 0, isPaused: true });
      return;
    }

    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    const stayDays = arrival && departure ? daysBetween(arrival, departure) : 0;

    // Calculate the reference date (end of stay at this stop)
    const [y, m, d] = departure ? departure.split('-').map(Number) : arrival.split('-').map(Number);
    const referenceDate = new Date(y, m - 1, d);

    // Look back 180 days from reference date
    const windowStart = new Date(referenceDate);
    windowStart.setDate(windowStart.getDate() - 180);

    // Count Schengen days in the 180-day window
    let daysInWindow = 0;
    schengenRanges.forEach(range => {
      // Find overlap between this range and the 180-day window
      const overlapStart = new Date(Math.max(range.start.getTime(), windowStart.getTime()));
      const overlapEnd = new Date(Math.min(range.end.getTime(), referenceDate.getTime()));

      if (overlapStart < overlapEnd) {
        daysInWindow += Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24));
      }
    });

    schengenMap.set(stop.id, {
      days: stayDays,
      rolling: daysInWindow,
      isPaused: !isSchengen
    });
  });

  return schengenMap;
}

// Fix Leaflet default marker icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom marker icon creator with zoom-based scaling
function createMarkerIcon(stop: Stop, zoom: number, isCurrent: boolean = false): L.DivIcon {
  const isAnchorage = stop.type === 'anchorage';
  const bgColor = isAnchorage ? '#f97316' : '#3b82f6';
  const iconEmoji = isAnchorage ? '⚓' : '⛵';

  // Scale marker size based on zoom (smaller when zoomed out)
  const baseSize = zoom < 7 ? 20 : zoom < 9 ? 26 : 32;
  const fontSize = zoom < 7 ? 10 : zoom < 9 ? 12 : 14;
  const borderWidth = zoom < 7 ? 1 : 2;
  const opacity = stop.visited ? 1 : 0.55;
  const ring = isCurrent ? 'box-shadow:0 0 0 4px rgba(250,204,21,0.6),0 2px 8px rgba(0,0,0,0.3);' : 'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  const checkBadge = stop.visited
    ? `<div style="position:absolute;bottom:-2px;right:-2px;width:${Math.round(baseSize * 0.5)}px;height:${Math.round(baseSize * 0.5)}px;border-radius:50%;background:#22c55e;border:1px solid white;display:flex;align-items:center;justify-content:center;font-size:${Math.max(7, fontSize - 4)}px;color:white;">✓</div>`
    : '';
  // Stop order number — same numbering as the sidebar list ("1. Šibenik", "2. Arta
  // Mala", ...). Stands in for the route lines that used to convey ordering visually.
  // min-width (not a fixed width) so 3-digit stop numbers don't get clipped.
  const numberBadge = `<div style="position:absolute;top:-4px;left:-4px;min-width:${Math.round(baseSize * 0.55)}px;height:${Math.round(baseSize * 0.55)}px;padding:0 3px;border-radius:${Math.round(baseSize * 0.3)}px;background:#1e293b;border:1px solid white;display:flex;align-items:center;justify-content:center;font-size:${Math.max(7, fontSize - 3)}px;font-weight:700;line-height:1;color:white;">${stop.id}</div>`;

  return L.divIcon({
    className: `custom-marker-container${isCurrent ? ' current-stop-marker' : ''}`,
    html: `<div style="position:relative;opacity:${opacity};"><div style="display:flex;align-items:center;justify-content:center;width:${baseSize}px;height:${baseSize}px;border-radius:50%;background:${bgColor};border:${borderWidth}px solid white;color:white;font-size:${fontSize}px;${ring}cursor:pointer">${iconEmoji}</div>${checkBadge}${numberBadge}</div>`,
    iconSize: [baseSize, baseSize],
    iconAnchor: [baseSize / 2, baseSize / 2],
  });
}

// Map component that handles flying to selected stop
function MapController({ selectedStop }: { selectedStop: Stop | null }) {
  const map = useMap();
  const lastFlyToId = useRef<number | null>(null);

  useEffect(() => {
    if (selectedStop && selectedStop.id !== lastFlyToId.current) {
      lastFlyToId.current = selectedStop.id;
      map.flyTo([selectedStop.lat, selectedStop.lon], 15, { duration: 1.5 });
    }
    if (!selectedStop) {
      lastFlyToId.current = null;
    }
  }, [selectedStop, map]);

  return null;
}

// Component to track zoom level
function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    onZoomChange(map.getZoom());

    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };

    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

// Get distance color: <50 green, 50-70 yellow, >70 red
function getDistanceColor(km: number): string {
  if (km < 50) return '#22c55e'; // green
  if (km <= 70) return '#eab308'; // yellow
  return '#ef4444'; // red
}

function App() {
  const { user, signInWithProvider, signOut } = useAuth();
  const [notesModalStop, setNotesModalStop] = useState<Stop | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUserEdited, setIsUserEdited] = useState(false);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_MAP_ZOOM);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('satellite');
  const [activeView, setActiveView] = useState<'map' | 'journal'>('map');
  // Stop editing state
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | null>(null);

  const tileLayerConfig = {
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO' },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
    streets: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap' }
  };

  const handleZoomChange = useCallback((zoom: number) => {
    setZoomLevel(zoom);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const result = await getData();
        if (cancelled) return;
        setStops(result.stops);
        setPhases(result.phases);
        setStats(result.stats);
        setIsUserEdited(result.isUserEdited);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply route changes: heal, recompute, persist
  const applyRouteChange = useCallback((newStops: Stop[]) => {
    const healed = healRoute(newStops);
    setStops(healed);
    setPhases(computePhases(healed));
    setStats(computeStats(healed));
    saveUserStops(healed);
    setIsUserEdited(true);
    // Keep the open detail panel in sync with the freshly healed stop data
    setSelectedStop(prev => prev ? healed.find(s => s.id === prev.id) || null : prev);
  }, []);

  // Reality tracking handlers
  const handleToggleVisited = useCallback((stop: Stop) => {
    const index = stops.findIndex(s => s.id === stop.id);
    if (index < 0) return;
    applyRouteChange(updateStop(stops, index, { visited: !stop.visited }));
  }, [stops, applyRouteChange]);

  // Dragging a marker to correct its position — simpler than the old
  // click-to-place "pick location" flow this replaces. healRoute() (inside
  // applyRouteChange) recomputes distanceToNext for the dragged stop and its
  // neighbour automatically, same as any other lat/lon edit.
  const handleMoveStop = useCallback((stop: Stop, lat: number, lon: number) => {
    const index = stops.findIndex(s => s.id === stop.id);
    if (index < 0) return;
    applyRouteChange(updateStop(stops, index, { lat, lon }));
  }, [stops, applyRouteChange]);

  const handleLogArrival = useCallback((stop: Stop) => {
    const index = stops.findIndex(s => s.id === stop.id);
    if (index < 0) return;
    applyRouteChange(updateStop(stops, index, { actualArrival: todayISO(), visited: true }));
  }, [stops, applyRouteChange]);

  const handleLogDeparture = useCallback((stop: Stop) => {
    const index = stops.findIndex(s => s.id === stop.id);
    if (index < 0) return;
    applyRouteChange(updateStop(stops, index, { actualDeparture: todayISO(), visited: true }));
  }, [stops, applyRouteChange]);

  // Stop editor handlers
  const handleAddStop = useCallback((afterIndex: number) => {
    setInsertAfterIndex(afterIndex);
    setEditingStop(null);
  }, []);

  const handleEditStop = useCallback((stop: Stop) => {
    setEditingStop(stop);
    setInsertAfterIndex(null);
  }, []);

  const handleDeleteStop = useCallback((index: number) => {
    const newStops = removeStop(stops, index);
    applyRouteChange(newStops);
    if (selectedStop && stops[index]?.id === selectedStop.id) {
      setSelectedStop(null);
    }
  }, [stops, selectedStop, applyRouteChange]);

  const handleSaveStop = useCallback((stopData: Partial<Stop>) => {
    if (editingStop) {
      // Editing existing stop
      const index = stops.findIndex(s => s.id === editingStop.id);
      if (index >= 0) {
        const newStops = updateStop(stops, index, stopData);
        applyRouteChange(newStops);
      }
    } else if (insertAfterIndex !== null) {
      // Inserting new stop
      const newStops = insertStop(stops, insertAfterIndex, stopData);
      applyRouteChange(newStops);
    }
    setEditingStop(null);
    setInsertAfterIndex(null);
  }, [stops, editingStop, insertAfterIndex, applyRouteChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingStop(null);
    setInsertAfterIndex(null);
  }, []);

  const handleResetRoute = useCallback(async () => {
    await clearUserStops();
    const result = await getData();
    setStops(result.stops);
    setPhases(result.phases);
    setStats(result.stats);
    setIsUserEdited(false);
  }, []);

  // Set initial sidebar state based on screen width (after mount)
  useEffect(() => {
    const isDesktop = window.innerWidth >= 768;
    setSidebarOpen(isDesktop);
    setLegendVisible(isDesktop);
  }, []);

  const countries = [...new Set(stops.map(s => s.country))];

  // Calculate Schengen days for each stop
  const schengenDays = useMemo(() => calculateSchengenDays(stops), [stops]);

  // Live 90/180 Schengen status as of today
  const schengenStatus = useMemo(() => computeSchengenStatus(stops), [stops]);

  // The stop we're currently at: today falls within its (effective) stay window,
  // falling back to the most recently visited stop.
  const currentStop = useMemo(() => {
    const today = todayISO();
    // Search from the end: when one stop's departure equals the next's arrival (the
    // usual case), prefer the later stop — the one just arrived at, not the one left.
    const inProgress = [...stops].reverse().find(s => {
      const arrival = effectiveArrival(s);
      const departure = effectiveDeparture(s);
      return arrival && departure && arrival <= today && today <= departure;
    });
    if (inProgress) return inProgress;
    const visitedStops = stops.filter(s => s.visited);
    return visitedStops.length > 0 ? visitedStops[visitedStops.length - 1] : null;
  }, [stops]);

  const visitedCount = useMemo(() => stops.filter(s => s.visited).length, [stops]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className="text-slate-300 text-lg">Loading Mediterranean Odyssey...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center p-8 bg-slate-800 rounded-lg max-w-md">
          <p className="text-red-400 text-lg mb-4">Error: {error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 px-2 md:px-4 py-2 md:py-3">
        <div className="flex items-center justify-between gap-1 md:gap-2">
          {/* Left side: Hamburger (mobile) + Logo */}
          <div className="flex items-center gap-1 md:gap-2 min-w-0">
            {/* Hamburger menu for mobile */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-slate-700 rounded-lg md:hidden"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? '✕' : '☰'}
            </button>
            <h1 className="text-base md:text-xl font-bold text-white flex items-center gap-1 md:gap-2">
              <span className="text-xl md:text-2xl">🌊</span>
              <span className="hidden sm:inline">Mediterranean Odyssey</span>
              <span className="sm:hidden">Med</span>
            </h1>
            {isUserEdited && (
              <span className="hidden md:inline text-xs px-2 py-1 rounded bg-amber-600">Edited</span>
            )}
          </div>
          {/* Right side: Controls */}
          <div className="flex items-center gap-1 md:gap-4">
            {stats && (
              <div className="hidden lg:flex items-center gap-4 text-sm text-slate-300">
                <span>{stats.totalDays} days</span>
                <span className="text-slate-500">|</span>
                <span title={`${visitedCount} of ${stops.length} stops visited`}>{visitedCount}/{stops.length} visited</span>
                <span className="text-slate-500">|</span>
                <span
                  className={schengenStatus.remaining <= 10 ? 'text-red-400 font-semibold' : schengenStatus.remaining <= 25 ? 'text-amber-400' : 'text-cyan-400'}
                  title={[
                    `${schengenStatus.usedInWindow} Schengen days used in the trailing 180 days (as of today)`,
                    schengenStatus.nextFreeDate ? `Next day frees up ${formatDate(schengenStatus.nextFreeDate)}` : null,
                    schengenStatus.overstayDate ? `⚠ Plan exceeds 90 days around ${formatDate(schengenStatus.overstayDate)}` : 'Plan stays within the 90-day limit',
                  ].filter(Boolean).join(' • ')}
                >
                  🇪🇺 {schengenStatus.usedInWindow}/90 ({schengenStatus.remaining} left)
                </span>
              </div>
            )}
            {/* View Toggle - icons only on mobile */}
            <div className="flex items-center gap-0.5 md:gap-1 bg-slate-700 rounded-lg p-0.5 md:p-1">
              <button
                onClick={() => setActiveView('map')}
                className={`px-1.5 py-1 md:px-2 rounded text-xs font-medium ${activeView === 'map' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
              >
                🗺️<span className="hidden md:inline"> Map</span>
              </button>
              <button
                onClick={() => setActiveView('journal')}
                className={`px-1.5 py-1 md:px-2 rounded text-xs font-medium ${activeView === 'journal' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
              >
                📖<span className="hidden md:inline"> Journal</span>
              </button>
            </div>
            {/* Route edit actions */}
            {isUserEdited && (
              <div className="hidden md:flex items-center gap-1">
                <button onClick={() => exportStopsJson(stops)} className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-xs text-white" title="Download stops.json">
                  💾 Export
                </button>
                <button onClick={handleResetRoute} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300" title="Reset to original">
                  ↩ Reset
                </button>
              </div>
            )}
            {/* Map Style Toggle - hidden on mobile, only show when map is active */}
            {activeView === 'map' && (
              <div className="hidden md:flex items-center gap-1 bg-slate-700 rounded-lg p-1">
                <button
                  onClick={() => setMapStyle('dark')}
                  className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'dark' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
                >
                  🌙
                </button>
                <button
                  onClick={() => setMapStyle('satellite')}
                  className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'satellite' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
                >
                  🛰️
                </button>
                <button
                  onClick={() => setMapStyle('streets')}
                  className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'streets' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
                >
                  🗺️
                </button>
              </div>
            )}
            {/* Sign in / out — unlocks editing notes & photos. Visible at every
                width: this is the only reliable way to sign in on mobile, since
                the per-view prompts (Journal/Notes) only show up when there's
                no content yet, which won't be true once the trip is underway. */}
            {user ? (
              <button
                onClick={() => signOut()}
                className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-700"
                title={`Signed in as ${user.email || user.user_metadata?.name || 'you'} — click to sign out`}
              >
                👤<span className="hidden md:inline"> Sign out</span>
              </button>
            ) : (
              <button
                onClick={() => signInWithProvider('google')}
                className="px-2 py-1 rounded text-xs text-cyan-400 hover:bg-slate-700"
                title="Sign in to add notes & photos"
              >
                👤<span className="hidden md:inline"> Sign in</span>
              </button>
            )}
            {/* Desktop sidebar toggle */}
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden md:block p-2 hover:bg-slate-700 rounded-lg">{sidebarOpen ? '◀' : '▶'}</button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`w-72 md:w-80 bg-slate-800 border-r border-slate-700 flex flex-col fixed md:relative inset-y-0 left-0 z-50 top-14 md:top-0 transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}`}>
            <div className="flex-1 overflow-y-auto p-2">
              <p className="text-xs text-slate-500 px-2 mb-2 pt-2">{stops.length} stops</p>
              {stops.map((stop) => {
                const originalIndex = stops.findIndex(s => s.id === stop.id);
                return (
                <div key={stop.id} className="group">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedStop(stop);
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedStop(stop);
                        if (window.innerWidth < 768) setSidebarOpen(false);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg mb-0.5 cursor-pointer ${selectedStop?.id === stop.id ? 'bg-cyan-600/20 border border-cyan-500' : 'hover:bg-slate-700 border border-transparent'}`}>
                    <div className="flex items-start gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleVisited(stop); }}
                        className={`shrink-0 mt-1 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] transition-colors ${stop.visited ? 'bg-green-600 border-green-500 text-white' : 'border-slate-500 text-transparent hover:border-slate-300'}`}
                        title={stop.visited ? 'Mark as not visited' : 'Mark as visited'}
                      >{'✓'}</button>
                      <span className="text-lg">{stop.type === 'marina' ? '⛵' : '⚓'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${stop.visited ? 'text-slate-300' : 'text-white'}`}>{stop.id}. {stop.name}</p>
                          {stop.duration && <span className="text-[10px] text-slate-500">({stop.duration})</span>}
                          {currentStop?.id === stop.id && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500 text-slate-900 font-semibold">{'📍'} Here</span>}
                          {/* Edit button — always visible; hover-only (opacity-0 until
                              group-hover) meant it never rendered on touch devices,
                              the only way to rename/reposition a stop. */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditStop(stop); }}
                            className="ml-auto p-0.5 hover:bg-slate-600 rounded text-slate-500 hover:text-cyan-400 text-xs transition-opacity"
                            title="Edit stop"
                          >✏️</button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{COUNTRY_FLAGS[stop.country] || ''} {stop.country}</span>
                          {effectiveArrival(stop) && <span className="text-slate-500">•</span>}
                          {effectiveArrival(stop) && <span className="text-amber-400">{formatDate(effectiveArrival(stop))}</span>}
                          {schengenDays.get(stop.id) && (
                            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              schengenDays.get(stop.id)?.isPaused
                                ? 'bg-slate-600 text-slate-300'
                                : schengenDays.get(stop.id)!.rolling > 80
                                  ? 'bg-red-600/80 text-white'
                                  : 'bg-cyan-600/80 text-white'
                            }`}>
                              {schengenDays.get(stop.id)?.isPaused ? '⏸' : '🇪🇺'} {schengenDays.get(stop.id)?.rolling}/90
                            </span>
                          )}
                        </div>
                        {stop.distanceToNext > 0 && (() => {
                          const nextStop = stops.find(s => s.id === stop.id + 1);
                          const distColor = getDistanceColor(stop.distanceToNext);
                          return nextStop ? (
                            <p className="text-[10px] text-slate-500 mt-1">
                              → {nextStop.name} <span style={{ color: distColor }}>{Math.round(stop.distanceToNext)}km</span>
                            </p>
                          ) : null;
                        })()}
                        {stop.cultureHighlight && <p className="text-xs text-cyan-400 mt-1 truncate">{stop.cultureHighlight}</p>}
                      </div>
                    </div>
                  </div>
                  {/* Insert after button — always visible (hover-only meant it never
                      rendered on touch devices, the only way to insert a stop). */}
                  <div className="flex justify-center -my-1 transition-opacity">
                    <button
                      onClick={() => handleAddStop(originalIndex)}
                      className="px-2 py-0 text-[10px] text-slate-500 hover:text-green-400 hover:bg-slate-700/50 rounded"
                      title="Add stop here"
                    >+ add stop</button>
                  </div>
                </div>
                );
              })}
            </div>
          </aside>

        {/* Main Content Area - Map or Journal */}
        {activeView === 'journal' ? (
          <JournalView
            stops={stops}
            currentStop={currentStop}
            focusStop={selectedStop}
            onToggleVisited={handleToggleVisited}
            onLogArrival={handleLogArrival}
            onLogDeparture={handleLogDeparture}
          />
        ) : (
        <main className="flex-1 relative">
          <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} className="h-full w-full" style={{ background: '#0f172a' }}>
            <TileLayer
              key={mapStyle}
              attribution={tileLayerConfig[mapStyle].attribution}
              url={tileLayerConfig[mapStyle].url}
            />
            <MapController selectedStop={selectedStop} />
            <ZoomTracker onZoomChange={handleZoomChange} />
            {stops.map(stop => (
              <Marker
                key={stop.id}
                position={[stop.lat, stop.lon]}
                icon={createMarkerIcon(stop, zoomLevel, currentStop?.id === stop.id)}
                draggable
                eventHandlers={{
                  click: () => setSelectedStop(stop),
                  dragend: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    handleMoveStop(stop, lat, lng);
                  },
                }}
              >
                <Popup className="compact-popup">
                  <div className="text-sm">
                    <span className="font-bold">{stop.name}</span>
                    <span className="text-gray-500 ml-1">{COUNTRY_FLAGS[stop.country] || ''}</span>
                    {currentStop?.id === stop.id && <span className="ml-1">{'📍'}</span>}
                    {stop.cultureHighlight && <div className="text-gray-600 mt-0.5">🏛️ {stop.cultureHighlight}</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {selectedStop && (
            <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-slate-800/95 backdrop-blur border-t border-slate-700 animate-slide-up">
              <div className="p-3 md:p-4">
                {/* Journal entry preview — the first thing shown for whichever stop is
                    selected; click to expand into the full editor. Everything else
                    (dates, links, edit/notes actions) follows below it. */}
                <NotePreviewTile stop={selectedStop} onExpand={() => setNotesModalStop(selectedStop)} />

                {/* Compact single-row layout */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Stop name and country */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg">{selectedStop.type === 'marina' ? '⛵' : '⚓'}</span>
                    <h2 className="text-base md:text-lg font-bold text-white truncate">{selectedStop.name}</h2>
                    <span className="text-slate-400 text-sm">{COUNTRY_FLAGS[selectedStop.country] || ''}</span>
                    {selectedStop.phase && <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: COUNTRY_COLORS[selectedStop.phase] || '#6b7280' }}>{selectedStop.phase}</span>}
                    {currentStop?.id === selectedStop.id && <span className="px-2 py-0.5 rounded text-xs bg-amber-500 text-slate-900 font-semibold">{'📍'} Here now</span>}
                    <button
                      onClick={() => handleToggleVisited(selectedStop)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border ${selectedStop.visited ? 'bg-green-600/80 border-green-500 text-white' : 'border-slate-500 text-slate-400 hover:text-white hover:border-slate-300'}`}
                    >
                      {selectedStop.visited ? '✓ Visited' : 'Mark Visited'}
                    </button>
                  </div>

                  {/* Schedule info - inline */}
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    {selectedStop.arrival && (
                      <span>📅 {formatDate(selectedStop.arrival)}{selectedStop.departure && selectedStop.arrival !== selectedStop.departure && ` → ${formatDate(selectedStop.departure)}`}</span>
                    )}
                    {(selectedStop.actualArrival || selectedStop.actualDeparture) && (
                      <span className="text-amber-300" title="Actual logged dates, may differ from the plan above">
                        {'✍️'} actual: {formatDate(selectedStop.actualArrival || selectedStop.arrival)}
                        {' → '}{formatDate(selectedStop.actualDeparture || selectedStop.departure)}
                      </span>
                    )}
                    {selectedStop.duration && <span>⏱️ {selectedStop.duration}</span>}
                    {selectedStop.distanceToNext > 0 && <span>📍 {selectedStop.distanceToNext}km</span>}
                    {schengenDays.get(selectedStop.id) && (
                      <span className={schengenDays.get(selectedStop.id)?.isPaused ? 'text-slate-400' : schengenDays.get(selectedStop.id)!.rolling > 80 ? 'text-red-400' : 'text-cyan-400'}>
                        🇪🇺 {schengenDays.get(selectedStop.id)?.rolling}/90
                      </span>
                    )}
                  </div>

                  {/* Quick links - inline */}
                  <div className="flex items-center gap-3 text-sm ml-auto">
                    {selectedStop.marinaUrl && <a href={selectedStop.marinaUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">🏠 Marina</a>}
                    {selectedStop.wikiUrl && <a href={selectedStop.wikiUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">📖 Wiki</a>}
                    {selectedStop.foodUrl && <a href={selectedStop.foodUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300">🍽️ Food</a>}
                    {selectedStop.adventureUrl && <a href={selectedStop.adventureUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">🏔️ Do</a>}
                    {selectedStop.provisionsUrl && <a href={selectedStop.provisionsUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">🛒 Shop</a>}
                    <button onClick={() => handleEditStop(selectedStop)} className="text-cyan-400 hover:text-cyan-300" title="Edit name, dates, position">✏️ Edit</button>
                    <button onClick={() => setNotesModalStop(selectedStop)} className="text-emerald-400 hover:text-emerald-300 font-medium" title="Read or add notes & photos for this stop">{'📝'} Notes</button>
                    <button onClick={() => setSelectedStop(null)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">✕</button>
                  </div>
                </div>

                {/* Secondary row for culture highlight and notes */}
                {(selectedStop.cultureHighlight || selectedStop.notes) && (
                  <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-x-4">
                    {selectedStop.cultureHighlight && <span>🏛️ {selectedStop.cultureHighlight}</span>}
                    {selectedStop.notes && <span className="italic text-slate-400">{selectedStop.notes}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legend - hideable on mobile */}
          {legendVisible && (
          <div className="absolute z-[1000] bg-slate-800/90 backdrop-blur rounded-lg p-3 text-sm top-4 right-12 md:right-4">
            <h3 className="font-semibold text-slate-400 mb-2 text-xs uppercase">Route by Country</h3>
            <div className="flex items-center gap-3 mb-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="text-green-400">●</span> Schengen</span>
              <span className="flex items-center gap-1"><span className="text-red-400">●</span> Non-Schengen</span>
            </div>
            {phases.map(phase => (
              <div key={phase.id} className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: phase.color }} />
                <span className="text-white text-xs flex-1">{phase.name}</span>
                <span className={`text-[10px] ${phase.schengen ? 'text-green-400' : 'text-red-400'}`}>
                  {phase.days}d
                </span>
              </div>
            ))}
          </div>
          )}

          {/* Legend toggle button */}
          <button
            onClick={() => setLegendVisible(!legendVisible)}
            className="absolute top-4 right-4 z-[1000] w-8 h-8 bg-slate-800/90 backdrop-blur rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700"
            aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
          >
            {legendVisible ? '✕' : 'ℹ️'}
          </button>

        </main>
        )}
      </div>

      {/* Stop Editor Panel */}
      {(editingStop !== null || insertAfterIndex !== null) && (
        <StopEditor
          stop={editingStop}
          countries={countries}
          onSave={handleSaveStop}
          onDelete={editingStop ? () => {
            const index = stops.findIndex(s => s.id === editingStop.id);
            if (index >= 0) handleDeleteStop(index);
            setEditingStop(null);
          } : undefined}
          onCancel={handleCancelEdit}
        />
      )}

      {notesModalStop && (
        <NotesModal
          stop={notesModalStop}
          isCurrent={currentStop?.id === notesModalStop.id}
          onClose={() => setNotesModalStop(null)}
        />
      )}
    </div>
  );
}

export default App;
