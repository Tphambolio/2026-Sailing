import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Info, Moon, Satellite, Map as MapIcon, Sailboat, Anchor, CalendarDays, PenLine, Clock, Ruler, BookOpen, UtensilsCrossed, Mountain, ShoppingBasket, Pencil, Landmark } from 'lucide-react';
import type { Stop, Phase } from '../types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../types';
import { COUNTRY_COLORS, COUNTRY_FLAGS } from '../data/constants';
import { formatDate } from '../utils/geo';
import { effectiveArrival, formatStay, currentStopLabel, sailedTrack } from '../services/routeEngine';
import NotePreviewTile from './NotePreviewTile';

// Split out of App.tsx and lazy-loaded: Leaflet is one of the largest
// dependencies, and most visitors only ever read the journal.

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
  // Bottom-right status badge: a green check once visited, or a question mark
  // beforehand — signals "planned, not yet happened" rather than reading as
  // an empty/broken marker.
  const badgeSize = Math.round(baseSize * 0.5);
  const badgeFontSize = Math.max(7, fontSize - 4);
  const checkBadge = stop.visited
    ? `<div style="position:absolute;bottom:-2px;right:-2px;width:${badgeSize}px;height:${badgeSize}px;border-radius:50%;background:#22c55e;border:1px solid white;display:flex;align-items:center;justify-content:center;font-size:${badgeFontSize}px;color:white;">✓</div>`
    : `<div style="position:absolute;bottom:-2px;right:-2px;width:${badgeSize}px;height:${badgeSize}px;border-radius:50%;background:#64748b;border:1px solid white;display:flex;align-items:center;justify-content:center;font-size:${badgeFontSize}px;color:white;">?</div>`;
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
// On first open (nothing selected), frame the trip so far instead of a fixed
// zoomed-in default view.
function FitToTrack({ track, skip }: { track: [number, number][]; skip: boolean }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || skip || track.length < 2) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(track), { padding: [40, 40] });
  }, [map, track, skip]);
  return null;
}

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

const TILE_LAYERS = {
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
  streets: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap' },
} as const;

export interface MapViewProps {
  stops: Stop[];
  phases: Phase[];
  selectedStop: Stop | null;
  onSelectStop: (stop: Stop | null) => void;
  currentStop: Stop | null;
  isEditor: boolean;
  schengenDays: Map<number, { days: number; rolling: number; isPaused: boolean }>;
  onToggleVisited: (stop: Stop) => void;
  onEditStop: (stop: Stop) => void;
  onOpenNotes: (stop: Stop) => void;
  onMoveStop: (stop: Stop, lat: number, lon: number) => void;
}

