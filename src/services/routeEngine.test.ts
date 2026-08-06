import { describe, it, expect } from 'vitest';
import { schengenDaysInRange, computeSchengenStatus, type DateRange } from './routeEngine';
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
