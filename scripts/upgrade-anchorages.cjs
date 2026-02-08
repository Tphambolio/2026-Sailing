const fs = require('fs');
const path = require('path');

const stopsPath = path.join(__dirname, '..', 'src', 'data', 'stops.json');
const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));

// ============================================================
// Upgrade anchorage names and marinaUrls from research agents
// Match by stop name to handle renumbered IDs
// ============================================================

const upgrades = {
  // === Agent 1: Croatia/Montenegro ===
  'Kornati Islands': {
    marinaName: 'Telašćica Bay (Luka Telašćica)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Luka_Tela%C5%A1%C4%87ica'
  },
  'Pakleni Islands (Hvar)': {
    marinaName: 'ACI Marina Palmižana',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Pakleni_archipelago'
  },
  'Komiža': {
    marinaName: 'Komiža Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Komi%C5%BEa'
  },
  'Korčula': {
    marinaName: 'Uvala Luka Anchorage (Korčula)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Korcula_Town'
  },
  'Mljet': {
    marinaName: 'Polače',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Polace'
  },
  'Herceg Novi': {
    marinaName: 'Herceg Novi Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Herceg_Novi'
  },
  'Budva': {
    marinaName: 'Dukley Marina Budva',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Budva'
  },
  'Bar': {
    marinaName: 'Marina Bar',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Bar'
  },
  'Ulcinj': {
    marinaName: 'Port Ulcinj',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Ulcinj'
  },

  // === Agent 2: Albania/NW Greece ===
  'Shëngjin': {
    marinaName: 'Port of Shëngjin',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Shengjin'
  },
  'Durrës': {
    marinaName: 'Port of Durrës',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Durres'
  },
  'Vlorë': {
    marinaName: 'Vlorë Bay Anchorage',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Vlore'
  },
  'Porto Palermo': {
    marinaName: 'Porto Palermo Bay',
    marinaUrl: 'https://sailingclick.com/marina/porto-palermo-marina/'
  },
  'Sarandë': {
    marinaName: 'Port of Sarandë',
    marinaUrl: 'https://sailingclick.com/marina/saranda-marina/'
  },
  'Kassiopi': {
    marinaName: 'Kassiopi Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kassiopi'
  },
  'Kontokali Bay (Corfu)': {
    marinaName: 'Gouvia Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Gouvia_Marina'
  },
  'Parga': {
    marinaName: 'Ormos Valtou (Parga)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Parga'
  },
  'Preveza': {
    marinaName: 'Preveza Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Preveza_Marina'
  },
  'Lefkada Town': {
    marinaName: 'D-Marin Lefkas Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Lefkas_Marina'
  },
  'Nydri': {
    marinaName: 'Nidri Harbour (Vlikho Bay)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Nidri'
  },
  'Fiskardo': {
    marinaName: 'Fiskardo Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Fiskardo'
  },
  'Messolonghi': {
    marinaName: 'Messolonghi Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Messolonghi_Marina'
  },

  // === Agent 3: Saronic/Cyclades ===
  'Galaxidi': {
    marinaName: 'Galaxidi Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Galaxidhi'
  },
  'Aegina': {
    marinaName: 'Aegina Marina (Perdika anchorage nearby)',
    marinaUrl: 'https://sailingissues.com/greekislands/aegina.html'
  },
  'Poros': {
    marinaName: 'Poros Town Harbour (Neorion Bay)',
    marinaUrl: 'https://sailingissues.com/greekislands/poros.html'
  },
  'Hydra': {
    marinaName: 'Mandraki Bay',
    marinaUrl: 'https://sailingissues.com/greekislands/hydra.html'
  },
  'Spetses': {
    marinaName: 'Baltiza (Old Harbour)',
    marinaUrl: 'https://sailingissues.com/greekislands/spetses.html'
  },
  'Cape Sounion': {
    marinaName: 'Sounion Bay',
    marinaUrl: 'https://sailingissues.com/greekislands/argolic.html'
  },
  'Kea': {
    marinaName: 'Vourkari (Ayios Nikolaos Bay)',
    marinaUrl: 'https://sailingissues.com/greekislands/kea.html'
  },
  'Ermoupoli (Syros)': {
    marinaName: 'Ermoupoli Harbour',
    marinaUrl: 'https://sailingissues.com/greekislands/syros.html'
  },
  'Ornos Bay (Mykonos)': {
    marinaName: 'Ormos Ornos',
    marinaUrl: 'https://sailingissues.com/greekislands/mykonos.html'
  },
  'Naxos': {
    marinaName: 'Naxos Marina (Naxos Town Harbour)',
    marinaUrl: 'https://sailingissues.com/greekislands/naxos.html'
  },
  'Parikia (Paros)': {
    marinaName: 'Parikia Harbour',
    marinaUrl: 'https://sailingissues.com/greekislands/paros.html'
  },
  'Amorgos': {
    marinaName: 'Katapola Bay',
    marinaUrl: 'https://sailingissues.com/greekislands/amorgos.html'
  },
  'Astypalaia': {
    marinaName: 'Skala Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Astypalea'
  },
  'Kos': {
    marinaName: 'Kos Marina',
    marinaUrl: 'https://sailingissues.com/greekislands/kos.html'
  },

  // === Agent 4: Turkey ===
  'Marmaris': {
    marinaName: 'Netsel Marmaris Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Netsel_Marina'
  },
  'Gemiler Island (Fethiye)': {
    marinaName: 'Gemiler Island Anchorage (Gemiler Adasi)',
    marinaUrl: 'https://www.coastguidetr.com/en/bay/101311/gemiler-island'
  },
  'Kekova': {
    marinaName: 'Ucagiz Limani (Kekova Roads)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kekova_Roads'
  },
  'Phaselis Bay (Kemer)': {
    marinaName: 'Phaselis South Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kemer_Marina'
  },

  // === Agent 5: Greek return/Italy ===
  'Kastellorizo': {
    marinaName: 'Megisti Harbour (Mandraki Anchorage)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kastelorizo'
  },
  'Lindos (Rhodes)': {
    marinaName: 'Lindos Bay Anchorage',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Lindos'
  },
  'Chalki': {
    marinaName: 'Emborio Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Chalki'
  },
  'Kasos': {
    marinaName: 'Helatros Bay',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kasos'
  },
  'Sitia': {
    marinaName: 'Port of Sitia',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Sitia'
  },
  'Rethymno': {
    marinaName: 'Rethymno Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Rethimno'
  },
  'Kapsali (Kythira)': {
    marinaName: 'Kapsali Anchorage',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kithira'
  },
  'Gytheio': {
    marinaName: 'Gythion Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Gythion'
  },
  'Kalamata': {
    marinaName: 'Kalamata Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Kalamata_Marina'
  },
  'Pylos': {
    marinaName: 'Navarino Bay Anchorage (Pylos)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Pylos'
  },
  'Katakolo': {
    marinaName: 'Katakolo Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Katakolo'
  },
  'Zakynthos': {
    marinaName: 'Port Zakynthos (Zante Town)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Zakinthos_(Zante)'
  },
  'Argostoli': {
    marinaName: 'Argostoli Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Argostoli'
  },
  'Sivota (Lefkada)': {
    marinaName: 'Sivota Bay',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Sivotas'
  },
  'Gaios (Paxos)': {
    marinaName: 'Port Gaios',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Port_Gaios'
  },
  'Othoni': {
    marinaName: 'Ormos Fyki (Fyki Bay)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Othoni'
  },
  'Gallipoli': {
    marinaName: 'Porto Gaio Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Gallipoli'
  },
  'Rossano': {
    marinaName: 'Porto di Corigliano Calabro',
    marinaUrl: 'https://www.sea-seek.com/en/Porto-di-Corigliano-Calabro-Calabria-'
  },
  'Le Castella': {
    marinaName: 'Marina Le Castella',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Le_Castella'
  },
  'Giardini Naxos': {
    marinaName: 'Marina Yachting Giardini Naxos',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Giardini_Naxos'
  },

  // === Additional stops that need better URLs (replace Wikipedia with cruising guides) ===
  'Finike': {
    marinaName: 'Setur Finike Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Finike'
  },
  'Side': {
    marinaName: 'Side Ancient Harbour',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Side'
  },
  'Heraklion': {
    marinaName: 'Heraklion Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Iraklion'
  },
  'Agios Nikolaos': {
    marinaName: 'Agios Nikolaos Marina',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Agios_Nikolaos'
  },
  'Chania': {
    marinaName: 'Chania Old Port',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Khania'
  },
  'Corfu': {
    marinaName: 'Corfu Marina (Gouvia)',
    marinaUrl: 'https://www.cruiserswiki.org/wiki/Corfu'
  },
};

