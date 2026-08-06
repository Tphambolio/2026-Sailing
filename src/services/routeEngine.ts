// Route engine — auto-heal, phases, and stats computation

import type { Stop, Phase, TripStats, SchengenStatus } from '../types';
import { NON_SCHENGEN, COUNTRY_COLORS } from '../data/constants';
import { haversine, addDays, parseDuration, formatDuration, daysBetween, seasonFromDate, getYear, todayISO } from '../utils/geo';

/**
 * The date a stop was actually arrived at, falling back to the planned date.
 */
export function effectiveArrival(stop: Stop): string {
  return stop.actualArrival || stop.arrival;
}

/**
 * The date a stop was actually departed from, falling back to the planned date.
 */
export function effectiveDeparture(stop: Stop): string {
  return stop.actualDeparture || stop.departure;
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Schengen stay ranges (effective/actual-if-logged dates) for every Schengen stop on the route.
 */
export function buildSchengenRanges(stops: Stop[]): DateRange[] {
  return stops
    .filter(s => !NON_SCHENGEN.includes(s.country))
    .map(s => ({ start: effectiveArrival(s), end: effectiveDeparture(s) }))
    .filter(r => r.start && r.end);
}

/**
 * Every calendar date from `start` to `end`, inclusive, as ISO strings.
 */
function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

/**
 * Count Schengen days across a set of ranges that fall within [windowStart, windowEnd],
 * all inclusive. Per the EU rule, the entry day and the exit day both count as a full
 * day spent in the territory. Ranges are deduplicated by calendar date so that two
 * directly-adjacent stops (one's departure day is the next one's arrival day) don't
 * double-count that shared day.
 * ISO date strings compare correctly with plain string comparison.
 */
export function schengenDaysInRange(ranges: DateRange[], windowStart: string, windowEnd: string): number {
  const days = new Set<string>();
  ranges.forEach(r => {
    const start = r.start < windowStart ? windowStart : r.start;
    const end = r.end > windowEnd ? windowEnd : r.end;
    if (start > end) return;
    datesInRange(start, end).forEach(d => days.add(d));
  });
  return days.size;
}

/**
 * Accurate 90/180 Schengen status as of a reference date (defaults to today).
 * - usedInWindow only counts days that have actually elapsed by `asOf`.
 * - overstayDate projects forward through the remaining planned/actual itinerary and
 *   flags the first future date where the rolling 180-day count would exceed 90.
 */
export function computeSchengenStatus(stops: Stop[], asOf: string = todayISO()): SchengenStatus {
  const ranges = buildSchengenRanges(stops);
  // A "180-day period" is 180 calendar days including the reference day itself,
  // i.e. [asOf - 179, asOf] — not asOf - 180, which would span 181 days.
  const windowStart = addDays(asOf, -179);
  const usedInWindow = schengenDaysInRange(ranges, windowStart, asOf);
  const remaining = Math.max(0, 90 - usedInWindow);

  // Earliest day still counted in the current window — once it ages out (180 days later), a day frees up
  let earliestCounted: string | null = null;
  ranges.forEach(r => {
    const start = r.start < windowStart ? windowStart : r.start;
    const end = r.end > asOf ? asOf : r.end;
    if (start <= end && (!earliestCounted || start < earliestCounted)) earliestCounted = start;
  });
  const nextFreeDate = earliestCounted ? addDays(earliestCounted, 180) : null;

  // Forward projection: check the rolling count as of each future Schengen stop's departure
  let overstayDate: string | null = null;
  for (const stop of stops) {
    if (NON_SCHENGEN.includes(stop.country)) continue;
    const departure = effectiveDeparture(stop);
    if (!departure || departure <= asOf) continue;
    const wStart = addDays(departure, -179);
    const rolling = schengenDaysInRange(ranges, wStart, departure);
    if (rolling > 90) {
      overstayDate = departure;
      break;
    }
  }

  return { usedInWindow, remaining, windowStart, nextFreeDate, overstayDate };
}

/**
 * Auto-heal the entire route after any edit.
 * Cascades dates from the first stop, recomputes distances, seasons, and IDs.
 * Preserves user-set fields: name, country, lat, lon, type, duration, notes, URLs, routeWaypoints.
 */
export function healRoute(stops: Stop[]): Stop[] {
  if (stops.length === 0) return [];

  const healed: Stop[] = [];

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const prev = i > 0 ? healed[i - 1] : null;

    // Cascade arrival from previous stop's departure (first stop keeps its arrival)
    const arrival = prev ? prev.departure : stop.arrival;

    // Compute departure from arrival + duration
    const durationDays = parseDuration(stop.duration);
    const departure = addDays(arrival, durationDays);

    // Distance to next stop (Haversine from coordinates)
    const distanceToNext = i < stops.length - 1
      ? Math.round(haversine(stop.lat, stop.lon, stops[i + 1].lat, stops[i + 1].lon) * 10) / 10
      : 0;

    healed.push({
      ...stop,
      id: i + 1,
      arrival,
      departure,
      duration: stop.duration || formatDuration(durationDays),
      distanceToNext,
      season: seasonFromDate(arrival),
      phase: stop.country, // phase = country
    });
  }

  return healed;
}

