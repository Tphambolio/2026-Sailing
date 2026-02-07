/**
 * Auto-enrichment service for new stops
 * Uses Wikipedia Geosearch API + Google Maps URL construction
 * All APIs are free, CORS-friendly, no keys needed
 */

export interface EnrichmentData {
  wikiUrl?: string;
  cultureHighlight?: string;
  cultureUrl?: string;
  foodUrl?: string;
  adventureUrl?: string;
  provisionsUrl?: string;
}

/**
 * Auto-enrich a stop with Wikipedia info and Google Maps search URLs.
 * Google Maps URLs are deterministic (no API call).
 * Wikipedia calls may fail gracefully — the Maps URLs still populate.
 */
export async function enrichStop(
  lat: number,
  lon: number,
  name: string
): Promise<EnrichmentData> {
  const result: EnrichmentData = {};
  const encodedName = encodeURIComponent(name);

  // 1. Google Maps search URLs (synchronous, always works)
  result.foodUrl = `https://www.google.com/maps/search/restaurants+in+${encodedName}/`;
  result.adventureUrl = `https://www.google.com/maps/search/things+to+do+in+${encodedName}/`;
  result.provisionsUrl = `https://www.google.com/maps/search/supermarkets+near+${encodedName}/`;

  // 2. Wikipedia Geosearch (find nearest article by coordinates)
  try {
    const geoParams = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${lat}|${lon}`,
      gsradius: '10000',
      gslimit: '1',
      format: 'json',
      origin: '*',
    });

    const geoResponse = await fetch(
      `https://en.wikipedia.org/w/api.php?${geoParams}`
    );

    if (!geoResponse.ok) throw new Error('Wikipedia geosearch failed');

    const geoData = await geoResponse.json();

    if (geoData.query?.geosearch?.length > 0) {
      const pageTitle = geoData.query.geosearch[0].title;
      result.wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;
      result.cultureUrl = result.wikiUrl;

      // 3. Get summary extract via RESTBase API
      const summaryResponse = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
      );

      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        if (summaryData.extract) {
          const firstSentence = summaryData.extract.split('.')[0] + '.';
          result.cultureHighlight =
            firstSentence.length > 120
              ? firstSentence.substring(0, 117) + '...'
              : firstSentence;
        }
      }
    }
  } catch (err) {
    console.warn('Wikipedia enrichment failed:', err);
    // Non-critical: Google Maps URLs still work
  }

  return result;
}