// Apply upgrades
let upgraded = 0;
let skipped = 0;

for (const stop of stops) {
  const upgrade = upgrades[stop.name];
  if (upgrade) {
    const oldName = stop.marinaName;
    const oldUrl = stop.marinaUrl;
    stop.marinaName = upgrade.marinaName;
    stop.marinaUrl = upgrade.marinaUrl;
    console.log(`  ✓ ${stop.id} ${stop.name}: "${oldName}" → "${upgrade.marinaName}"`);
    upgraded++;
  }
}

// Summary - check for any remaining Wikipedia URLs
const wikiStops = stops.filter(s => s.marinaUrl && s.marinaUrl.includes('wikipedia.org'));
const noMarina = stops.filter(s => !s.marinaName);

console.log(`\n=== SUMMARY ===`);
console.log(`Upgraded: ${upgraded} stops`);
console.log(`Remaining Wikipedia URLs: ${wikiStops.length}`);
if (wikiStops.length > 0) {
  wikiStops.forEach(s => console.log(`  ${s.id} ${s.name} → ${s.marinaUrl.substring(0, 60)}`));
}
if (noMarina.length > 0) {
  console.log(`Missing marinaName: ${noMarina.length}`);
  noMarina.forEach(s => console.log(`  ${s.id} ${s.name}`));
}

// Save
fs.writeFileSync(stopsPath, JSON.stringify(stops, null, 2) + '\n');
console.log('\nSaved to stops.json');
