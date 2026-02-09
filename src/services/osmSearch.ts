/**
 * OSM-based marina and anchorage search
 * Uses Nominatim for geocoding and Overpass API for finding marinas/anchorages
 * Both APIs are free, no API key needed
 */

export interface OsmSearchResult {
  id: number;
  name: string;
  lat: number;
  lon: number;
  type: 'marina' | 'anchorage';
  website?: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'MediterraneanOdyssey/1.0';

// Rate limit: Nominatim requires max 1 req/sec
let lastNominatimRequest = 0;

async function nominatimThrottle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastNominatimRequest;
  if (elapsed < 1100) {
    await new Promise(resolve => setTimeout(resolve, 1100 - elapsed));
  }
  lastNominatimRequest = Date.now();
}

/**
 * Geocode a town name to lat/lon using Nominatim.
 * Biased to the Mediterranean region.
 */
export async function geocodeTown(
  query: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
  await nominatimThrottle();

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    viewbox: '5.0,30.0,36.0,46.0',
    bounded: '1',
  });

  const response = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) throw new Error(`Nominatim error: ${response.status}`);

  const results = await response.json();
  if (results.length === 0) return null;

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

/**
 * Search for marinas and anchorages near a point using Overpass API.
 * Queries OSM tags: leisure=marina, seamark:type=anchorage, seamark:type=harbour
 */
export async function searchMarinasNear(
  lat: number,
  lon: number,
  radiusKm: number = 15
): Promise<OsmSearchResult[]> {
  const radiusM = radiusKm * 1000;

  const query = `
    [out:json][timeout:25];
    (
      node["leisure"="marina"](around:${radiusM},${lat},${lon});
      way["leisure"="marina"](around:${radiusM},${lat},${lon});
      node["seamark:type"="anchorage"](around:${radiusM},${lat},${lon});
      way["seamark:type"="anchorage"](around:${radiusM},${lat},${lon});
      node["seamark:type"="harbour"](around:${radiusM},${lat},${lon});
      way["seamark:type"="harbour"](around:${radiusM},${lat},${lon});
    );
    out center;
  `;

  let response: Response | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (response.ok) break;
    } catch {
      continue;
    }
  }

  if (!response?.ok) throw new Error(`Overpass error: ${response?.status ?? 'all endpoints failed'}`);

  const data = await response.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.elements
    .map((el: any) => ({
      id: el.id,
      name: el.tags?.name || el.tags?.['seamark:name'] || 'Unnamed',
      lat: el.lat || el.center?.lat,
      lon: el.lon || el.center?.lon,
      type:
        el.tags?.leisure === 'marina' || el.tags?.['seamark:type'] === 'harbour'
          ? ('marina' as const)
          : ('anchorage' as const),
      website: el.tags?.website || el.tags?.['contact:website'] || undefined,
    }))
    .filter((r: OsmSearchResult) => r.lat && r.lon);
}
