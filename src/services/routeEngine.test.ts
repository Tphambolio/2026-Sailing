import { describe, it, expect } from 'vitest';
import { schengenDaysInRange, computeSchengenStatus, currentStopLabel, formatStay, sailedTrack, type DateRange } from './routeEngine';
import type { Stop } from '../types';

function stop(overrides: Partial<Stop>): Stop {
  return {
    id: 1,
    key: 'stop',
    name: 'Stop',
    country: 'Croatia',
    lat: 0,
    lon: 0,
    type: 'marina',
    arrival: '',
    departure: '',
    duration: '1 day',
    distanceToNext: 0,
    season: 'summer',
    phase: 'Croatia',
    ...overrides,
  };
}

describe('schengenDaysInRange', () => {
  it('counts both the entry day and exit day as full days (EU rule)', () => {
    const ranges: DateRange[] = [{ start: '2026-01-01', end: '2026-01-05' }];
    expect(schengenDaysInRange(ranges, '2025-01-01', '2026-12-31')).toBe(5);
  });

  it('does not double-count a day shared by two directly-adjacent stays', () => {
    // Stop A departs the same day Stop B arrives — same calendar day, should count once.
    const ranges: DateRange[] = [
      { start: '2026-01-01', end: '2026-01-03' },
      { start: '2026-01-03', end: '2026-01-05' },
    ];
    // True presence: Jan 1,2,3,4,5 = 5 distinct days, not 3+3=6.
    expect(schengenDaysInRange(ranges, '2025-01-01', '2026-12-31')).toBe(5);
  });

  it('handles a single-day stay (arrival === departure) as one day, not zero', () => {
    const ranges: DateRange[] = [{ start: '2026-06-15', end: '2026-06-15' }];
    expect(schengenDaysInRange(ranges, '2025-01-01', '2026-12-31')).toBe(1);
  });
});

describe('computeSchengenStatus window boundary', () => {
  it('still counts a day on the window boundary (asOf - 179, the 180th day back)', () => {
    const asOf = '2026-08-05';
    const stops = [stop({ key: 'a', arrival: '2026-02-07', departure: '2026-02-07' })]; // asOf - 179 days
    const status = computeSchengenStatus(stops, asOf);
    expect(status.usedInWindow).toBe(1);
  });

  it('no longer counts a day one day older than the window boundary (aged out)', () => {
    const asOf = '2026-08-05';
    const stops = [stop({ key: 'a', arrival: '2026-02-06', departure: '2026-02-06' })]; // asOf - 180 days
    const status = computeSchengenStatus(stops, asOf);
    expect(status.usedInWindow).toBe(0);
  });

  it('reports a full isolated stay correctly and projects the right remaining balance', () => {
    const asOf = '2026-08-05';
    const stops = [stop({ key: 'a', arrival: '2026-08-01', departure: '2026-08-05' })];
    const status = computeSchengenStatus(stops, asOf);
    expect(status.usedInWindow).toBe(5);
    expect(status.remaining).toBe(85);
  });
});

describe('computeSchengenStatus overstay projection', () => {
  it('flags the correct future date where cumulative days would exceed 90', () => {
    const asOf = '2026-01-01';
    // A single continuous 95-day Schengen stay starting today — the 91st day is the overstay point.
    const stops = [stop({ key: 'a', arrival: '2026-01-01', departure: '2026-04-05' })]; // 95 days inclusive
    const status = computeSchengenStatus(stops, asOf);
    expect(status.overstayDate).toBe('2026-04-05');
  });

  it('does not flag an overstay for a plan that stays within 90 days', () => {
    const asOf = '2026-01-01';
    const stops = [stop({ key: 'a', arrival: '2026-01-01', departure: '2026-03-31' })]; // 90 days inclusive
    const status = computeSchengenStatus(stops, asOf);
    expect(status.overstayDate).toBeNull();
  });
});

