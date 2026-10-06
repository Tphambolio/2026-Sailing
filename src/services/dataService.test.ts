import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Stop } from '../types';

// dataService now syncs through Supabase — mock the client rather than wiring
// up real credentials, and give each Supabase call its own controllable stub
// since getData()/saveUserStops()/clearUserStops() each chain differently.
const { mockSelect, mockMaybeSingle, mockUpsert, mockDeleteEq, mockGetUser, mockUpdate } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSelect: vi.fn(),
  mockMaybeSingle: vi.fn(),
  mockUpsert: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    // saveNow uses getSession() (no network); derive it from the same mock.
    auth: {
      getUser: mockGetUser,
      getSession: async () => {
        const r = await mockGetUser();
        return { data: { session: r?.data?.user ? { user: r.data.user } : null } };
      },
    },
    from: vi.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert,
      update: mockUpdate,
      delete: vi.fn(() => ({ eq: mockDeleteEq })),
    })),
  },
}));

const stubStop = (overrides: Partial<Stop> = {}): Stop => ({
  id: 1, key: 'test-stop', name: 'Test Stop', country: 'Croatia', lat: 43, lon: 16,
  type: 'anchorage', arrival: '2026-08-01', departure: '2026-08-02', duration: '1 day',
  distanceToNext: 0, season: 'summer', phase: 'Croatia',
  ...overrides,
});

const STORAGE_KEY = 'med_odyssey_user_stops';

