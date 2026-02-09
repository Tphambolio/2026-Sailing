const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

const URL_FIELDS = ['marinaUrl', 'cultureUrl', 'wikiUrl', 'foodUrl', 'adventureUrl', 'provisionsUrl'];

// Collect all URLs
const urls = [];
for (const stop of stops) {
  for (const field of URL_FIELDS) {
    if (stop[field]) {
      urls.push({ stop: stop.name, field, url: stop[field] });
    }
  }
}

console.log(`Checking ${urls.length} URLs across ${stops.length} stops...\n`);

// Rate limit to avoid getting blocked
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function checkUrl(entry) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(entry.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'MedOdyssey-LinkChecker/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return { ...entry, status: res.status, ok: res.ok };
  } catch (err) {
    // Try GET if HEAD fails (some servers reject HEAD)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(entry.url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'MedOdyssey-LinkChecker/1.0' },
        redirect: 'follow',
      });
      clearTimeout(timeout);
      return { ...entry, status: res.status, ok: res.ok };
    } catch (err2) {
      return { ...entry, status: err2.code || err2.message || 'FAILED', ok: false };
    }
  }
}

async function main() {
  // Deduplicate URLs
  const seen = new Set();
  const unique = [];
  for (const entry of urls) {
    if (!seen.has(entry.url)) {
      seen.add(entry.url);
      unique.push(entry);
    }
  }
  console.log(`${unique.length} unique URLs to check\n`);

  const broken = [];
  let checked = 0;

  // Check in batches of 5
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const results = await Promise.all(batch.map(checkUrl));
    for (const r of results) {
      checked++;
      if (!r.ok) {
        broken.push(r);
        console.log(`  ✗ [${r.status}] ${r.stop} → ${r.field}: ${r.url}`);
      }
    }
    if (checked % 25 === 0) console.log(`  ... checked ${checked}/${unique.length}`);
    await delay(500);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Checked: ${checked} unique URLs`);
  console.log(`Broken: ${broken.length}`);

  if (broken.length > 0) {
    console.log(`\nBroken links:`);
    for (const b of broken) {
      console.log(`  ${b.stop} | ${b.field} | ${b.status} | ${b.url}`);
    }
  }

  // Also find which stops reference each broken URL (including duplicates)
  if (broken.length > 0) {
    const brokenUrls = new Set(broken.map(b => b.url));
    console.log(`\nAll stops affected:`);
    for (const stop of stops) {
      for (const field of URL_FIELDS) {
        if (stop[field] && brokenUrls.has(stop[field])) {
          console.log(`  ${stop.id}. ${stop.name} → ${field}: ${stop[field]}`);
        }
      }
    }
  }
}

main().catch(console.error);