/**
 * Compute country-based phases from the stops array.
 * Groups consecutive stops by country, preserving route order.
 */
export function computePhases(stops: Stop[]): Phase[] {
  const countryMap = new Map<string, { stops: number; days: number }>();
  const countryOrder: string[] = [];

  stops.forEach(stop => {
    if (!countryOrder.includes(stop.country)) {
      countryOrder.push(stop.country);
    }

    const entry = countryMap.get(stop.country) || { stops: 0, days: 0 };
    entry.stops += 1;
    const arrival = effectiveArrival(stop);
    const departure = effectiveDeparture(stop);
    if (arrival && departure) {
      entry.days += daysBetween(arrival, departure);
    }
    countryMap.set(stop.country, entry);
  });

  return countryOrder.map((country, i) => {
    const data = countryMap.get(country)!;
    return {
      id: `country-${i + 1}`,
      name: country,
      stops: data.stops,
      days: data.days,
      schengen: !NON_SCHENGEN.includes(country),
      color: COUNTRY_COLORS[country] || '#6b7280',
    };
  });
}

/**
 * Compute trip statistics from the stops array.
 */
export function computeStats(stops: Stop[]): TripStats {
  if (stops.length === 0) {
    return { totalDays: 0, sailingDays: 0, restDays: 0, extendedStayDays: 0, totalSchengenDays: 0, schengen2026: 0, schengen2027: 0 };
  }

  const firstArrival = effectiveArrival(stops[0]);
  const lastDeparture = effectiveDeparture(stops[stops.length - 1]);
  const totalDays = firstArrival && lastDeparture ? daysBetween(firstArrival, lastDeparture) : 0;

  // Sailing days = stops that transition to the next stop (have distance > 0)
  const sailingDays = stops.filter(s => s.distanceToNext > 0).length;

  // Sum stay days per stop
  let totalStayDays = 0;
  let extendedStayDays = 0;
  let schengenDaysByYear: Record<number, number> = {};
  let totalSchengenDays = 0;

  stops.forEach(stop => {
    const arrival = effectiveArrival(stop);
    const departure = effectiveDeparture(stop);
    if (!arrival || !departure) return;
    const stayDays = daysBetween(arrival, departure);
    totalStayDays += stayDays;

    if (stayDays > 2) {
      extendedStayDays += stayDays;
    }

    // Schengen tracking
    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    if (isSchengen) {
      totalSchengenDays += stayDays;
      const year = getYear(arrival);
      schengenDaysByYear[year] = (schengenDaysByYear[year] || 0) + stayDays;
    }
  });

  const restDays = totalDays - totalStayDays;

  return {
    totalDays,
    sailingDays,
    restDays: Math.max(0, restDays),
    extendedStayDays,
    totalSchengenDays,
    schengen2026: schengenDaysByYear[2026] || 0,
    schengen2027: schengenDaysByYear[2027] || 0,
  };
}

/**
 * Insert a new stop after a given index. Returns the new stops array (not yet healed).
 */
export function insertStop(stops: Stop[], afterIndex: number, newStop: Partial<Stop>): Stop[] {
  const defaultStop: Stop = {
    id: 0,
    key: `new-stop-${Date.now().toString(36)}`,
    name: 'New Stop',
    country: '',
    lat: 0,
    lon: 0,
    type: 'anchorage',
    arrival: '',
    departure: '',
    duration: '3 days',
    distanceToNext: 0,
    season: 'summer',
    phase: '',
    ...newStop,  // Spread ALL provided fields (enrichment, marina, etc.)
  };

  const result = [...stops];
  result.splice(afterIndex + 1, 0, defaultStop);
  return result;
}

/**
 * Remove a stop at a given index. Returns the new stops array (not yet healed).
 */
export function removeStop(stops: Stop[], index: number): Stop[] {
  const result = [...stops];
  result.splice(index, 1);
  return result;
}

/**
 * Update a stop at a given index with partial data. Returns the new stops array (not yet healed).
 */
export function updateStop(stops: Stop[], index: number, updates: Partial<Stop>): Stop[] {
  const result = [...stops];
  result[index] = { ...result[index], ...updates };
  return result;
}
