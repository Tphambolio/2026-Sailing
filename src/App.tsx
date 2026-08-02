import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getData, saveUserStops, clearUserStops, exportStopsJson } from './services/dataService';
import { healRoute, computePhases, computeStats, insertStop, removeStop, updateStop } from './services/routeEngine';
import type { Stop, Phase, TripStats, FilterState } from './types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './types';
import { NON_SCHENGEN, COUNTRY_COLORS, COUNTRY_FLAGS } from './data/constants';
import { haversine, kmToNm, formatDate, daysBetween } from './utils/geo';
import { CalendarView } from './components/Calendar';
import RouteEditor from './components/RouteEditor';
import StopEditor from './components/StopEditor';
import TableView from './components/TableView';

// Alias for existing calculateDistance usage
const calculateDistance = haversine;

// Calculate rolling 90/180 Schengen days for each stop
function calculateSchengenDays(stops: Stop[]): Map<number, { days: number; rolling: number; isPaused: boolean }> {
  const schengenMap = new Map<number, { days: number; rolling: number; isPaused: boolean }>();

  // Build a list of all Schengen day ranges (arrival to departure for each Schengen stop)
  const schengenRanges: { start: Date; end: Date }[] = [];

  stops.forEach((stop) => {
    if (!stop.arrival || !stop.departure) return;
    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    if (isSchengen) {
      const [y1, m1, d1] = stop.arrival.split('-').map(Number);
      const [y2, m2, d2] = stop.departure.split('-').map(Number);
      schengenRanges.push({
        start: new Date(y1, m1 - 1, d1),
        end: new Date(y2, m2 - 1, d2),
      });
    }
  });

  // For each stop, calculate rolling 90/180
  stops.forEach((stop) => {
    if (!stop.arrival) {
      schengenMap.set(stop.id, { days: 0, rolling: 0, isPaused: true });
      return;
    }

    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    const stayDays = stop.arrival && stop.departure ? daysBetween(stop.arrival, stop.departure) : 0;

    // Calculate the reference date (end of stay at this stop)
    const [y, m, d] = stop.departure ? stop.departure.split('-').map(Number) : stop.arrival.split('-').map(Number);
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
function createMarkerIcon(stop: Stop, zoom: number): L.DivIcon {
  const isAnchorage = stop.type === 'anchorage';
  const bgColor = isAnchorage ? '#f97316' : '#3b82f6';
  const iconEmoji = isAnchorage ? '⚓' : '⛵';

  // Scale marker size based on zoom (smaller when zoomed out)
  const baseSize = zoom < 7 ? 20 : zoom < 9 ? 26 : 32;
  const fontSize = zoom < 7 ? 10 : zoom < 9 ? 12 : 14;
  const borderWidth = zoom < 7 ? 1 : 2;

  return L.divIcon({
    className: 'custom-marker-container',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${baseSize}px;height:${baseSize}px;border-radius:50%;background:${bgColor};border:${borderWidth}px solid white;color:white;font-size:${fontSize}px;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer">${iconEmoji}</div>`,
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

// Component to handle distance measurement clicks
type MeasurePoint = { lat: number; lon: number };

function MeasureHandler({
  measureMode,
  onAddPoint,
}: {
  measureMode: boolean;
  onAddPoint: (point: MeasurePoint) => void;
}) {
  useMapEvents({
    click(e) {
      if (measureMode) {
        onAddPoint({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    },
  });

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

// Measure point marker icon
function createMeasureIcon(index: number): L.DivIcon {
  return L.divIcon({
    className: 'measure-marker',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#22c55e;border:2px solid white;color:white;font-size:12px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${index + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Get distance color: <50 green, 50-70 yellow, >70 red
function getDistanceColor(km: number): string {
  if (km < 50) return '#22c55e'; // green
  if (km <= 70) return '#eab308'; // yellow
  return '#ef4444'; // red
}

// Distance label icon with arrow - color based on distance
function createDistanceIcon(distance: number, angle: number): L.DivIcon {
  const km = Math.round(distance);
  const color = getDistanceColor(km);
  return L.divIcon({
    className: 'distance-label',
    html: `<div style="display:flex;align-items:center;gap:2px;background:rgba(15,23,42,0.85);padding:2px 6px;border-radius:4px;border:1px solid ${color};white-space:nowrap;">
      <span style="transform:rotate(${angle}deg);color:${color};font-size:10px;">▶</span>
      <span style="color:${color};font-size:11px;font-weight:600;">${km}km</span>
    </div>`,
    iconSize: [60, 20],
    iconAnchor: [30, 10],
  });
}

// Calculate CSS rotation for direction arrow from point 1 to point 2
// Returns degrees for CSS transform: rotate()
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  // This gives navigation bearing: 0°=N, 90°=E, 180°=S, 270°=W
  const navBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  // ▶ points east by default, CSS rotation is clockwise
  // To convert: rotation = bearing - 90
  return (navBearing - 90 + 360) % 360;
}

function App() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUserEdited, setIsUserEdited] = useState(false);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    countries: [],
    types: [],
    phases: [],
    seasons: [],
    searchQuery: '',
  });
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_MAP_ZOOM);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('satellite');
  const [activeView, setActiveView] = useState<'map' | 'calendar' | 'table'>('map');
  const [routeEditMode, setRouteEditMode] = useState(false);
  const [pendingWaypoints, setPendingWaypoints] = useState<Map<number, [number, number][]>>(new Map());
  // Stop editing state
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | null>(null);
  const [addStopMode, setAddStopMode] = useState(false);
  const [pendingLatLon, setPendingLatLon] = useState<{ lat: number; lon: number } | null>(null);

  const tileLayerConfig = {
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO' },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
    streets: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap' }
  };

  const handleZoomChange = useCallback((zoom: number) => {
    setZoomLevel(zoom);
  }, []);

  const handleAddMeasurePoint = useCallback((point: MeasurePoint) => {
    setMeasurePoints(prev => [...prev, point]);
  }, []);

  const clearMeasure = useCallback(() => {
    setMeasurePoints([]);
  }, []);

  const toggleMeasureMode = useCallback(() => {
    setMeasureMode(prev => {
      if (prev) {
        setMeasurePoints([]);
      }
      return !prev;
    });
  }, []);

  // Route editing handlers
  const handleSaveWaypoints = useCallback((stopId: number, waypoints: [number, number][]) => {
    // Update pending waypoints
    setPendingWaypoints(prev => {
      const updated = new Map(prev);
      if (waypoints.length > 0) {
        updated.set(stopId, waypoints);
      } else {
        updated.delete(stopId);
      }
      return updated;
    });

    // Also update the stops state for immediate visual feedback
    setStops(prev => prev.map(stop =>
      stop.id === stopId
        ? { ...stop, routeWaypoints: waypoints.length > 0 ? waypoints : undefined }
        : stop
    ));

    console.log(`Saved waypoints for stop ${stopId}:`, waypoints);
  }, []);

  const exportWaypoints = useCallback(() => {
    // Build an object of all modified waypoints
    const waypointData: Record<number, [number, number][]> = {};
    stops.forEach(stop => {
      if (stop.routeWaypoints && stop.routeWaypoints.length > 0) {
        waypointData[stop.id] = stop.routeWaypoints;
      }
    });

    const json = JSON.stringify(waypointData, null, 2);
    console.log('=== WAYPOINTS DATA ===');
    console.log(json);
    console.log('=== END WAYPOINTS ===');

    // Also copy to clipboard
    navigator.clipboard.writeText(json).then(() => {
      alert('Waypoints copied to clipboard! Check console for full data.');
    }).catch(() => {
      alert('Check console for waypoint data.');
    });
  }, [stops]);

  const totalMeasureDistance = measurePoints.length >= 2
    ? measurePoints.reduce((total, point, i) => {
        if (i === 0) return 0;
        return total + calculateDistance(
          measurePoints[i - 1].lat, measurePoints[i - 1].lon,
          point.lat, point.lon
        );
      }, 0)
    : 0;

  useEffect(() => {
    try {
      setLoading(true);
      const result = getData();
      setStops(result.stops);
      setPhases(result.phases);
      setStats(result.stats);
      setIsUserEdited(result.isUserEdited);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Apply route changes: heal, recompute, persist
  const applyRouteChange = useCallback((newStops: Stop[]) => {
    const healed = healRoute(newStops);
    setStops(healed);
    setPhases(computePhases(healed));
    setStats(computeStats(healed));
    saveUserStops(healed);
    setIsUserEdited(true);
  }, []);

  // Stop editor handlers
  const handleAddStop = useCallback((afterIndex: number) => {
    setInsertAfterIndex(afterIndex);
    setEditingStop(null);
    setPendingLatLon(null);
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
    setPendingLatLon(null);
    setAddStopMode(false);
  }, [stops, editingStop, insertAfterIndex, applyRouteChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingStop(null);
    setInsertAfterIndex(null);
    setPendingLatLon(null);
    setAddStopMode(false);
  }, []);

  const handleResetRoute = useCallback(() => {
    clearUserStops();
    const result = getData();
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

  const filteredStops = stops.filter(stop => {
    if (filters.countries.length && !filters.countries.includes(stop.country)) return false;
    if (filters.types.length && !filters.types.includes(stop.type)) return false;
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      return stop.name.toLowerCase().includes(query) || stop.country.toLowerCase().includes(query);
    }
    return true;
  });

  const countries = [...new Set(stops.map(s => s.country))];

  // Calculate Schengen days for each stop
  const schengenDays = useMemo(() => calculateSchengenDays(stops), [stops]);

  // Draw route lines sequentially, colored by each segment's starting stop's country
  // Uses routeWaypoints when available to avoid crossing land
  const routeSegments = useMemo(() => {
    const segments: { positions: [number, number][]; color: string }[] = [];
    for (let i = 0; i < filteredStops.length - 1; i++) {
      const currentStop = filteredStops[i];
      const nextStop = filteredStops[i + 1];
      // Get color from the current stop's phase (country)
      const phase = phases.find(p => p.name === currentStop.phase);
      // Build positions array: start -> waypoints (if any) -> end
      const positions: [number, number][] = [
        [currentStop.lat, currentStop.lon],
        ...(currentStop.routeWaypoints || []),
        [nextStop.lat, nextStop.lon],
      ];
      segments.push({
        positions,
        color: phase?.color || '#6b7280',
      });
    }
    return segments;
  }, [filteredStops, phases]);

  // Create distance labels with arrows at midpoints between ALL consecutive stops
  const distanceLabels = stops.slice(0, -1).map((stop, i) => {
    const nextStop = stops[i + 1];
    const midLat = (stop.lat + nextStop.lat) / 2;
    const midLon = (stop.lon + nextStop.lon) / 2;
    const bearing = calculateBearing(stop.lat, stop.lon, nextStop.lat, nextStop.lon);
    const distance = calculateDistance(stop.lat, stop.lon, nextStop.lat, nextStop.lon);
    return {
      position: [midLat, midLon] as [number, number],
      angle: bearing,
      distance,
    };
  });

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
            <input
              type="text"
              placeholder="Search..."
              value={filters.searchQuery}
              onChange={(e) => setFilters(f => ({ ...f, searchQuery: e.target.value }))}
              className="hidden md:block bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 w-64"
            />
            {stats && (
              <div className="hidden lg:flex items-center gap-4 text-sm text-slate-300">
                <span>{stats.totalDays} days</span>
                <span className="text-slate-500">|</span>
                <span>{stops.length} stops</span>
                <span className="text-slate-500">|</span>
                <span className="text-cyan-400">{stats.totalSchengenDays} Schengen</span>
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
                onClick={() => setActiveView('calendar')}
                className={`px-1.5 py-1 md:px-2 rounded text-xs font-medium ${activeView === 'calendar' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
              >
                📅<span className="hidden md:inline"> Calendar</span>
              </button>
              <button
                onClick={() => setActiveView('table')}
                className={`px-1.5 py-1 md:px-2 rounded text-xs font-medium ${activeView === 'table' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
              >
                📊<span className="hidden md:inline"> Table</span>
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
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-sm font-semibold text-slate-400 uppercase mb-3">Filters</h2>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setFilters(f => ({ ...f, types: f.types.includes('marina') ? f.types.filter(t => t !== 'marina') : [...f.types, 'marina'] }))}
                  className={`flex-1 px-3 py-1 rounded text-sm ${filters.types.includes('marina') ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>⛵ Marinas</button>
                <button onClick={() => setFilters(f => ({ ...f, types: f.types.includes('anchorage') ? f.types.filter(t => t !== 'anchorage') : [...f.types, 'anchorage'] }))}
                  className={`flex-1 px-3 py-1 rounded text-sm ${filters.types.includes('anchorage') ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'}`}>⚓ Anchorages</button>
              </div>
              <select value={filters.countries[0] || ''} onChange={(e) => setFilters(f => ({ ...f, countries: e.target.value ? [e.target.value] : [] }))}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white">
                <option value="">All countries</option>
                {countries.map(c => <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>)}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <p className="text-xs text-slate-500 px-2 mb-2">{filteredStops.length} of {stops.length} stops</p>
              {filteredStops.map((stop) => {
                const originalIndex = stops.findIndex(s => s.id === stop.id);
                return (
                <div key={stop.id} className="group">
                  <button onClick={() => {
                    setSelectedStop(stop);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                    className={`w-full text-left p-3 rounded-lg mb-0.5 ${selectedStop?.id === stop.id ? 'bg-cyan-600/20 border border-cyan-500' : 'hover:bg-slate-700 border border-transparent'}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg">{stop.type === 'marina' ? '⛵' : '⚓'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-white truncate">{stop.id}. {stop.name}</p>
                          {stop.duration && <span className="text-[10px] text-slate-500">({stop.duration})</span>}
                          {/* Edit button - appears on hover */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditStop(stop); }}
                            className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-600 rounded text-slate-500 hover:text-cyan-400 text-xs transition-opacity"
                            title="Edit stop"
                          >✏️</button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{COUNTRY_FLAGS[stop.country] || ''} {stop.country}</span>
                          {stop.arrival && <span className="text-slate-500">•</span>}
                          {stop.arrival && <span className="text-amber-400">{formatDate(stop.arrival)}</span>}
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
                  </button>
                  {/* Insert after button - appears on hover between stops */}
                  <div className="flex justify-center -my-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

        {/* Main Content Area - Map, Calendar, or Table */}
        {activeView === 'table' ? (
          <TableView
            stops={stops}
            selectedStop={selectedStop}
            schengenDays={schengenDays}
            onStopSelect={setSelectedStop}
            onEditStop={handleEditStop}
            onDeleteStop={handleDeleteStop}
            onInsertAfter={handleAddStop}
          />
        ) : activeView === 'calendar' ? (
          <CalendarView
            stops={stops}
            phases={phases}
            selectedStop={selectedStop}
            onStopSelect={(stop) => {
              setSelectedStop(stop);
              if (stop) {
                // Switch to map view and fly to location
                setActiveView('map');
              }
            }}
          />
        ) : (
        <main className="flex-1 relative">
          <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} className={`h-full w-full ${measureMode ? 'cursor-crosshair' : ''}`} style={{ background: '#0f172a' }}>
            <TileLayer
              key={mapStyle}
              attribution={tileLayerConfig[mapStyle].attribution}
              url={tileLayerConfig[mapStyle].url}
            />
            <MapController selectedStop={selectedStop} />
            <ZoomTracker onZoomChange={handleZoomChange} />
            <MeasureHandler measureMode={measureMode || addStopMode} onAddPoint={addStopMode ? (point) => {
              setPendingLatLon(point);
              if (insertAfterIndex === null) setInsertAfterIndex(stops.length - 1);
              setAddStopMode(false);
            } : handleAddMeasurePoint} />
            {/* Route segments - drawn sequentially, colored by country */}
            {routeSegments.map((segment, i) => (
              <Polyline
                key={`route-${i}`}
                positions={segment.positions}
                pathOptions={{ color: segment.color, weight: 3, opacity: 0.7 }}
              />
            ))}
            {/* Distance labels with arrows - only show when zoomed in */}
            {zoomLevel >= 8 && distanceLabels.map((label, i) => (
              <Marker
                key={`distance-${i}`}
                position={label.position}
                icon={createDistanceIcon(label.distance, label.angle)}
                interactive={false}
              />
            ))}
            {filteredStops.map(stop => (
              <Marker key={stop.id} position={[stop.lat, stop.lon]} icon={createMarkerIcon(stop, zoomLevel)} eventHandlers={{ click: () => !measureMode && setSelectedStop(stop) }}>
                <Popup className="compact-popup">
                  <div className="text-sm">
                    <span className="font-bold">{stop.name}</span>
                    <span className="text-gray-500 ml-1">{COUNTRY_FLAGS[stop.country] || ''}</span>
                    {stop.cultureHighlight && <div className="text-gray-600 mt-0.5">🏛️ {stop.cultureHighlight}</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
            {measurePoints.length >= 2 && (
              <Polyline positions={measurePoints.map(p => [p.lat, p.lon] as [number, number])} pathOptions={{ color: '#22c55e', weight: 3, dashArray: '10, 10' }} />
            )}
            {measurePoints.map((point, i) => (
              <Marker key={`measure-${i}`} position={[point.lat, point.lon]} icon={createMeasureIcon(i)} />
            ))}
            {/* Route Editor */}
            <RouteEditor
              stops={filteredStops}
              isEditing={routeEditMode}
              onSaveWaypoints={handleSaveWaypoints}
            />
          </MapContainer>

          {selectedStop && (
            <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-slate-800/95 backdrop-blur border-t border-slate-700 animate-slide-up">
              <div className="p-3 md:p-4">
                {/* Compact single-row layout */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Stop name and country */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg">{selectedStop.type === 'marina' ? '⛵' : '⚓'}</span>
                    <h2 className="text-base md:text-lg font-bold text-white truncate">{selectedStop.name}</h2>
                    <span className="text-slate-400 text-sm">{COUNTRY_FLAGS[selectedStop.country] || ''}</span>
                    {selectedStop.phase && <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: COUNTRY_COLORS[selectedStop.phase] || '#6b7280' }}>{selectedStop.phase}</span>}
                  </div>

                  {/* Schedule info - inline */}
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    {selectedStop.arrival && (
                      <span>📅 {formatDate(selectedStop.arrival)}{selectedStop.departure && selectedStop.arrival !== selectedStop.departure && ` → ${formatDate(selectedStop.departure)}`}</span>
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

          <div className="absolute top-20 left-4 z-[1000] flex flex-col gap-2">
            <button
              onClick={() => {
                setAddStopMode(!addStopMode);
                setMeasureMode(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                addStopMode
                  ? 'bg-green-600 text-white'
                  : 'bg-slate-800/90 backdrop-blur text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>📌</span>
              {addStopMode ? 'Click map...' : 'Add Stop'}
            </button>

            <button
              onClick={toggleMeasureMode}
              disabled={routeEditMode}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                measureMode
                  ? 'bg-green-600 text-white'
                  : routeEditMode
                    ? 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-800/90 backdrop-blur text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>📏</span>
              {measureMode ? 'Measuring...' : 'Measure Distance'}
            </button>

            <button
              onClick={() => {
                if (routeEditMode) {
                  // When exiting, offer to export
                  if (pendingWaypoints.size > 0) {
                    exportWaypoints();
                  }
                }
                setRouteEditMode(!routeEditMode);
                setMeasureMode(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                routeEditMode
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800/90 backdrop-blur text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>✏️</span>
              {routeEditMode ? 'Exit Edit Mode' : 'Edit Routes'}
            </button>

            {routeEditMode && (
              <button
                onClick={exportWaypoints}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-500"
              >
                <span>💾</span>
                Export Waypoints
              </button>
            )}

            {measureMode && (
              <div className="bg-slate-800/90 backdrop-blur rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-2">Click on the map to add points</p>
                {measurePoints.length >= 2 && (
                  <div className="text-white">
                    <p className="text-lg font-bold text-green-400">
                      {totalMeasureDistance.toFixed(1)} km
                    </p>
                    <p className="text-sm text-slate-300">
                      {kmToNm(totalMeasureDistance).toFixed(1)} nm
                    </p>
                  </div>
                )}
                {measurePoints.length > 0 && (
                  <button
                    onClick={clearMeasure}
                    className="mt-2 text-xs text-red-400 hover:text-red-300"
                  >
                    Clear points
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
        )}
      </div>

      {/* Stop Editor Panel */}
      {(editingStop !== null || insertAfterIndex !== null) && (
        <StopEditor
          stop={editingStop || (pendingLatLon ? { lat: pendingLatLon.lat, lon: pendingLatLon.lon } : null)}
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
    </div>
  );
}

export default App;
