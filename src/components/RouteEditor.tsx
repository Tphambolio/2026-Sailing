import { useState, useCallback, useEffect } from 'react';
import { useMapEvents, Marker, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import type { Stop } from '../types';

interface RouteEditorProps {
  stops: Stop[];
  isEditing: boolean;
  onSaveWaypoints: (stopId: number, waypoints: [number, number][]) => void;
}

// Number marker for waypoint order
function createNumberIcon(num: number): L.DivIcon {
  return L.divIcon({
    className: 'waypoint-number',
    html: `<div style="width: 24px; height: 24px; background: #f59e0b; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${num}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Component to handle map click events
function MapClickHandler({
  onMapClick,
  enabled
}: {
  onMapClick: (lat: number, lng: number) => void;
  enabled: boolean;
}) {
  useMapEvents({
    click: (e) => {
      if (enabled) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export default function RouteEditor({ stops, isEditing, onSaveWaypoints }: RouteEditorProps) {
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [waypoints, setWaypoints] = useState<[number, number][]>([]);
  const [drawMode, setDrawMode] = useState(false);

  // Find the selected stop and next stop
  const selectedStopIndex = stops.findIndex(s => s.id === selectedStopId);
  const selectedStop = selectedStopIndex >= 0 ? stops[selectedStopIndex] : null;
  const nextStop = selectedStopIndex >= 0 && selectedStopIndex < stops.length - 1
    ? stops[selectedStopIndex + 1]
    : null;

  // When selection changes, load existing waypoints
  useEffect(() => {
    if (selectedStop) {
      setWaypoints(selectedStop.routeWaypoints || []);
    } else {
      setWaypoints([]);
    }
  }, [selectedStopId, selectedStop]);

  // Handle clicking on the map to add a waypoint
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!drawMode || !selectedStop) return;
    setWaypoints(prev => [...prev, [lat, lng]]);
  }, [drawMode, selectedStop]);

  // Handle dragging a waypoint
  const handleWaypointDrag = useCallback((index: number, lat: number, lng: number) => {
    setWaypoints(prev => {
      const newWaypoints = [...prev];
      newWaypoints[index] = [lat, lng];
      return newWaypoints;
    });
  }, []);

  // Delete waypoint
  const handleWaypointDelete = useCallback((index: number) => {
    setWaypoints(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Save waypoints
  const handleSave = useCallback(() => {
    if (selectedStopId !== null) {
      onSaveWaypoints(selectedStopId, waypoints);
      setDrawMode(false);
    }
  }, [selectedStopId, waypoints, onSaveWaypoints]);

  // Clear all
  const handleClear = useCallback(() => {
    setWaypoints([]);
  }, []);

  // Copy coordinates to clipboard
  const handleCopyCoords = useCallback(() => {
    const coordsText = waypoints.map((wp) => `  [${wp[0].toFixed(6)}, ${wp[1].toFixed(6)}]`).join(',\n');
    const output = `Route: ${selectedStop?.name} → ${nextStop?.name}\nWaypoints:\n[\n${coordsText}\n]`;
    navigator.clipboard.writeText(output);
    console.log(output);
    alert('Coordinates copied to clipboard!');
  }, [waypoints, selectedStop, nextStop]);

  if (!isEditing) return null;

  return (
    <>
      <MapClickHandler onMapClick={handleMapClick} enabled={drawMode && selectedStopId !== null} />

      {/* Preview line when drawing */}
      {selectedStop && nextStop && (
        <Polyline
          positions={[
            [selectedStop.lat, selectedStop.lon],
            ...waypoints,
            [nextStop.lat, nextStop.lon],
          ]}
          pathOptions={{
            color: '#f59e0b',
            weight: 4,
            opacity: 0.9,
            dashArray: drawMode ? '10, 5' : undefined
          }}
        />
      )}

      {/* Start marker (green) */}
      {selectedStop && (
        <CircleMarker
          center={[selectedStop.lat, selectedStop.lon]}
          radius={10}
          pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
        />
      )}

      {/* End marker (red) */}
      {nextStop && (
        <CircleMarker
          center={[nextStop.lat, nextStop.lon]}
          radius={10}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}
        />
      )}

      {/* Waypoint markers */}
      {waypoints.map((wp, index) => (
        <Marker
          key={`wp-${index}`}
          position={wp}
          icon={createNumberIcon(index + 1)}
          draggable={true}
          eventHandlers={{
            dragend: (e) => {
              const pos = e.target.getLatLng();
              handleWaypointDrag(index, pos.lat, pos.lng);
            },
            contextmenu: (e) => {
              L.DomEvent.stopPropagation(e);
              handleWaypointDelete(index);
            },
          }}
        />
      ))}

      {/* Control Panel */}
      <div
        className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-gray-900 rounded-lg shadow-lg p-4 border border-gray-700 min-w-[350px]"
        style={{ pointerEvents: 'auto' }}
      >
        {/* Route selector */}
        <div className="mb-3">
          <label className="text-gray-400 text-xs uppercase mb-1 block">Select Route to Edit</label>
          <select
            value={selectedStopId || ''}
            onChange={(e) => {
              setSelectedStopId(e.target.value ? Number(e.target.value) : null);
              setDrawMode(false);
            }}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm"
          >
            <option value="">-- Choose a route --</option>
            {stops.slice(0, -1).map((stop, i) => (
              <option key={stop.id} value={stop.id}>
                {stop.id}. {stop.name} → {stops[i + 1]?.name}
              </option>
            ))}
          </select>
        </div>

        {selectedStop && nextStop && (
          <>
            <div className="text-white font-medium mb-2">
              <span className="text-green-400">●</span> {selectedStop.name} → <span className="text-red-400">●</span> {nextStop.name}
            </div>

            <div className="text-gray-400 text-sm mb-3">
              {waypoints.length} waypoint{waypoints.length !== 1 ? 's' : ''}
              {drawMode && ' • Click map to add points'}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDrawMode(!drawMode)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  drawMode
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {drawMode ? '✓ Drawing...' : '✏️ Draw Points'}
              </button>

              <button
                onClick={handleClear}
                className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300"
              >
                Clear
              </button>

              <button
                onClick={handleSave}
                disabled={waypoints.length === 0}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  waypoints.length > 0
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                Save Route
              </button>

              <button
                onClick={handleCopyCoords}
                disabled={waypoints.length === 0}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  waypoints.length > 0
                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                📋 Copy Coords
              </button>
            </div>
          </>
        )}

        {!selectedStop && (
          <div className="text-gray-400 text-sm">
            Select a route from the dropdown above to start editing
          </div>
        )}
      </div>
    </>
  );
}
