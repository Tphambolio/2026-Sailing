import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { getData, saveUserStops, exportStopsJson } from './services/dataService';
import { healRoute, computePhases, computeStats, insertStop, removeStop, updateStop, computeSchengenStatus, schengenByStop, effectiveArrival, effectiveDeparture, currentStopLabel } from './services/routeEngine';
import type { Stop, Phase, TripStats } from './types';
import { COUNTRY_FLAGS } from './data/constants';
import { formatDate, todayISO } from './utils/geo';
import StopEditor from './components/StopEditor';
import NotesModal from './components/NotesModal';
import JournalView from './components/JournalView';
import PhotosView from './components/PhotosView';
// Leaflet is the second-largest dependency and most visitors only read the journal —
// load the map (and its CSS) the first time someone opens the Map tab.
const MapView = lazy(() => import('./components/MapView'));
import { useAuth } from './context/AuthContext';
import { supabase } from './lib/supabase';
import { BookOpen, Map as MapIcon, Images, Menu, X, LogIn, LogOut, Sailboat, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

// Get distance color: <50 green, 50-70 yellow, >70 red
function getDistanceColor(km: number): string {
  if (km < 50) return '#22c55e'; // green
  if (km <= 70) return '#eab308'; // yellow
  return '#ef4444'; // red
}

function App() {
  // isEditor gates every planning/editing control. Readers (family following
  // along) get a read-only journal + map; the RLS allowlist is the actual
  // enforcement, this just keeps controls that would fail out of their way.
  const { user, isEditor, signInWithProvider, signOut } = useAuth();
  const [notesModalStop, setNotesModalStop] = useState<Stop | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUserEdited, setIsUserEdited] = useState(false);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'map' | 'journal' | 'photos'>('journal');
  // Stop editing state
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | null>(null);

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
        // Deep link: tripjournal/#<stop-key> opens straight to that entry (the
        // hash survives the password gate since it's the same page).
        const linkedKey = decodeURIComponent(window.location.hash.slice(1));
        const linked = linkedKey ? result.stops.find(s => s.key === linkedKey) : undefined;
        if (linked) {
          setActiveView('journal');
          setSelectedStop(linked);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply route changes: heal, recompute, persist
  const reloadStops = useCallback(async () => {
    const result = await getData();
    setStops(result.stops);
    setPhases(result.phases);
    setStats(result.stats);
    setIsUserEdited(result.isUserEdited);
    setSelectedStop(prev => prev ? result.stops.find(s => s.key === prev.key) || null : prev);
  }, []);

  const applyRouteChange = useCallback((newStops: Stop[]) => {
    const healed = healRoute(newStops);
    setStops(healed);
    setPhases(computePhases(healed));
    setStats(computeStats(healed));
    saveUserStops(healed).then(({ status }) => {
      if (status === 'not-loaded') {
        alert('The itinerary couldn\'t be loaded from the server when this page opened (offline?), so changes can\'t be saved — saving now could overwrite the real one with an old copy. Reload the page when you\'re back online and try again.');
        return;
      }
      if (status !== 'conflict') return;
      // Another editor saved the itinerary since this device loaded it. Ours was
      // NOT written (it would have wiped theirs) — show theirs and let the user redo.
      alert('Someone else updated the itinerary since you opened it, so your last change wasn\'t saved. Loading the latest version now — please make your change again.');
      reloadStops();
    });
    setIsUserEdited(true);
    // Keep the open detail panel in sync with the freshly healed stop data
    setSelectedStop(prev => prev ? healed.find(s => s.id === prev.id) || null : prev);
  }, [reloadStops]);

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


  // Set initial sidebar state based on screen width (after mount)
  useEffect(() => {
    const isDesktop = window.innerWidth >= 768;
    setSidebarOpen(isDesktop);
  }, []);

  const countries = [...new Set(stops.map(s => s.country))];

  // Calculate Schengen days for each stop
  const schengenDays = useMemo(() => schengenByStop(stops), [stops]);

  // Live 90/180 Schengen status as of today
  const schengenStatus = useMemo(() => computeSchengenStatus(stops), [stops]);

  // The stop we're currently at: today falls within its (effective) stay window,
  // falling back to the most recently visited stop.
  const currentStop = useMemo(() => {
    const today = todayISO();
    // Search from the end: when one stop's departure equals the next's arrival (the
    // usual case), prefer the later stop — the one just arrived at, not the one left.
    // Visited stops only — an unvisited stop's dates are just the auto-cascaded
    // plan, which can drift onto today (e.g. "Here now: Bodrum" while still in Paros).
    const inProgress = [...stops].reverse().find(s => {
      if (!s.visited) return false;
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
          <Sailboat size={40} className="text-cyan-400 mx-auto mb-4 animate-pulse" aria-hidden />
          <p className="font-serif text-slate-200 text-xl">Mediterranean Odyssey</p>
          <p className="text-slate-500 text-sm mt-1">Loading the journal…</p>
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
      <header className="bg-slate-900/95 backdrop-blur border-b border-slate-800 px-2 md:px-4 py-2 md:py-2.5">
        <div className="flex items-center justify-between gap-1 md:gap-2">
          {/* Left side: Hamburger (mobile) + Logo */}
          <div className="flex items-center gap-1 md:gap-2 min-w-0">
            {/* Hamburger menu for mobile */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-10 h-10 flex items-center justify-center text-slate-200 hover:bg-slate-800 rounded-lg md:hidden"
              aria-label={sidebarOpen ? 'Close stop list' : 'Open stop list'}
            >
              {sidebarOpen ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
            </button>
            <h1 className="flex items-center gap-2 text-white">
              <Sailboat size={22} className="text-cyan-400 shrink-0" aria-hidden />
              <span className="hidden sm:inline font-serif text-lg md:text-xl font-bold">Mediterranean Odyssey</span>
            </h1>
            {isEditor && isUserEdited && (
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
                {isEditor && <span className="text-slate-500">|</span>}
                {isEditor && <span
                  className={schengenStatus.remaining <= 10 ? 'text-red-400 font-semibold' : schengenStatus.remaining <= 25 ? 'text-amber-400' : 'text-cyan-400'}
                  title={[
                    `${schengenStatus.usedInWindow} Schengen days used in the trailing 180 days (as of today)`,
                    schengenStatus.nextFreeDate ? `Next day frees up ${formatDate(schengenStatus.nextFreeDate)}` : null,
                    schengenStatus.usedInWindow > 90
                      ? `⚠ OVER the 90-day limit (since ${formatDate(schengenStatus.overstayDate || todayISO())})`
                      : schengenStatus.overstayDate ? `⚠ Plan exceeds 90 days around ${formatDate(schengenStatus.overstayDate)}` : 'Plan stays within the 90-day limit',
                  ].filter(Boolean).join(' • ')}
                >
                  🇪🇺 {schengenStatus.usedInWindow}/90 ({schengenStatus.remaining} left)
                </span>}
              </div>
            )}
            {/* View Toggle - large and always labeled so it reads as a toggle, not decoration */}
            <div className="flex items-center gap-1 bg-slate-800 rounded-xl p-1" role="tablist" aria-label="View">
              {([['journal', BookOpen, 'Journal'], ['photos', Images, 'Photos'], ['map', MapIcon, 'Map']] as const).map(([view, Icon, label]) => (
                <button
                  key={view}
                  role="tab"
                  aria-selected={activeView === view}
                  onClick={() => setActiveView(view)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-2 md:px-4 rounded-lg text-sm md:text-base font-semibold whitespace-nowrap ${activeView === view ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  <Icon size={18} aria-hidden /> <span className={activeView === view ? '' : 'sr-only sm:not-sr-only'}>{label}</span>
                </button>
              ))}
            </div>
            {/* Route edit actions */}
            {isEditor && isUserEdited && (
              <div className="hidden md:flex items-center gap-1">
                <button onClick={() => exportStopsJson(stops)} className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-xs text-white" title="Download stops.json">
                  💾 Export
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
                className="h-10 px-2 inline-flex items-center gap-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
                title={`Signed in as ${user.email || user.user_metadata?.name || 'you'} — click to sign out`}
                aria-label="Sign out"
              >
                <LogOut size={18} aria-hidden /><span className="hidden md:inline">Sign out</span>
              </button>
            ) : (
              <button
                onClick={() => signInWithProvider('google')}
                className="h-10 px-2 inline-flex items-center gap-1.5 rounded-lg text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800"
                title="Editors: sign in to write"
                aria-label="Sign in"
              >
                <LogIn size={18} aria-hidden /><span className="hidden md:inline">Sign in</span>
              </button>
            )}
            {/* Desktop sidebar toggle */}
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden md:flex w-10 h-10 items-center justify-center text-slate-300 hover:bg-slate-800 rounded-lg" aria-label={sidebarOpen ? 'Hide stop list' : 'Show stop list'}>
              {sidebarOpen ? <PanelLeftClose size={20} aria-hidden /> : <PanelLeftOpen size={20} aria-hidden />}
            </button>
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
                      {isEditor ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleVisited(stop); }}
                          className={`shrink-0 mt-1 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] transition-colors ${stop.visited ? 'bg-green-600 border-green-500 text-white' : 'border-slate-500 text-transparent hover:border-slate-300'}`}
                          title={stop.visited ? 'Mark as not visited' : 'Mark as visited'}
                        >{'✓'}</button>
                      ) : (
                        <span
                          className={`shrink-0 mt-1 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] ${stop.visited ? 'bg-green-600 border-green-500 text-white' : 'border-slate-600 text-transparent'}`}
                          title={stop.visited ? 'Visited' : 'Planned'}
                        >{'✓'}</span>
                      )}
                      <span className="text-lg">{stop.type === 'marina' ? '⛵' : '⚓'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${stop.visited ? 'text-slate-300' : 'text-white'}`}>{stop.id}. {stop.name}</p>
                          {stop.duration && <span className="text-[10px] text-slate-500">({stop.duration})</span>}
                          {currentStop?.id === stop.id && <span className="text-[10px] px-1 py-0.5 rounded bg-coral-400 text-slate-950 font-semibold whitespace-nowrap">{currentStopLabel(stop) === 'Here now' ? 'Here' : 'Latest'}</span>}
                          {/* Edit button — always visible; hover-only (opacity-0 until
                              group-hover) meant it never rendered on touch devices,
                              the only way to rename/reposition a stop. */}
                          {isEditor && <button
                            onClick={(e) => { e.stopPropagation(); handleEditStop(stop); }}
                            className="ml-auto p-0.5 hover:bg-slate-600 rounded text-slate-500 hover:text-cyan-400 text-xs transition-opacity"
                            title="Edit stop"
                          >✏️</button>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{COUNTRY_FLAGS[stop.country] || ''} {stop.country}</span>
                          {effectiveArrival(stop) && <span className="text-slate-500">•</span>}
                          {effectiveArrival(stop) && <span className="text-amber-400">{formatDate(effectiveArrival(stop))}</span>}
                          {isEditor && schengenDays.get(stop.id) && (
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
                        {isEditor && stop.distanceToNext > 0 && (() => {
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
                  {isEditor && (
                    <div className="flex justify-center -my-1 transition-opacity">
                      <button
                        onClick={() => handleAddStop(originalIndex)}
                        className="px-2 py-0 text-[10px] text-slate-500 hover:text-green-400 hover:bg-slate-700/50 rounded"
                        title="Add stop here"
                      >+ add stop</button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </aside>

        {/* Main Content Area - Map or Journal */}
        {activeView === 'photos' ? (
          <PhotosView stops={stops} currentStop={currentStop} onOpenEntry={(stop) => { setActiveView('journal'); setSelectedStop(stop); }} />
        ) : activeView === 'journal' ? (
          <JournalView
            stops={stops}
            currentStop={currentStop}
            focusStop={selectedStop}
            onToggleVisited={isEditor ? handleToggleVisited : undefined}
            onLogArrival={isEditor ? handleLogArrival : undefined}
            onLogDeparture={isEditor ? handleLogDeparture : undefined}
            onOpenMap={() => setActiveView('map')}
          />
        ) : (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-900 text-slate-500 text-sm">Loading map…</div>}>
          <MapView
            stops={stops}
            phases={phases}
            selectedStop={selectedStop}
            onSelectStop={setSelectedStop}
            currentStop={currentStop}
            isEditor={isEditor}
            schengenDays={schengenDays}
            onToggleVisited={handleToggleVisited}
            onEditStop={handleEditStop}
            onOpenNotes={setNotesModalStop}
            onMoveStop={handleMoveStop}
          />
        </Suspense>
        )}
      </div>

      {/* Stop Editor Panel */}
      {(editingStop !== null || insertAfterIndex !== null) && (
        <StopEditor
          stop={editingStop}
          countries={countries}
          onSave={handleSaveStop}
          onDelete={editingStop ? async () => {
            // A stop's journal entry and photos are keyed to it — deleting the stop
            // leaves them in the database but nothing displays them any more.
            const [{ count: notes }, { count: photos }] = await Promise.all([
              supabase.from('sailing_stop_notes').select('stop_key', { count: 'exact', head: true }).eq('stop_key', editingStop.key).neq('content', ''),
              supabase.from('sailing_stop_photos').select('id', { count: 'exact', head: true }).eq('stop_key', editingStop.key),
            ]);
            if ((notes ?? 0) > 0 || (photos ?? 0) > 0) {
              const what = [(notes ?? 0) > 0 ? 'a journal entry' : '', (photos ?? 0) > 0 ? `${photos} photo${photos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
              if (!window.confirm(`"${editingStop.name}" has ${what}. Deleting the stop will hide them from the site (they stay in the database and can be restored). Delete anyway?`)) return;
            }
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
