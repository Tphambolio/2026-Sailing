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

// How long after arriving a stop can still be called "Here now" without a
// logged departure. Past that (or once departed) it's just the latest stop —
// so the label still reads correctly after the trip is over.
const HERE_NOW_MAX_DAYS = 6;

/**
 * Label for the trip's current/most recent stop: "Here now" only while it's
 * plausibly live (arrived within the last 6 days, not yet departed), otherwise "Latest stop".
 */
export function currentStopLabel(stop: Stop, today: string = todayISO()): 'Here now' | 'Latest stop' {
  if (stop.actualDeparture && stop.actualDeparture < today) return 'Latest stop';
  const arrived = effectiveArrival(stop);
  if (!arrived || arrived > today) return 'Latest stop';
  return daysBetween(arrived, today) <= HERE_NOW_MAX_DAYS ? 'Here now' : 'Latest stop';
}

/**
 * "19 Sep → 22 Sep" for a stay; for the stop you're at now with no departure
 * logged yet, an open-ended "19 Sep →" rather than the stale planned date.
 */
export function formatStay(stop: Stop, isCurrent = false, fmt: (iso: string) => string = (d) => d): string {
  const arrival = effectiveArrival(stop);
  if (!arrival) return '';
  if (isCurrent && stop.visited && !stop.actualDeparture) return `${fmt(arrival)} →`;
  const departure = effectiveDeparture(stop);
  return departure && departure !== arrival ? `${fmt(arrival)} → ${fmt(departure)}` : fmt(arrival);
}

/**
 * The track actually sailed: visited stops in order, following each stop's
 * stored routeWaypoints (points between it and the next stop) so the line goes
 * around headlands. Planned stops are pins only — the full planned route lines
 * were removed earlier on purpose.
 */
export function sailedTrack(stops: Stop[]): [number, number][] {
  const visited = stops.filter(s => s.visited);
  const path: [number, number][] = [];
  visited.forEach((s, i) => {
    path.push([s.lat, s.lon]);
    if (i < visited.length - 1 && s.routeWaypoints?.length) path.push(...s.routeWaypoints);
  });
  return path;
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Schengen stay ranges (effective/actual-if-logged dates) for every Schengen stop on the route.
 */
export function buildSchengenRanges(stops: Stop[], asOf: string = todayISO()): DateRange[] {
  // The stay you're in right now: the latest visited stop with no departure
  // logged counts through today, not to its stale planned departure date.
  let lastVisited = -1;
  stops.forEach((s, i) => { if (s.visited) lastVisited = i; });

  const ranges: DateRange[] = [];
  stops.forEach((s, i) => {
    if (NON_SCHENGEN.includes(s.country)) return;
    let start = effectiveArrival(s);
    let end = effectiveDeparture(s);
    if (!start || !end) return;
    if (s.visited === false) {
      // A stop explicitly not visited: its past dates are a plan that didn't
      // happen (skipped, or the trip ran differently) — only count the future.
      if (end < asOf) return;
      if (start < asOf) start = asOf;
    }
    if (i === lastVisited && !s.actualDeparture && s.actualArrival && end < asOf) end = asOf;
    ranges.push({ start, end });
  });
  return ranges;
}

/** Rolling 180-day Schengen count as of `date` (inclusive window). */
export function rollingSchengenDays(ranges: DateRange[], date: string): number {
  return schengenDaysInRange(ranges, addDays(date, -179), date);
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
/** Rolling 90/180 count at each Schengen stop's (effective) departure, for the per-stop badges. */
export function schengenByStop(stops: Stop[], asOf: string = todayISO()): Map<number, { days: number; rolling: number; isPaused: boolean }> {
  const ranges = buildSchengenRanges(stops, asOf);
  const out = new Map<number, { days: number; rolling: number; isPaused: boolean }>();
  for (const s of stops) {
    const arrival = effectiveArrival(s);
    const departure = effectiveDeparture(s);
    if (!arrival) { out.set(s.id, { days: 0, rolling: 0, isPaused: true }); continue; }
    out.set(s.id, {
      days: departure ? daysBetween(arrival, departure) : 0,
      rolling: rollingSchengenDays(ranges, departure || arrival),
      isPaused: NON_SCHENGEN.includes(s.country),
    });
  }
  return out;
}

export function computeSchengenStatus(stops: Stop[], asOf: string = todayISO()): SchengenStatus {
  const ranges = buildSchengenRanges(stops, asOf);
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

  // Already over? Report the first day in the current window the count went past
  // 90 — previously only future departures were checked, so an overstay that had
  // already begun vanished and the plan read as "within the limit".
  let overstayDate: string | null = null;
  if (usedInWindow > 90) {
    for (let d = windowStart; d <= asOf; d = addDays(d, 1)) {
      if (rollingSchengenDays(ranges, d) > 90) { overstayDate = d; break; }
    }
    return { usedInWindow, remaining, windowStart, nextFreeDate, overstayDate };
  }

  // Forward projection: check the rolling count as of each future Schengen stop's departure
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
  const schengenDaysByYear: Record<number, number> = {};
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