describe('dataService', () => {
  beforeEach(() => {
    vi.resetModules(); // dataService keeps per-page state (server version, load status)
    localStorage.clear();
    mockSelect.mockReturnValue({ eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getData', () => {
    it('prefers stops loaded from Supabase over anything in localStorage', async () => {
      const supabaseStop = stubStop({ key: 'from-supabase', name: 'From Supabase' });
      localStorage.setItem(STORAGE_KEY, JSON.stringify([stubStop({ key: 'from-local', name: 'From Local' })]));
      mockMaybeSingle.mockResolvedValue({ data: { stops: [supabaseStop] }, error: null });

      const { getData } = await import('./dataService');
      const result = await getData();

      expect(result.stops.map(s => s.key)).toEqual(['from-supabase']);
      expect(result.isUserEdited).toBe(true);
    });

    it('falls back to the local cache when Supabase has no row yet', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([stubStop({ key: 'from-local' })]));
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const { getData } = await import('./dataService');
      const result = await getData();

      expect(result.stops.map(s => s.key)).toEqual(['from-local']);
      expect(result.isUserEdited).toBe(true);
    });

    it('falls back to the local cache when the Supabase request fails outright', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([stubStop({ key: 'from-local' })]));
      mockMaybeSingle.mockRejectedValue(new Error('network error'));

      const { getData } = await import('./dataService');
      const result = await getData();

      expect(result.stops.map(s => s.key)).toEqual(['from-local']);
    });

    it('falls back to the built-in default itinerary when neither source has anything', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const { getData } = await import('./dataService');
      const result = await getData();

      expect(result.isUserEdited).toBe(false);
      expect(result.stops.length).toBeGreaterThan(0);
    });
  });

  describe('saveUserStops', () => {
    it('always caches locally, and pushes to Supabase when signed in', async () => {
      const { getData, saveUserStops } = await import('./dataService');
      await getData(); // server confirmed: no row yet
      const stops = [stubStop()];

      await saveUserStops(stops);

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stops);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ id: 1, stops, updated_by: 'user-1' });
    });

    it('does not attempt the Supabase write when not signed in', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { getData, saveUserStops } = await import('./dataService');
      await getData();
      const stops = [stubStop()];

      expect(await saveUserStops(stops)).toEqual({ status: 'local-only' });
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('keeps a failed (offline) save on this device as a pending change, not as the confirmed copy', async () => {
      mockUpsert.mockResolvedValue({ error: new Error('RLS rejected') });
      const { getData, saveUserStops } = await import('./dataService');
      await getData();
      const stops = [stubStop()];

      await expect(saveUserStops(stops)).resolves.toEqual({ status: 'local-only' });
      expect(JSON.parse(localStorage.getItem('med_odyssey_pending_stops')!).stops).toEqual(stops);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('offline load guard', () => {
    it('refuses to save (and never upserts) when the server could not be reached on load', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([stubStop({ key: 'stale-cached' })]));
      mockMaybeSingle.mockRejectedValue(new Error('network error'));
      const { getData, saveUserStops } = await import('./dataService');
      const loaded = await getData(); // falls back to the stale local copy

      expect(await saveUserStops(loaded.stops)).toEqual({ status: 'not-loaded' });
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});

describe('saveUserStops conflict protection', () => {
  // Chain: update(...).eq('id').eq('updated_at', v).select('updated_at')
  function updateReturns(result: { data: unknown; error: unknown }) {
    const eq2 = vi.fn(() => ({ select: vi.fn().mockResolvedValue(result) }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    mockUpdate.mockReturnValue({ eq: eq1 });
    return eq2;
  }

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockSelect.mockReturnValue({ eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) });
    mockMaybeSingle.mockResolvedValue({ data: { stops: [stubStop()], updated_at: 'v1' }, error: null });
  });

  it('only writes if the row still has the version this device loaded, then tracks the new version', async () => {
    const eqVersion = updateReturns({ data: [{ updated_at: 'v2' }], error: null });
    const { getData, saveUserStops } = await import('./dataService');
    await getData();

    expect(await saveUserStops([stubStop()])).toEqual({ status: 'saved' });
    expect(eqVersion).toHaveBeenCalledWith('updated_at', 'v1');

    const eqNext = updateReturns({ data: [{ updated_at: 'v3' }], error: null });
    await saveUserStops([stubStop()]);
    expect(eqNext).toHaveBeenCalledWith('updated_at', 'v2');
  });

  it('reports a conflict (and writes nothing) when another editor saved in between', async () => {
    updateReturns({ data: [], error: null });
    const { getData, saveUserStops } = await import('./dataService');
    await getData();

    expect(await saveUserStops([stubStop()])).toEqual({ status: 'conflict' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('refreshes the offline cache whenever the latest itinerary loads', async () => {
    const { getData } = await import('./dataService');
    await getData();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0].key).toBe('test-stop');
  });
});

describe('itinerary conflict + offline safety', () => {
  function updateReturns(result: { data: unknown; error: unknown }) {
    const eq2 = vi.fn(() => ({ select: vi.fn().mockResolvedValue(result) }));
    mockUpdate.mockReturnValue({ eq: vi.fn(() => ({ eq: eq2 })) });
    return eq2;
  }
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockSelect.mockReturnValue({ eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) });
    mockMaybeSingle.mockResolvedValue({ data: { stops: [stubStop()], updated_at: 'v1' }, error: null });
  });

  it('refuses every save queued behind a conflict until the itinerary is reloaded', async () => {
    const eqVersion = updateReturns({ data: [], error: null }); // first save: conflict
    const { getData, saveUserStops, reloadData } = await import('./dataService');
    await getData();

    const first = saveUserStops([stubStop({ name: 'mine 1' })]);
    const second = saveUserStops([stubStop({ name: 'mine 2' })]);
    expect(await first).toEqual({ status: 'conflict' });
    expect(await second).toEqual({ status: 'conflict' });
    expect(eqVersion).toHaveBeenCalledTimes(1); // the queued one never wrote

    mockMaybeSingle.mockResolvedValue({ data: { stops: [stubStop()], updated_at: 'v2' }, error: null });
    await reloadData();
    updateReturns({ data: [{ updated_at: 'v3' }], error: null });
    expect(await saveUserStops([stubStop()])).toEqual({ status: 'saved' });
  });

  it('shows and re-syncs offline changes on the next load when nobody else edited meanwhile', async () => {
    localStorage.setItem('med_odyssey_pending_stops', JSON.stringify({ stops: [stubStop({ key: 'offline-edit' })], baseVersion: 'v1' }));
    const { getData, syncPendingStops } = await import('./dataService');
    const loaded = await getData();
    expect(loaded.hasPending).toBe(true);
    expect(loaded.stops[0].key).toBe('offline-edit');

    updateReturns({ data: [{ updated_at: 'v2' }], error: null });
    expect(await syncPendingStops()).toEqual({ status: 'saved' });
    expect(localStorage.getItem('med_odyssey_pending_stops')).toBeNull();
  });

  it('drops offline changes (and says so) if someone else edited the itinerary meanwhile', async () => {
    localStorage.setItem('med_odyssey_pending_stops', JSON.stringify({ stops: [stubStop({ key: 'offline-edit' })], baseVersion: 'v0' }));
    const { getData } = await import('./dataService');
    const loaded = await getData();
    expect(loaded.droppedOfflineChanges).toBe(true);
    expect(loaded.stops[0].key).toBe('test-stop');
  });
});
