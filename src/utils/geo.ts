// Geographic and date utilities for Mediterranean Odyssey

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Haversine formula — distance between two lat/lon points in kilometers
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert kilometers to nautical miles
 */
export function kmToNm(km: number): number {
  return km * 0.539957;
}

/**
 * Calculate days between two ISO date strings (YYYY-MM-DD)
 */
export function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);
  return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Add days to an ISO date string, returns new ISO date string
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a duration string like "3 days" or "7 days" into a number
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Format a duration number back to a string like "3 days"
 */
export function formatDuration(days: number): string {
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Format ISO date string to display format (YYYY-MM-DD → "15 Jul")
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * Determine season from an ISO date string
 */
export function seasonFromDate(dateStr: string): 'summer' | 'fall' | 'winter' {
  if (!dateStr) return 'summer';
  const month = parseInt(dateStr.split('-')[1], 10);
  if (month >= 7 && month <= 9) return 'summer';
  if (month >= 10 && month <= 11) return 'fall';
  return 'winter'; // Dec-Jun (winter for sailing context: Dec-Apr, with May-Jun as transition)
}

/**
 * Get the year from an ISO date string
 */
export function getYear(dateStr: string): number {
  return parseInt(dateStr.split('-')[0], 10);
}