export default function MapView({
  stops, phases, selectedStop, onSelectStop, currentStop, isEditor, schengenDays,
  onToggleVisited, onEditStop, onOpenNotes, onMoveStop,
}: MapViewProps) {
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_MAP_ZOOM);
  const [mapStyle, setMapStyle] = useState<keyof typeof TILE_LAYERS>('satellite');
  const [legendVisible, setLegendVisible] = useState(() => window.innerWidth >= 768);
  const tileLayerConfig = TILE_LAYERS;
  const track = useMemo(() => sailedTrack(stops), [stops]);

  return (
    <main className="flex-1 relative">
      <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} className="h-full w-full" style={{ background: '#0f172a' }}>
        <TileLayer
          key={mapStyle}
          attribution={tileLayerConfig[mapStyle].attribution}
          url={tileLayerConfig[mapStyle].url}
        />
        <MapController selectedStop={selectedStop} />
        <FitToTrack track={track} skip={!!selectedStop} />
        {track.length > 1 && (
          <>
            {/* soft halo so the line reads on satellite imagery */}
            <Polyline positions={track} pathOptions={{ color: '#07111b', weight: 6, opacity: 0.45 }} interactive={false} />
            <Polyline positions={track} pathOptions={{ color: '#ff9a6b', weight: 3, opacity: 0.95 }} interactive={false} />
          </>
        )}
        <ZoomTracker onZoomChange={setZoomLevel} />
        {stops.map(stop => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lon]}
            icon={createMarkerIcon(stop, zoomLevel, currentStop?.id === stop.id)}
            draggable={isEditor}
            eventHandlers={{
              click: () => onSelectStop(stop),
              ...(isEditor && {
                dragend: (e) => {
                  const { lat, lng } = e.target.getLatLng();
                  onMoveStop(stop, lat, lng);
                },
              }),
            }}
          >
            <Popup className="compact-popup">
              <div className="text-sm">
                <span className="font-bold">{stop.name}</span>
                <span className="text-gray-500 ml-1">{COUNTRY_FLAGS[stop.country] || ''}</span>
                {currentStop?.id === stop.id && <span className="ml-1 text-xs text-gray-500">· {currentStopLabel(stop)}</span>}
                {stop.cultureHighlight && <div className="text-gray-600 mt-0.5">{stop.cultureHighlight}</div>}
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
            <NotePreviewTile stop={selectedStop} onExpand={() => onOpenNotes(selectedStop)} />

            {/* Compact single-row layout */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* Stop name and country */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-cyan-400" title={selectedStop.type === 'marina' ? 'Marina' : 'Anchorage'}>{selectedStop.type === 'marina' ? <Sailboat size={20} aria-hidden /> : <Anchor size={20} aria-hidden />}</span>
                <h2 className="text-base md:text-lg font-bold text-white truncate">{selectedStop.name}</h2>
                <span className="text-slate-400 text-sm">{COUNTRY_FLAGS[selectedStop.country] || ''}</span>
                {selectedStop.phase && <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: COUNTRY_COLORS[selectedStop.phase] || '#6b7280' }}>{selectedStop.phase}</span>}
                {currentStop?.id === selectedStop.id && <span className="px-2 py-0.5 rounded text-xs bg-coral-400 text-slate-950 font-semibold">{currentStopLabel(selectedStop)}</span>}
                {isEditor ? (
                  <button
                    onClick={() => onToggleVisited(selectedStop)}
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${selectedStop.visited ? 'bg-green-600/80 border-green-500 text-white' : 'border-slate-500 text-slate-400 hover:text-white hover:border-slate-300'}`}
                  >
                    {selectedStop.visited ? '✓ Visited' : 'Mark Visited'}
                  </button>
                ) : selectedStop.visited && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium border bg-green-600/80 border-green-500 text-white">✓ Visited</span>
                )}
              </div>

              {/* Schedule info - inline */}
              <div className="flex items-center gap-3 text-sm text-slate-300">
                {/* Readers see the real dates only; editors also see the plan vs. actual split */}
                {!isEditor && effectiveArrival(selectedStop) && (
                  <span className="inline-flex items-center gap-1"><CalendarDays size={15} aria-hidden /> {formatStay(selectedStop, currentStop?.id === selectedStop.id, formatDate)}</span>
                )}
                {isEditor && selectedStop.arrival && (
                  <span className="inline-flex items-center gap-1"><CalendarDays size={15} aria-hidden /> {formatDate(selectedStop.arrival)}{selectedStop.departure && selectedStop.arrival !== selectedStop.departure && ` → ${formatDate(selectedStop.departure)}`}</span>
                )}
                {isEditor && (selectedStop.actualArrival || selectedStop.actualDeparture) && (
                  <span className="text-amber-300" title="Actual logged dates, may differ from the plan above">
                    <PenLine size={14} aria-hidden className="inline" /> actual: {formatDate(selectedStop.actualArrival || selectedStop.arrival)}
                    {' → '}{formatDate(selectedStop.actualDeparture || selectedStop.departure)}
                  </span>
                )}
                {isEditor && selectedStop.duration && <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden /> {selectedStop.duration}</span>}
                {isEditor && selectedStop.distanceToNext > 0 && <span className="inline-flex items-center gap-1"><Ruler size={14} aria-hidden /> {selectedStop.distanceToNext}km</span>}
                {isEditor && schengenDays.get(selectedStop.id) && (
                  <span className={schengenDays.get(selectedStop.id)?.isPaused ? 'text-slate-400' : schengenDays.get(selectedStop.id)!.rolling > 80 ? 'text-red-400' : 'text-cyan-400'}>
                    🇪🇺 {schengenDays.get(selectedStop.id)?.rolling}/90
                  </span>
                )}
              </div>

              {/* Quick links - inline */}
              <div className="flex items-center gap-3 text-sm ml-auto">
                {selectedStop.marinaUrl && <a href={selectedStop.marinaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><Anchor size={14} aria-hidden /> Marina</a>}
                {selectedStop.wikiUrl && <a href={selectedStop.wikiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><BookOpen size={14} aria-hidden /> Wiki</a>}
                {selectedStop.foodUrl && <a href={selectedStop.foodUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><UtensilsCrossed size={14} aria-hidden /> Food</a>}
                {selectedStop.adventureUrl && <a href={selectedStop.adventureUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><Mountain size={14} aria-hidden /> Do</a>}
                {selectedStop.provisionsUrl && <a href={selectedStop.provisionsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><ShoppingBasket size={14} aria-hidden /> Shop</a>}
                {isEditor && <button onClick={() => onEditStop(selectedStop)} className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200" title="Edit name, dates, position"><Pencil size={14} aria-hidden /> Edit</button>}
                <button onClick={() => onOpenNotes(selectedStop)} className="inline-flex items-center gap-1 text-coral-300 hover:text-coral-400 font-semibold" title="Read the journal entry for this stop"><BookOpen size={15} aria-hidden /> Read</button>
                <button onClick={() => onSelectStop(null)} className="w-10 h-10 -my-2 flex items-center justify-center hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white" aria-label="Close stop details"><X size={20} aria-hidden /></button>
              </div>
            </div>

            {/* Secondary row for culture highlight and notes */}
            {/* stop.notes are planning notes ("Verified via OpenStreetMap", anchorage tips) — editors only */}
            {(selectedStop.cultureHighlight || (isEditor && selectedStop.notes)) && (
              <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-x-4">
                {selectedStop.cultureHighlight && <span className="inline-flex items-center gap-1"><Landmark size={14} aria-hidden className="text-cyan-300" /> {selectedStop.cultureHighlight}</span>}
                {isEditor && selectedStop.notes && <span className="italic text-slate-400">{selectedStop.notes}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend - hideable on mobile */}
      {legendVisible && (
      <div className="absolute z-[1000] bg-slate-800/90 backdrop-blur rounded-lg p-3 text-sm top-16 right-4">
        <h3 className="font-semibold text-slate-400 mb-2 text-xs uppercase">Route by Country</h3>
        {isEditor && (
          <div className="flex items-center gap-3 mb-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="text-green-400">●</span> Schengen</span>
            <span className="flex items-center gap-1"><span className="text-red-400">●</span> Non-Schengen</span>
          </div>
        )}
        {phases.map(phase => (
          <div key={phase.id} className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: phase.color }} />
            <span className="text-white text-xs flex-1">{phase.name}</span>
            <span className={`text-[10px] ${!isEditor ? 'text-slate-400' : phase.schengen ? 'text-green-400' : 'text-red-400'}`}>
              {phase.days}d
            </span>
          </div>
        ))}
      </div>
      )}

      {/* Basemap style */}
      <div className="absolute top-4 right-16 z-[1000] flex items-center gap-1 bg-slate-800/90 backdrop-blur rounded-lg p-1" role="group" aria-label="Map style">
        {([['dark', Moon, 'Dark map'], ['satellite', Satellite, 'Satellite'], ['streets', MapIcon, 'Street map']] as const).map(([style, Icon, label]) => (
          <button
            key={style}
            onClick={() => setMapStyle(style)}
            aria-label={label}
            aria-pressed={mapStyle === style}
            className={`w-8 h-8 flex items-center justify-center rounded-md ${mapStyle === style ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
          >
            <Icon size={16} aria-hidden />
          </button>
        ))}
      </div>

      {/* Legend toggle button */}
      <button
        onClick={() => setLegendVisible(!legendVisible)}
        className="absolute top-4 right-4 z-[1000] w-10 h-10 bg-slate-800/90 backdrop-blur rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700"
        aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
      >
        {legendVisible ? <X size={18} aria-hidden /> : <Info size={18} aria-hidden />}
      </button>

    </main>
  );
}