describe('currentStopLabel', () => {
  const base = { id: 1, key: 'parikia', name: 'Parikia', country: 'Greece', lat: 0, lon: 0, type: 'marina' as const, arrival: '2026-09-19', departure: '2026-09-22', duration: '3 days', distanceToNext: 0, season: 'fall' as const, phase: 'Greece', visited: true, actualArrival: '2026-09-19' };

  it('says "Here now" while there and recently arrived', () => {
    expect(currentStopLabel(base, '2026-09-25')).toBe('Here now');
  });
  it('still says "Here now" on the day you log your departure', () => {
    expect(currentStopLabel({ ...base, actualDeparture: '2026-09-23' }, '2026-09-23')).toBe('Here now');
  });
  it('switches to "Latest stop" once departed', () => {
    expect(currentStopLabel({ ...base, actualDeparture: '2026-09-22' }, '2026-09-23')).toBe('Latest stop');
  });
  it('switches to "Latest stop" after six days with no departure logged (e.g. long after the trip)', () => {
    expect(currentStopLabel(base, '2026-09-26')).toBe('Latest stop');
    expect(currentStopLabel(base, '2028-01-01')).toBe('Latest stop');
  });
  it('never calls a future-dated stop "Here now"', () => {
    expect(currentStopLabel({ ...base, actualArrival: '2026-11-01' }, '2026-10-06')).toBe('Latest stop');
  });
});

describe('formatStay', () => {
  const s = { id: 1, key: 'p', name: 'P', country: 'Greece', lat: 0, lon: 0, type: 'marina' as const, arrival: '2026-09-19', departure: '2026-09-22', duration: '3 days', distanceToNext: 0, season: 'fall' as const, phase: 'Greece', visited: true, actualArrival: '2026-09-19' };

  it('is open-ended for the current stop with no departure logged (not the stale planned date)', () => {
    expect(formatStay(s, true)).toBe('2026-09-19 →');
  });
  it('shows the full range once a departure is logged', () => {
    expect(formatStay({ ...s, actualDeparture: '2026-10-08' }, true)).toBe('2026-09-19 → 2026-10-08');
  });
  it('shows the full range for past stops', () => {
    expect(formatStay(s, false)).toBe('2026-09-19 → 2026-09-22');
  });
});

describe('Schengen counting reflects what actually happened', () => {
  it('ignores past dates of a stop explicitly marked not visited (skipped)', () => {
    const stops = [stop({ key: 'skipped', arrival: '2026-09-01', departure: '2026-09-10', visited: false })];
    expect(computeSchengenStatus(stops, '2026-10-06').usedInWindow).toBe(0);
  });

  it('counts the current stay through today when no departure is logged', () => {
    const stops = [stop({ key: 'paros', arrival: '2026-09-19', departure: '2026-09-22', visited: true, actualArrival: '2026-09-19' })];
    // Sep 19 .. Oct 6 inclusive = 18 days, not the planned 4
    expect(computeSchengenStatus(stops, '2026-10-06').usedInWindow).toBe(18);
  });

  it('reports an overstay that has already started instead of "within the limit"', () => {
    const stops = [stop({ key: 'long', arrival: '2026-06-01', departure: '2026-06-01', visited: true, actualArrival: '2026-06-01' })];
    // Open stay from Jun 1 to Oct 6 = 128 days > 90; day 91 is Aug 30
    const status = computeSchengenStatus(stops, '2026-10-06');
    expect(status.usedInWindow).toBeGreaterThan(90);
    expect(status.overstayDate).toBe('2026-08-30');
  });
});

describe('sailedTrack', () => {
  it('connects visited stops in order through their routing waypoints, ignoring planned stops', () => {
    const stops = [
      stop({ key: 'a', lat: 1, lon: 1, visited: true, routeWaypoints: [[1.5, 1.5]] }),
      stop({ key: 'b', lat: 2, lon: 2, visited: true, routeWaypoints: [[2.5, 2.5]] }),
      stop({ key: 'c', lat: 3, lon: 3, visited: false }),
    ];
    // b's waypoints lead to the (unvisited) next stop, so they're not part of the sailed track
    expect(sailedTrack(stops)).toEqual([[1, 1], [1.5, 1.5], [2, 2]]);
  });
});
