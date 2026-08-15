import { useState } from 'react';
import type { Stop } from '../types';
import { COUNTRY_FLAGS } from '../data/constants';
import { addDays } from '../utils/geo';

interface StopEditorProps {
  stop: Partial<Stop> | null;      // null = adding new stop, non-null = editing
  countries: string[];              // available countries for dropdown
  onSave: (stop: Partial<Stop>) => void;
  onDelete?: () => void;           // only when editing existing stop
  onCancel: () => void;
}

export default function StopEditor({ stop, countries, onSave, onDelete, onCancel }: StopEditorProps) {
  const isNew = !stop?.id;

  const [name, setName] = useState(stop?.name || '');
  const [country, setCountry] = useState(stop?.country || countries[0] || '');
  const [lat, setLat] = useState(stop?.lat?.toString() || '');
  const [lon, setLon] = useState(stop?.lon?.toString() || '');
  const [type, setType] = useState<'marina' | 'anchorage'>(stop?.type || 'anchorage');
  const [durationDays, setDurationDays] = useState(() => {
    if (stop?.duration) {
      const match = stop.duration.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 3;
    }
    return 3;
  });
  // Overrides the auto-cascaded planned arrival/departure (which just chains off the
  // previous stop's dates) — needed when backfilling a stop for a specific day that
  // already happened, like a second night at a different anchorage on the same island.
  const [actualArrivalDate, setActualArrivalDate] = useState(stop?.actualArrival || '');
  const [showDelete, setShowDelete] = useState(false);

  const handleSave = () => {
    if (!name.trim()) return;
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (isNaN(parsedLat) || isNaN(parsedLon)) return;

    onSave({
      ...stop,
      name: name.trim(),
      country,
      lat: parsedLat,
      lon: parsedLon,
      type,
      duration: `${durationDays} day${durationDays !== 1 ? 's' : ''}`,
      // A set date means "we were actually here on this day" — overrides the
      // auto-cascaded planned schedule for Journal ordering and Schengen counting
      // (see effectiveArrival/effectiveDeparture in routeEngine.ts), and implies visited.
      ...(actualArrivalDate ? {
        actualArrival: actualArrivalDate,
        actualDeparture: addDays(actualArrivalDate, durationDays),
        visited: true,
      } : {}),
      // marinaName/marinaUrl/cultureHighlight/wikiUrl/foodUrl/adventureUrl/provisionsUrl
      // aren't edited by this form, but the `...stop` spread above already carries
      // their existing values through unchanged — don't add explicit overrides for
      // them here, or an empty/unset local default would wipe whatever's saved.
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 md:w-96 bg-slate-800 border-l border-slate-700 z-[2000] flex flex-col animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h2 className="text-lg font-bold text-white">
          {isNew ? 'Add Stop' : `Edit: ${stop?.name}`}
        </h2>
        <button onClick={onCancel} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      {/* Form — min-h-0 is required here: a flex child's default min-height is its
          content's height, which defeats overflow-y-auto and lets the form grow past
          the viewport instead of scrolling internally, pushing the footer off-screen. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Kotor Bay"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            autoFocus
          />
        </div>

        {/* Country */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Country *</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
          >
            {countries.map(c => (
              <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
            ))}
          </select>
        </div>

        {/* Lat / Lon */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Latitude *</label>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="43.95"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Longitude *</label>
            <input
              type="number"
              step="any"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="15.45"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Type toggle */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => setType('marina')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                type === 'marina' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              ⛵ Marina
            </button>
            <button
              onClick={() => setType('anchorage')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                type === 'anchorage' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              ⚓ Anchorage
            </button>
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Duration: <span className="text-white font-bold">{durationDays} day{durationDays !== 1 ? 's' : ''}</span>
          </label>
          <input
            type="range"
            min="1"
            max="90"
            value={durationDays}
            onChange={(e) => setDurationDays(parseInt(e.target.value, 10))}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
            <span>1 day</span>
            <span>1 week</span>
            <span>1 month</span>
            <span>90 days</span>
          </div>
        </div>

        {/* Actual date — only needed when backfilling a stop for a day that already
            happened; the planned schedule above auto-cascades from the previous stop
            and can't be hand-set, so this is how you pin a specific real date instead. */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Date (optional — set this if you're logging a day that already happened)
          </label>
          <input
            type="date"
            value={actualArrivalDate}
            onChange={(e) => setActualArrivalDate(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Leave blank to let it auto-schedule after the previous stop. Setting a date marks this stop as visited and is what the Journal uses to order and place it.
          </p>
        </div>

        {/* Delete section */}
        {!isNew && onDelete && (
          <div className="pt-4 border-t border-slate-700">
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Delete this stop...
              </button>
            ) : (
              <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-3">
                <p className="text-sm text-red-300 mb-2">Remove this stop? Downstream dates will shift back.</p>
                <div className="flex gap-2">
                  <button
                    onClick={onDelete}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-500"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setShowDelete(false)}
                    className="px-3 py-1 bg-slate-700 text-slate-300 rounded text-sm hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-4 border-t border-slate-700 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-600"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !lat || !lon}
          className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          {isNew ? 'Add Stop' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
