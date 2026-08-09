import { describe, it, expect } from 'vitest';
import { isDateInStay, getStopsInMonth, getStaySegments, getCalendarDays } from './calendarUtils';
import type { Stop } from '../../types';

const stubStop = (overrides: Partial<Stop> = {}): Stop => ({
  id: 1, key: 'test-stop', name: 'Test Stop', country: 'Croatia', lat: 43, lon: 16,
  type: 'anchorage', arrival: '2026-08-01', departure: '2026-08-02', duration: '1 day',
  distanceToNext: 0, season: 'summer', phase: 'Croatia',
  ...overrides,
});

describe('calendarUtils — actual date override', () => {
  // A stop appended out of chronological sequence (e.g. via the map's "Add
  // Stop" button, which always appends at the end) keeps a stale auto-cascaded
  // arrival/departure far from its real date. Setting actualArrival/
  // actualDeparture is supposed to override that everywhere dates are shown —
  // the calendar view is one of those places.
  const outOfSequenceStop = stubStop({
    arrival: '2027-05-17', departure: '2027-05-18', // stale, cascaded from wherever it landed in the array
    actualArrival: '2026-08-04', actualDeparture: '2026-08-05', // the real day it happened
  });

  it('isDateInStay uses the actual date, not the stale planned one', () => {
    expect(isDateInStay(new Date(2026, 7, 4), outOfSequenceStop)).toBe(true);
    expect(isDateInStay(new Date(2027, 4, 17), outOfSequenceStop)).toBe(false);
  });

  it('getStopsInMonth places the stop in the actual month, not the planned one', () => {
    expect(getStopsInMonth([outOfSequenceStop], 2026, 7)).toEqual([outOfSequenceStop]); // August 2026
    expect(getStopsInMonth([outOfSequenceStop], 2027, 4)).toEqual([]); // May 2027
  });

  it('getStaySegments places the stay segment on the actual calendar day', () => {
    const days = getCalendarDays(2026, 7); // August 2026
    const segments = getStaySegments(outOfSequenceStop, 2026, 7, days);
    expect(segments.length).toBeGreaterThan(0);
    const dayIndex = days.findIndex(d => d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 4);
    const rowIndex = Math.floor(dayIndex / 7);
    const colIndex = dayIndex % 7;
    expect(segments.some(s => s.rowIndex === rowIndex && s.startCol <= colIndex)).toBe(true);
  });
});
