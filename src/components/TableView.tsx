import { useState, useMemo } from 'react';
import type { Stop } from '../types';
import { COUNTRY_FLAGS, COUNTRY_COLORS } from '../data/constants';
import { formatDate } from '../utils/geo';

interface TableViewProps {
  stops: Stop[];
  selectedStop: Stop | null;
  schengenDays: Map<number, { days: number; rolling: number; isPaused: boolean }>;
  onStopSelect: (stop: Stop) => void;
  onEditStop: (stop: Stop) => void;
  onDeleteStop: (index: number) => void;
  onInsertAfter: (index: number) => void;
}

type SortField = 'id' | 'name' | 'country' | 'arrival' | 'duration' | 'distanceToNext';
type SortDir = 'asc' | 'desc';

function parseDurationNum(dur: string): number {
  const m = dur.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export default function TableView({
  stops,
  selectedStop,
  schengenDays,
  onStopSelect,
  onEditStop,
  onDeleteStop,
  onInsertAfter,
}: TableViewProps) {
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [countryFilter, setCountryFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const countries = useMemo(() => {
    const seen = new Set<string>();
    stops.forEach(s => seen.add(s.country));
    return Array.from(seen);
  }, [stops]);

  const filteredStops = useMemo(() => {
    let result = stops;
    if (countryFilter) {
      result = result.filter(s => s.country === countryFilter);
    }
    return result;
  }, [stops, countryFilter]);

  const sortedStops = useMemo(() => {
    const sorted = [...filteredStops];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'id': cmp = a.id - b.id; break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'country': cmp = a.country.localeCompare(b.country); break;
        case 'arrival': cmp = (a.arrival || '').localeCompare(b.arrival || ''); break;
        case 'duration': cmp = parseDurationNum(a.duration) - parseDurationNum(b.duration); break;
        case 'distanceToNext': cmp = a.distanceToNext - b.distanceToNext; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredStops, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const getDistanceColor = (km: number): string => {
    if (km < 50) return '#22c55e';
    if (km <= 70) return '#eab308';
    return '#ef4444';
  };

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-3 border-b border-slate-700 bg-slate-800">
        <span className="text-sm text-slate-400">{filteredStops.length} stops</span>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white"
        >
          <option value="">All countries</option>
          {countries.map(c => (
            <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-slate-800 border-b border-slate-700 z-10">
            <tr>
              <th className="px-2 py-2 text-slate-400 font-medium w-8"></th>
              <th className="px-2 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none w-10" onClick={() => handleSort('id')}>
                #{sortIcon('id')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('name')}>
                Name{sortIcon('name')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium w-32">Marina</th>
              <th className="px-3 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none w-28" onClick={() => handleSort('country')}>
                Country{sortIcon('country')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium w-14">Type</th>
              <th className="px-3 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none w-20" onClick={() => handleSort('arrival')}>
                Arrival{sortIcon('arrival')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium w-20">Depart</th>
              <th className="px-3 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none w-14" onClick={() => handleSort('duration')}>
                Days{sortIcon('duration')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium cursor-pointer hover:text-white select-none w-16" onClick={() => handleSort('distanceToNext')}>
                Dist.{sortIcon('distanceToNext')}
              </th>
              <th className="px-3 py-2 text-slate-400 font-medium w-18">Schengen</th>
              <th className="px-3 py-2 text-slate-400 font-medium w-24">Links</th>
              <th className="px-3 py-2 text-slate-400 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedStops.map((stop) => {
              const sch = schengenDays.get(stop.id);
              const isSelected = selectedStop?.id === stop.id;
              const countryColor = COUNTRY_COLORS[stop.country] || '#6b7280';
              const originalIndex = stops.findIndex(s => s.id === stop.id);
              const isExpanded = expandedRows.has(stop.id);

              return (
                <>
                  <tr
                    key={stop.id}
                    className={`border-b border-slate-800 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-cyan-600/20'
                        : 'hover:bg-slate-800/50'
                    }`}
                    onClick={() => onStopSelect(stop)}
                  >
                    <td className="px-2 py-2 text-center" onClick={(e) => { e.stopPropagation(); toggleRow(stop.id); }}>
                      <span className="text-slate-500 hover:text-white cursor-pointer text-xs">
                        {isExpanded ? '\u25BE' : '\u25B8'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-500 font-mono text-xs">{stop.id}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: countryColor }} />
                        <span className="text-white font-medium truncate">{stop.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {stop.marinaName ? (
                        <a
                          href={stop.marinaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 truncate block max-w-[120px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {stop.marinaName}
                        </a>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      <span className="mr-1">{COUNTRY_FLAGS[stop.country] || ''}</span>
                      {stop.country}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {stop.type === 'marina' ? '\u26F5' : '\u2693'}
                    </td>
                    <td className="px-3 py-2 text-slate-300 text-xs">{stop.arrival ? formatDate(stop.arrival) : '-'}</td>
                    <td className="px-3 py-2 text-slate-300 text-xs">{stop.departure ? formatDate(stop.departure) : '-'}</td>
                    <td className="px-3 py-2 text-white text-center">{parseDurationNum(stop.duration)}</td>
                    <td className="px-3 py-2">
                      {stop.distanceToNext > 0 ? (
                        <span style={{ color: getDistanceColor(stop.distanceToNext) }} className="font-medium">
                          {Math.round(stop.distanceToNext)}km
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {sch && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          sch.isPaused
                            ? 'bg-slate-700 text-slate-400'
                            : sch.rolling > 80
                              ? 'bg-red-600/80 text-white'
                              : 'bg-cyan-600/80 text-white'
                        }`}>
                          {sch.isPaused ? '\u23F8' : '\u{1F1EA}\u{1F1FA}'} {sch.rolling}/90
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {stop.wikiUrl && (
                          <a href={stop.wikiUrl} target="_blank" rel="noopener noreferrer"
                            className="hover:opacity-80" title="Wikipedia">
                            📖
                          </a>
                        )}
                        {stop.foodUrl && (
                          <a href={stop.foodUrl} target="_blank" rel="noopener noreferrer"
                            className="hover:opacity-80" title="Food Guide">
                            🍽️
                          </a>
                        )}
                        {stop.adventureUrl && (
                          <a href={stop.adventureUrl} target="_blank" rel="noopener noreferrer"
                            className="hover:opacity-80" title="Activities">
                            🏔️
                          </a>
                        )}
                        {stop.provisionsUrl && (
                          <a href={stop.provisionsUrl} target="_blank" rel="noopener noreferrer"
                            className="hover:opacity-80" title="Provisions">
                            🛒
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onEditStop(stop)}
                          className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-cyan-400"
                          title="Edit stop"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => onInsertAfter(originalIndex)}
                          className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-green-400"
                          title="Add stop after"
                        >
                          +
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${stop.name}?`)) {
                              onDeleteStop(originalIndex);
                            }
                          }}
                          className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400"
                          title="Delete stop"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${stop.id}-detail`} className="bg-slate-800/30 border-b border-slate-700">
                      <td colSpan={13} className="px-8 py-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          {stop.cultureHighlight && (
                            <div>
                              <span className="text-slate-500 text-xs block mb-0.5">Culture</span>
                              <p className="text-cyan-400">
                                {stop.cultureUrl ? (
                                  <a href={stop.cultureUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-300">
                                    {stop.cultureHighlight}
                                  </a>
                                ) : stop.cultureHighlight}
                              </p>
                            </div>
                          )}
                          {stop.notes && (
                            <div>
                              <span className="text-slate-500 text-xs block mb-0.5">Notes</span>
                              <p className="text-slate-300 italic">{stop.notes}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-500 text-xs block mb-0.5">Coordinates</span>
                            <p className="text-slate-300 font-mono text-xs">{stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}</p>
                          </div>
                          {stop.marinaName && (
                            <div>
                              <span className="text-slate-500 text-xs block mb-0.5">Marina</span>
                              <p>
                                {stop.marinaUrl ? (
                                  <a href={stop.marinaUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                                    {stop.marinaName}
                                  </a>
                                ) : (
                                  <span className="text-slate-300">{stop.marinaName}</span>
                                )}
                              </p>
                            </div>
                          )}
                          {stop.hoursToNext != null && stop.hoursToNext > 0 && (
                            <div>
                              <span className="text-slate-500 text-xs block mb-0.5">Sailing Time</span>
                              <p className="text-slate-300">{stop.hoursToNext.toFixed(1)}h ({stop.nmToNext?.toFixed(0) || '-'}nm)</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
