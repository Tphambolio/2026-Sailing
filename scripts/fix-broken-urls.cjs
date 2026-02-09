/**
 * Fix all broken URLs found by check-links.cjs
 * Sources: greeka.com, wikivoyage, corrected Wikipedia/CruisersWiki/Navily URLs
 */

const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// Map of exact old URL → new URL
const urlReplacements = {
  // ============================================================
  // VISITGREECE.GR → GREEKA.COM  (site restructured, all 404)
  // ============================================================

  // Corfu area
  'https://www.visitgreece.gr/islands/ionian/corfu/': 'https://www.greeka.com/ionian/corfu/eat-drink/',

  // Parga
  'https://www.visitgreece.gr/mainland/epirus/parga/': 'https://www.greeka.com/epirus/parga/eat-drink/',

  // Preveza
  'https://www.visitgreece.gr/mainland/epirus/preveza/': 'https://www.greeka.com/epirus/preveza/',

  // Lefkada
  'https://www.visitgreece.gr/islands/ionian-islands/lefkas/': 'https://www.greeka.com/ionian/lefkada/sightseeing/',
  'https://www.visitgreece.gr/islands/ionian/lefkada/': 'https://www.greeka.com/ionian/lefkada/eat-drink/',

  // Kefalonia
  'https://www.visitgreece.gr/islands/ionian/kefalonia/': 'https://www.greeka.com/ionian/kefalonia/eat-drink/',

  // Messolonghi
  'https://www.visitgreece.gr/mainland/western-greece/messolonghi/': 'https://www.greeka.com/sterea/mesolongi/',

  // Patras
  'https://www.visitgreece.gr/mainland/peloponnese/patras/': 'https://www.greeka.com/peloponnese/patra/eat-drink/',

  // Corinth
  'https://www.visitgreece.gr/mainland/peloponnese/corinth/': 'https://en.wikipedia.org/wiki/Corinth_Canal',

  // Saronic Islands
  'https://www.visitgreece.gr/islands/saronic-islands/aegina/': 'https://www.greeka.com/saronic/aegina/eat-drink/',
  'https://www.visitgreece.gr/islands/saronic-islands/poros/': 'https://www.greeka.com/saronic/poros/eat-drink/',
  'https://www.visitgreece.gr/islands/saronic-islands/hydra/': 'https://www.greeka.com/saronic/hydra/eat-drink/',
  'https://www.visitgreece.gr/islands/saronic-islands/spetses/': 'https://www.greeka.com/saronic/spetses/eat-drink/',

  // Cape Sounion
  'https://www.visitgreece.gr/mainland/attica/cape-sounio/': 'https://www.greeka.com/attica/athens/sightseeing/sounio-poseidon-temple/',

  // Cyclades
  'https://www.visitgreece.gr/islands/cyclades/syros/': 'https://www.greeka.com/cyclades/syros/things-to-do/',
  'https://www.visitgreece.gr/islands/cyclades/mykonos/': 'https://www.greeka.com/cyclades/mykonos/eat-drink/',
  'https://www.visitgreece.gr/islands/cyclades/naxos/': 'https://www.greeka.com/cyclades/naxos/eat-drink/',
  'https://www.visitgreece.gr/islands/cyclades/paros/': 'https://www.greeka.com/cyclades/paros/eat-drink/',
  'https://www.visitgreece.gr/islands/cyclades/amorgos/': 'https://www.greeka.com/cyclades/amorgos/eat-drink/',

  // Dodecanese
  'https://www.visitgreece.gr/islands/dodecanese/astypalaia/': 'https://www.greeka.com/dodecanese/astypalaia/eat-drink/',
  'https://www.visitgreece.gr/islands/dodecanese/kos/': 'https://www.greeka.com/dodecanese/kos/things-to-do/',
  'https://www.visitgreece.gr/islands/dodecanese/castellorizo/': 'https://en.wikipedia.org/wiki/Kastellorizo',
  'https://www.visitgreece.gr/islands/dodecanese/karpathos/': 'https://www.greeka.com/dodecanese/karpathos/eat-drink/',
  'https://www.visitgreece.gr/islands/dodecanese/kasos/': 'https://www.greeka.com/dodecanese/kasos/',

  // Ionian return
  'https://www.visitgreece.gr/islands/ionian/zakynthos/': 'https://www.greeka.com/ionian/zakynthos/eat-drink/',
  'https://www.visitgreece.gr/islands/ionian/paxoi/': 'https://www.greeka.com/ionian/paxi/eat-drink/restaurants/',

  // Peloponnese
  'https://www.visitgreece.gr/mainland/peloponnese/kalamata/': 'https://www.greeka.com/peloponnese/kalamata/',

  // ============================================================
  // WIKIPEDIA (wrong article names)
  // ============================================================
  'https://en.wikipedia.org/wiki/Rose,_Montenegro': 'https://en.wikipedia.org/wiki/Lu%C5%A1tica',
  'https://en.wikipedia.org/wiki/Panagia_Hozoviotissa': 'https://en.wikipedia.org/wiki/Panagia_Hozoviotissa_Monastery',
  'https://en.wikipedia.org/wiki/Chalki_(Greece)': 'https://en.wikipedia.org/wiki/Halki_(Greece)',
  'https://en.wikipedia.org/wiki/Akamas_peninsula': 'https://en.wikipedia.org/wiki/Akamas',

  // ============================================================
  // CRUISERSWIKI (wrong page names)
  // ============================================================
  'https://www.cruiserswiki.org/wiki/Side': 'https://www.cruiserswiki.org/wiki/Turkey',
  'https://www.cruiserswiki.org/wiki/Latchi': 'https://www.cruiserswiki.org/wiki/Cyprus',
  'https://www.cruiserswiki.org/wiki/Agios_Nikolaos': 'https://www.cruiserswiki.org/wiki/Ayios_Nikolaos',
  'https://www.cruiserswiki.org/wiki/Iraklion': 'https://www.cruiserswiki.org/wiki/Iraklio',
  'https://www.cruiserswiki.org/wiki/Khania': 'https://www.cruiserswiki.org/wiki/Chania',
  'https://www.cruiserswiki.org/wiki/Kithira': 'https://www.cruiserswiki.org/wiki/Cythera',
  'https://www.cruiserswiki.org/wiki/Gythion': 'https://www.cruiserswiki.org/wiki/South_Peloponnese',
  'https://www.cruiserswiki.org/wiki/Othoni': 'https://www.cruiserswiki.org/wiki/Cruising_the_Greek_Ionian_Sea',
  'https://www.cruiserswiki.org/wiki/Giardini_Naxos': 'https://www.cruiserswiki.org/wiki/Taormina',

  // ============================================================
  // NAVILY (changed URL structure/IDs)
  // ============================================================
  'https://www.navily.com/mouillage/fiskardo/1231': 'https://www.navily.com/mouillage/fiskardo/14497',
  'https://www.navily.com/mouillage/galaxidi/783': 'https://www.navily.com/port/galaxidhi/1469',
  'https://www.navily.com/port/korissia/3241': 'https://www.navily.com/mouillage/korissia/15311',
  'https://www.navily.com/mouillage/anamur/42962': 'https://www.navily.com/region/anamur/10880',
  'https://www.navily.com/port/halki/47487': 'https://www.navily.com/port/chalki/1964',
  'https://www.navily.com/port/fry-kasos/47496': 'https://www.navily.com/region/dodecanese/10535',
  'https://www.navily.com/mouillage/pylos/14498': 'https://www.navily.com/port/pilos-marina/1458',
  'https://www.navily.com/port/roccella-ionica/1020': 'https://www.navily.com/port/porto-delle-grazie-marina-di-roccella/858',
  'https://www.navily.com/port/giardini-naxos/1018': 'https://www.navily.com/port/marina-yachting-gsg-giardini-naxos-taormina/2124',
  'https://www.navily.com/port/siracusa-marina/1017': 'https://www.navily.com/port/marina-yachting-siracusa-ortigia/205',
  'https://www.navily.com/mouillage/durres/5f0df5faed6dc1001fb7bc90': 'https://www.navily.com/mouillage/durres/26261',

  // ============================================================
  // ALBANIA.AL (entire site down, 500 errors)
  // ============================================================
  'https://albania.al': 'https://en.wikivoyage.org/wiki/Sh%C3%ABngjin',
  'https://albania.al/destinations/durres/': 'https://en.wikivoyage.org/wiki/Durr%C3%ABs',
  'https://albania.al/destinations/vlora/': 'https://en.wikivoyage.org/wiki/Vlor%C3%AB',
};

