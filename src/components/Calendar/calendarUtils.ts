import type { Stop, Phase } from '../../types';

// Get the first day of a month
export function getFirstDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

// Get the last day of a month
export function getLastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

// Get all days to display in a calendar grid (including padding days from prev/next months)
export function getCalendarDays(year: number, month: number): Date[] {
  const firstDay = getFirstDayOfMonth(year, month);
  const lastDay = getLastDayOfMonth(year, month);

  // Get the day of week for the first day (0 = Sunday, 1 = Monday, etc.)
  // Adjust so Monday = 0
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek < 0) startDayOfWeek = 6;

  const days: Date[] = [];

  // Add padding days from previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    days.push(date);
  }

  // Add all days of current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  // Add padding days to complete the last week
  const remainingDays = 7 - (days.length % 7);
  if (remainingDays < 7) {
    for (let i = 1; i <= remainingDays; i++) {
      days.push(new Date(year, month + 1, i));
    }
  }

  return days;
}

// Check if a date falls within a stop's stay
export function isDateInStay(date: Date, stop: Stop): boolean {
  const arrival = new Date(stop.arrival);
  const departure = new Date(stop.departure);

  // Reset time parts for comparison
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const a = new Date(arrival.getFullYear(), arrival.getMonth(), arrival.getDate());
  const dep = new Date(departure.getFullYear(), departure.getMonth(), departure.getDate());

  return d >= a && d <= dep;
}

// Get all stops that overlap with a given month
export function getStopsInMonth(stops: Stop[], year: number, month: number): Stop[] {
  const monthStart = getFirstDayOfMonth(year, month);
  const monthEnd = getLastDayOfMonth(year, month);

  return stops.filter((stop) => {
    const arrival = new Date(stop.arrival);
    const departure = new Date(stop.departure);

    // Stop overlaps if it starts before month ends AND ends after month starts
    return arrival <= monthEnd && departure >= monthStart;
  });
}

// Segment represents a portion of a stay that fits within a calendar row
export interface StaySegment {
  stop: Stop;
  startCol: number; // 0-6 (day of week)
  rowIndex: number; // which week row
  spanDays: number; // how many days this segment spans
  isStart: boolean; // is this the start of the stay?
  isEnd: boolean; // is this the end of the stay?
}

// Split a stop's stay into row segments for the calendar
export function getStaySegments(
  stop: Stop,
  _year: number,
  month: number,
  calendarDays: Date[]
): StaySegment[] {
  const segments: StaySegment[] = [];
  const arrival = new Date(stop.arrival);
  const departure = new Date(stop.departure);

  // Find which calendar days fall within this stay
  const stayDayIndices: number[] = [];
  calendarDays.forEach((day, index) => {
    if (isDateInStay(day, stop) && day.getMonth() === month) {
      stayDayIndices.push(index);
    }
  });

  if (stayDayIndices.length === 0) return segments;

  // Group consecutive indices into row segments
  let currentSegmentStart = stayDayIndices[0];
  let currentSegmentEnd = stayDayIndices[0];

  for (let i = 1; i <= stayDayIndices.length; i++) {
    const idx = stayDayIndices[i];
    const prevIdx = stayDayIndices[i - 1];

    // Check if we need to break (new week row or end of array)
    const currentRow = Math.floor(prevIdx / 7);
    const nextRow = idx !== undefined ? Math.floor(idx / 7) : -1;

    if (idx === undefined || nextRow !== currentRow || idx !== prevIdx + 1) {
      // Create segment for the current group
      const startCol = currentSegmentStart % 7;
      const rowIndex = Math.floor(currentSegmentStart / 7);
      const spanDays = currentSegmentEnd - currentSegmentStart + 1;

      // Check if this segment contains the actual start/end of the stay
      const segmentStartDate = calendarDays[currentSegmentStart];
      const segmentEndDate = calendarDays[currentSegmentEnd];

      const isStart =
        segmentStartDate.getFullYear() === arrival.getFullYear() &&
        segmentStartDate.getMonth() === arrival.getMonth() &&
        segmentStartDate.getDate() === arrival.getDate();

      const isEnd =
        segmentEndDate.getFullYear() === departure.getFullYear() &&
        segmentEndDate.getMonth() === departure.getMonth() &&
        segmentEndDate.getDate() === departure.getDate();

      segments.push({
        stop,
        startCol,
        rowIndex,
        spanDays,
        isStart,
        isEnd,
      });

      // Start new segment if there are more days
      if (idx !== undefined) {
        currentSegmentStart = idx;
        currentSegmentEnd = idx;
      }
    } else {
      currentSegmentEnd = idx;
    }
  }

  return segments;
}

// Get color for a country
export function getCountryColor(country: string, phases: Phase[]): string {
  const phase = phases.find((p) => p.name === country);
  return phase?.color || '#6b7280'; // gray fallback
}

// Format month name
export function formatMonthYear(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Get trip date range
export function getTripMonths(): { year: number; month: number }[] {
  // Trip is July 2026 - April 2027
  const months: { year: number; month: number }[] = [];

  // July 2026 to December 2026
  for (let m = 6; m <= 11; m++) {
    months.push({ year: 2026, month: m });
  }

  // January 2027 to April 2027
  for (let m = 0; m <= 3; m++) {
    months.push({ year: 2027, month: m });
  }

  return months;
}

// Check if a date is today
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

// Day names starting from Monday
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
