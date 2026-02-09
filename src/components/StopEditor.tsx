import { useState, useEffect } from 'react';
import type { Stop } from '../types';
import { COUNTRY_FLAGS } from '../data/constants';
import { geocodeTown, searchMarinasNear, type OsmSearchResult } from '../services/osmSearch';
import { enrichStop, type EnrichmentData } from '../services/enrichment';

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
  const [notes, setNotes] = useState(stop?.notes || '');
  const [marinaName, setMarinaName] = useState(stop?.marinaName || '');
  const [marinaUrl, setMarinaUrl] = useState(stop?.marinaUrl || '');
  const [showDelete, setShowDelete] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OsmSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Enrichment state
  const [enrichmentData, setEnrichmentData] = useState<EnrichmentData | null>(null);
  const [enriching, setEnriching] = useState(false);

  // Update form when stop prop changes (e.g., map click sets lat/lon)
  useEffect(() => {
    if (stop?.lat && stop.lat.toString() !== lat) setLat(stop.lat.toString());
    if (stop?.lon && stop.lon.toString() !== lon) setLon(stop.lon.toString());
  }, [stop?.lat, stop?.lon]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const geo = await geocodeTown(searchQuery);
      if (!geo) {
        setSearchError('Town not found in Mediterranean');
        return;
      }

      // Try Overpass for marinas, but don't fail the whole search if it's down
      let results: OsmSearchResult[] = [];
      try {
        results = await searchMarinasNear(geo.lat, geo.lon);
      } catch (err) {
        console.warn('Overpass API failed, using geocode only:', err);
      }

      if (results.length > 0) {
        setSearchResults(results);
      } else {
        // Fall back to geocoded location as a single result
        const townName = geo.displayName.split(',')[0];
        setSearchResults([{
          id: 0,
          name: townName,
          lat: geo.lat,
          lon: geo.lon,
          type: 'anchorage',
        }]);
        setSearchError(results.length === 0 ? `Showing location for ${townName} (marina search unavailable)` : '');
      }
    } catch (err) {
      setSearchError('Search failed — check your connection');
      console.warn('OSM search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectResult = (result: OsmSearchResult) => {
    setName(result.name);
    setLat(result.lat.toFixed(4));
    setLon(result.lon.toFixed(4));
    setType(result.type);
    if (result.type === 'marina') {
      setMarinaName(result.name);
      if (result.website) setMarinaUrl(result.website);
    }
    setSearchResults([]);
    setSearchQuery('');
    setSearchError('');
  };

  const handleEnrich = async () => {
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (!name.trim() || isNaN(parsedLat) || isNaN(parsedLon)) return;

    setEnriching(true);
    try {
      const data = await enrichStop(parsedLat, parsedLon, name.trim());
      setEnrichmentData(data);
    } catch (err) {
      console.warn('Enrichment failed:', err);
    } finally {
      setEnriching(false);
    }
  };

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
      notes: notes.trim() || undefined,
      marinaName: marinaName.trim() || undefined,
      marinaUrl: marinaUrl.trim() || undefined,
      // Spread enrichment data if available
      ...(enrichmentData || {}),
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

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Marina/Anchorage Search — only for new stops */}
        {isNew && (
          <div className="pb-3 border-b border-slate-700">
            <label className="block text-xs font-medium text-slate-400 mb-1">Search Marina / Anchorage</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Town name (e.g., Dubrovnik)"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-3 py-2 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500 disabled:bg-slate-600 disabled:text-slate-400"
              >
                {searching ? '...' : 'Search'}
              </button>
            </div>
            {searchError && <p className="text-xs text-amber-400 mt-1">{searchError}</p>}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1 rounded-lg border border-slate-600">
                {searchResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleSelectResult(r)}
                    className="w-full text-left p-2 hover:bg-slate-600 text-sm border-b border-slate-700 last:border-b-0 transition-colors"
                  >
                    <span>{r.type === 'marina' ? '\u26F5' : '\u2693'}</span>
                    <span className="text-white ml-2 font-medium">{r.name}</span>
                    <span className="text-slate-500 text-xs ml-2">
                      ({r.lat.toFixed(3)}, {r.lon.toFixed(3)})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Kotor Bay"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
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

        {/* Tip for map click */}
        {isNew && !searchResults.length && (
          <p className="text-xs text-slate-500 -mt-2">
            Tip: Click on the map to set coordinates, or use search above
          </p>
        )}

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

        {/* Marina details (if type is marina) */}
        {type === 'marina' && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Marina Name</label>
              <input
                type="text"
                value={marinaName}
                onChange={(e) => setMarinaName(e.target.value)}
                placeholder="e.g., Porto Montenegro"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Marina URL</label>
              <input
                type="url"
                value={marinaUrl}
                onChange={(e) => setMarinaUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about this stop..."
            rows={2}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
          />
        </div>

        {/* Auto-enrichment */}
        <div className="pt-2">
          <button
            onClick={handleEnrich}
            disabled={enriching || !name.trim() || !lat || !lon}
            className="w-full px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-500 disabled:bg-slate-600 disabled:text-slate-400 transition-colors"
          >
            {enriching ? 'Enriching...' : '\u2728 Auto-fill Links & Culture'}
          </button>
          {enrichmentData && (
            <div className="mt-2 text-xs text-slate-400 space-y-0.5 bg-slate-700/50 rounded-lg p-2">
              {enrichmentData.cultureHighlight && (
                <p className="text-cyan-400">\ud83c\udfdb\ufe0f {enrichmentData.cultureHighlight}</p>
              )}
              {enrichmentData.wikiUrl && <p>\ud83d\udcd6 Wikipedia found</p>}
              {enrichmentData.foodUrl && <p>\ud83c\udf7d\ufe0f Food guide set</p>}
              {enrichmentData.adventureUrl && <p>\ud83c\udfd4\ufe0f Activities set</p>}
              {enrichmentData.provisionsUrl && <p>\ud83d\uded2 Provisions set</p>}
            </div>
          )}
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