// Special per-stop overrides where the same old URL maps to different new URLs
// depending on the field type (e.g. visitgreece.gr/corfu used for both foodUrl and provisionsUrl)
const fieldOverrides = {
  // Kontokali Bay provisionsUrl: general Corfu page instead of eat-drink
  '33|provisionsUrl': 'https://www.greeka.com/ionian/corfu/',

  // Lefkada: different URLs per field
  '36|foodUrl': 'https://www.greeka.com/ionian/lefkada/eat-drink/',
  '36|adventureUrl': 'https://www.greeka.com/ionian/lefkada/things-to-do/',
  '36|provisionsUrl': 'https://www.greeka.com/ionian/lefkada/',

  // Preveza: foodUrl gets eat-drink, provisionsUrl gets main page
  '35|foodUrl': 'https://www.greeka.com/epirus/preveza/eat-drink/',
  '35|provisionsUrl': 'https://www.greeka.com/epirus/preveza/',

  // Messolonghi: different URLs per field
  '39|foodUrl': 'https://www.greeka.com/sterea/mesolongi/eat-drink/restaurants/',
  '39|adventureUrl': 'https://www.greeka.com/sterea/mesolongi/things-to-do/',
  '39|provisionsUrl': 'https://www.greeka.com/sterea/mesolongi/',

  // Poros: foodUrl vs adventureUrl
  '44|foodUrl': 'https://www.greeka.com/saronic/poros/eat-drink/',
  '44|adventureUrl': 'https://www.greeka.com/saronic/poros/things-to-do/',

  // Cape Sounion: different per field
  '47|foodUrl': 'https://www.greeka.com/attica/athens/beaches/cape-sounion/',
  '47|adventureUrl': 'https://www.greeka.com/attica/athens/sightseeing/sounio-poseidon-temple/',
  '47|provisionsUrl': 'https://www.greeka.com/attica/',

  // Ornos Bay: foodUrl vs provisionsUrl
  '50|foodUrl': 'https://www.greeka.com/cyclades/mykonos/eat-drink/',
  '50|provisionsUrl': 'https://www.greeka.com/cyclades/mykonos/',

  // Ermoupoli adventureUrl (only the adventureUrl is broken, not foodUrl/provisionsUrl)
  '49|adventureUrl': 'https://www.greeka.com/cyclades/syros/things-to-do/',

  // Amorgos: food vs adventure
  '53|foodUrl': 'https://www.greeka.com/cyclades/amorgos/eat-drink/',
  '53|adventureUrl': 'https://www.greeka.com/cyclades/amorgos/things-to-do/',

  // Karpathos: food vs adventure
  '81|foodUrl': 'https://www.greeka.com/dodecanese/karpathos/eat-drink/',
  '81|adventureUrl': 'https://www.greeka.com/dodecanese/karpathos/things-to-do/',

  // Kasos: food vs adventure
  '82|foodUrl': 'https://www.greeka.com/dodecanese/kasos/eat-drink/',
  '82|adventureUrl': 'https://www.greeka.com/dodecanese/kasos/things-to-do/',

  // Kalamata: culture vs provisions
  '90|cultureUrl': 'https://www.greeka.com/peloponnese/kalamata/sightseeing/',
  '90|provisionsUrl': 'https://www.greeka.com/peloponnese/kalamata/',

  // Zakynthos: different per field
  '93|foodUrl': 'https://www.greeka.com/ionian/zakynthos/eat-drink/',
  '93|adventureUrl': 'https://www.greeka.com/ionian/zakynthos/things-to-do/',
  '93|provisionsUrl': 'https://www.greeka.com/ionian/zakynthos/',

  // Argostoli: food vs provisions
  '94|foodUrl': 'https://www.greeka.com/ionian/kefalonia/eat-drink/',
  '94|provisionsUrl': 'https://www.greeka.com/ionian/kefalonia/',

  // Sivota: different per field
  '95|foodUrl': 'https://www.greeka.com/ionian/lefkada/eat-drink/',
  '95|adventureUrl': 'https://www.greeka.com/ionian/lefkada/things-to-do/',
  '95|provisionsUrl': 'https://www.greeka.com/ionian/lefkada/',

  // Gaios: different per field
  '96|foodUrl': 'https://www.greeka.com/ionian/paxi/eat-drink/restaurants/',
  '96|adventureUrl': 'https://www.greeka.com/ionian/paxi/',
  '96|provisionsUrl': 'https://www.greeka.com/ionian/paxi/',

  // Othoni: food vs adventure
  '98|foodUrl': 'https://www.greeka.com/ionian/corfu/eat-drink/',
  '98|adventureUrl': 'https://www.greeka.com/ionian/corfu/things-to-do/',

  // Chalki wikiUrl (same as cultureUrl fix)
  '80|wikiUrl': 'https://en.wikipedia.org/wiki/Halki_(Greece)',

  // Shëngjin: different fields get different URLs
  '22|foodUrl': 'https://en.wikivoyage.org/wiki/Sh%C3%ABngjin',
  '22|adventureUrl': 'https://albaniavisit.com/destinations/shengjin/',
  '22|provisionsUrl': 'https://www.cruiserswiki.org/wiki/Shengjin',

  // Durrës: food vs adventure vs provisions
  '23|foodUrl': 'https://en.wikivoyage.org/wiki/Durr%C3%ABs',
  '23|adventureUrl': 'https://en.wikivoyage.org/wiki/Durr%C3%ABs',

  // Vlorë: different per field
  '25|foodUrl': 'https://en.wikivoyage.org/wiki/Vlor%C3%AB',
  '25|adventureUrl': 'https://adventurealbania.com/vlora-things-to-do/',
  '25|provisionsUrl': 'https://www.cruiserswiki.org/wiki/Vlore',
};

const URL_FIELDS = ['marinaUrl', 'cultureUrl', 'wikiUrl', 'foodUrl', 'adventureUrl', 'provisionsUrl'];

let fixed = 0;
for (const stop of stops) {
  for (const field of URL_FIELDS) {
    if (!stop[field]) continue;
    const oldUrl = stop[field];

    // Check field-specific override first
    const overrideKey = `${stop.id}|${field}`;
    if (fieldOverrides[overrideKey]) {
      console.log(`  ✓ ${stop.id}. ${stop.name} → ${field} (override)`);
      stop[field] = fieldOverrides[overrideKey];
      fixed++;
      continue;
    }

    // Check general URL replacement
    if (urlReplacements[oldUrl]) {
      console.log(`  ✓ ${stop.id}. ${stop.name} → ${field}`);
      stop[field] = urlReplacements[oldUrl];
      fixed++;
    }
  }
}

console.log(`\nFixed ${fixed} URLs`);
fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2));
console.log('Saved to stops.json');
