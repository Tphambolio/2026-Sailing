// Route engine — auto-heal, phases, and stats computation

import type { Stop, Phase, TripStats } from '../types';
import { NON_SCHENGEN, COUNTRY_COLORS } from '../data/constants';
import { haversine, addDays, parseDuration, formatDuration, daysBetween, seasonFromDate, getYear } from '../utils/geo';

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
    if (stop.arrival && stop.departure) {
      entry.days += daysBetween(stop.arrival, stop.departure);
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

  const firstArrival = stops[0].arrival;
  const lastDeparture = stops[stops.length - 1].departure;
  const totalDays = firstArrival && lastDeparture ? daysBetween(firstArrival, lastDeparture) : 0;

  // Sailing days = stops that transition to the next stop (have distance > 0)
  const sailingDays = stops.filter(s => s.distanceToNext > 0).length;

  // Sum stay days per stop
  let totalStayDays = 0;
  let extendedStayDays = 0;
  let schengenDaysByYear: Record<number, number> = {};
  let totalSchengenDays = 0;

  stops.forEach(stop => {
    if (!stop.arrival || !stop.departure) return;
    const stayDays = daysBetween(stop.arrival, stop.departure);
    totalStayDays += stayDays;

    if (stayDays > 2) {
      extendedStayDays += stayDays;
    }

    // Schengen tracking
    const isSchengen = !NON_SCHENGEN.includes(stop.country);
    if (isSchengen) {
      totalSchengenDays += stayDays;
      const year = getYear(stop.arrival);
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
