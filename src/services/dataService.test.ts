import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Stop } from '../types';

// dataService now syncs through Supabase — mock the client rather than wiring
// up real credentials, and give each Supabase call its own controllable stub
// since getData()/saveUserStops()/clearUserStops() each chain differently.
const { mockSelect, mockMaybeSingle, mockUpsert, mockDeleteEq, mockGetUser } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockMaybeSingle: vi.fn(),
  mockUpsert: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert,
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
      const { saveUserStops } = await import('./dataService');
      const stops = [stubStop()];

      await saveUserStops(stops);

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stops);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ id: 1, stops, updated_by: 'user-1' });
    });

    it('still caches locally even when not signed in, without attempting the Supabase write', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { saveUserStops } = await import('./dataService');
      const stops = [stubStop()];

      await saveUserStops(stops);

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stops);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('keeps the local cache even if the Supabase write fails', async () => {
      mockUpsert.mockResolvedValue({ error: new Error('RLS rejected') });
      const { saveUserStops } = await import('./dataService');
      const stops = [stubStop()];

      await expect(saveUserStops(stops)).resolves.toBeUndefined();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stops);
    });
  });

  describe('clearUserStops', () => {
    it('clears both the local cache and the shared Supabase row', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([stubStop()]));
      const { clearUserStops } = await import('./dataService');

      await clearUserStops();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(mockDeleteEq).toHaveBeenCalledWith('id', 1);
    });
  });
});
