import { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getData } from './services/dataService';
import type { Stop, Phase, TripStats, FilterState } from './types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, PHASE_COLORS, COUNTRY_FLAGS } from './types';

// Haversine formula to calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Convert km to nautical miles
function kmToNm(km: number): number {
  return km * 0.539957;
}

// Format date string without timezone conversion (YYYY-MM-DD → "15 Jul")
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

function formatDateLong(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${DAYS[date.getDay()]}, ${day} ${MONTHS[month - 1]} ${year}`;
}

// Calculate days between two date strings
function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);
  return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

// Non-Schengen countries (Schengen counter pauses here)
const NON_SCHENGEN = ['Montenegro', 'Albania', 'Turkey', 'Cyprus', 'Northern Cyprus', 'Cyprus (UK base)'];

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

  useEffect(() => {
    if (selectedStop) {
      map.flyTo([selectedStop.lat, selectedStop.lon], 10, { duration: 1 });
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
  const [dataSource, setDataSource] = useState<'live' | 'cache' | 'fallback'>('fallback');
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('dark');

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
    async function loadData() {
      try {
        setLoading(true);
        const { stops, phases, stats, source } = await getData();
        setStops(stops);
        setPhases(phases);
        setStats(stats);
        setDataSource(source);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
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
  const routeSegments = useMemo(() => {
    const segments: { from: [number, number]; to: [number, number]; color: string }[] = [];
    for (let i = 0; i < filteredStops.length - 1; i++) {
      const currentStop = filteredStops[i];
      const nextStop = filteredStops[i + 1];
      // Get color from the current stop's phase (country)
      const phase = phases.find(p => p.name === currentStop.phase);
      segments.push({
        from: [currentStop.lat, currentStop.lon],
        to: [nextStop.lat, nextStop.lon],
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
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-2xl">🌊</span>Mediterranean Odyssey
          </h1>
          <span className={`text-xs px-2 py-1 rounded ${dataSource === 'live' ? 'bg-green-600' : dataSource === 'cache' ? 'bg-yellow-600' : 'bg-slate-600'}`}>
            {dataSource === 'live' ? 'Live' : dataSource === 'cache' ? 'Cached' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search stops..."
            value={filters.searchQuery}
            onChange={(e) => setFilters(f => ({ ...f, searchQuery: e.target.value }))}
            className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 w-64"
          />
          {stats && (
            <div className="hidden md:flex items-center gap-4 text-sm text-slate-300">
              <span>{stats.totalDays} days</span>
              <span className="text-slate-500">|</span>
              <span>{stops.length} stops</span>
              <span className="text-slate-500">|</span>
              <span className="text-cyan-400">{stats.totalSchengenDays} Schengen</span>
            </div>
          )}
          <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
            <button
              onClick={() => setMapStyle('dark')}
              className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'dark' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
            >
              Dark
            </button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'satellite' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
            >
              Satellite
            </button>
            <button
              onClick={() => setMapStyle('streets')}
              className={`px-2 py-1 rounded text-xs font-medium ${mapStyle === 'streets' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}
            >
              Streets
            </button>
          </div>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-slate-700 rounded-lg">{sidebarOpen ? '◀' : '▶'}</button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && (
          <aside className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
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
              {filteredStops.map(stop => (
                <button key={stop.id} onClick={() => setSelectedStop(stop)}
                  className={`w-full text-left p-3 rounded-lg mb-1 ${selectedStop?.id === stop.id ? 'bg-cyan-600/20 border border-cyan-500' : 'hover:bg-slate-700 border border-transparent'}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-lg">{stop.type === 'marina' ? '⛵' : '⚓'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white truncate">{stop.id}. {stop.name}</p>
                        {stop.duration && <span className="text-[10px] text-slate-500">({stop.duration})</span>}
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
              ))}
            </div>
          </aside>
        )}

        <main className="flex-1 relative">
          <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} className={`h-full w-full ${measureMode ? 'cursor-crosshair' : ''}`} style={{ background: '#0f172a' }}>
            <TileLayer
              key={mapStyle}
              attribution={tileLayerConfig[mapStyle].attribution}
              url={tileLayerConfig[mapStyle].url}
            />
            <MapController selectedStop={selectedStop} />
            <ZoomTracker onZoomChange={handleZoomChange} />
            <MeasureHandler measureMode={measureMode} onAddPoint={handleAddMeasurePoint} />
            {/* Route segments - drawn sequentially, colored by country */}
            {routeSegments.map((segment, i) => (
              <Polyline
                key={`route-${i}`}
                positions={[segment.from, segment.to]}
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
                <Popup>
                  <div className="min-w-[200px]">
                    <h3 className="font-bold text-lg">{stop.name}</h3>
                    <p className="text-sm text-gray-600">{COUNTRY_FLAGS[stop.country] || ''} {stop.country}</p>
                    {stop.cultureHighlight && <p className="text-sm mt-2">🏛️ {stop.cultureHighlight}</p>}
                    {stop.notes && <p className="text-sm text-gray-500 mt-2 italic">{stop.notes}</p>}
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
          </MapContainer>

          {selectedStop && (
            <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-slate-800 border-t border-slate-700 p-4 animate-slide-up">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedStop.type === 'marina' ? '⛵' : '⚓'} {selectedStop.name}</h2>
                  <p className="text-slate-400">{COUNTRY_FLAGS[selectedStop.country] || ''} {selectedStop.country}
                    {selectedStop.phase && <span className="ml-2 px-2 py-0.5 rounded text-xs" style={{ backgroundColor: PHASE_COLORS[selectedStop.phase] || '#6b7280' }}>{selectedStop.phase}</span>}
                  </p>
                </div>
                <button onClick={() => setSelectedStop(null)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase mb-2">Schedule</h3>
                  {selectedStop.arrival && (
                    <p className="text-sm text-white mb-1">
                      📅 {formatDateLong(selectedStop.arrival)}
                      {selectedStop.departure && selectedStop.arrival !== selectedStop.departure && (
                        <span className="text-slate-400"> → {formatDate(selectedStop.departure)}</span>
                      )}
                    </p>
                  )}
                  {selectedStop.duration && <p className="text-sm text-white mb-1">⏱️ {selectedStop.duration}</p>}
                  {selectedStop.distanceToNext > 0 && <p className="text-sm text-white mb-1">📍 {selectedStop.distanceToNext} km to next</p>}
                  {schengenDays.get(selectedStop.id) && (
                    <p className={`text-sm mt-2 ${
                      schengenDays.get(selectedStop.id)?.isPaused
                        ? 'text-slate-400'
                        : schengenDays.get(selectedStop.id)!.rolling > 80
                          ? 'text-red-400'
                          : 'text-cyan-400'
                    }`}>
                      {schengenDays.get(selectedStop.id)?.isPaused ? (
                        <>⏸ Schengen paused ({schengenDays.get(selectedStop.id)?.rolling}/90 in window)</>
                      ) : (
                        <>🇪🇺 Rolling 90/180: {schengenDays.get(selectedStop.id)?.rolling}/90 days</>
                      )}
                    </p>
                  )}
                  {selectedStop.notes && <p className="text-sm text-slate-300 mt-2 italic">{selectedStop.notes}</p>}
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase mb-2">Marina</h3>
                  {selectedStop.marinaName && <p className="text-sm text-white mb-1">{selectedStop.marinaName}</p>}
                  {selectedStop.marinaUrl && <a href={selectedStop.marinaUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-cyan-400 hover:text-cyan-300">Visit website ↗</a>}
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase mb-2">Culture & Explore</h3>
                  {selectedStop.cultureHighlight && <p className="text-sm text-white mb-2">🏛️ {selectedStop.cultureHighlight}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {selectedStop.wikiUrl && (
                      <a href={selectedStop.wikiUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-cyan-400 hover:text-cyan-300">
                        📖 Wikipedia ↗
                      </a>
                    )}
                    {selectedStop.foodUrl && (
                      <a href={selectedStop.foodUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-amber-400 hover:text-amber-300">
                        🍽️ Dining ↗
                      </a>
                    )}
                    {selectedStop.adventureUrl && (
                      <a href={selectedStop.adventureUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-green-400 hover:text-green-300">
                        🏔️ Adventure ↗
                      </a>
                    )}
                    {selectedStop.provisionsUrl && (
                      <a href={selectedStop.provisionsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-purple-400 hover:text-purple-300">
                        🛒 Provisions ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="absolute top-4 right-4 z-[1000] bg-slate-800/90 backdrop-blur rounded-lg p-3 text-sm">
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

          <div className="absolute top-20 left-4 z-[1000] flex flex-col gap-2">
            <button
              onClick={toggleMeasureMode}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                measureMode
                  ? 'bg-green-600 text-white'
                  : 'bg-slate-800/90 backdrop-blur text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>📏</span>
              {measureMode ? 'Measuring...' : 'Measure Distance'}
            </button>

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
      </div>
    </div>
  );
}

export default App;
