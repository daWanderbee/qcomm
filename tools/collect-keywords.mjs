#!/usr/bin/env node
// Keyword discovery collector — free, no keys.
// Expands your seed terms via Google autocomplete (public suggest endpoint),
// harvests suggestions, and writes a keyword_volume.csv the app's engine reads.
//
// Usage:
//   node tools/collect-keywords.mjs "eco friendly plates" --platform Blinkit --depth 1 > keyword_volume.csv
//   node tools/collect-keywords.mjs --seeds seeds.txt --platforms "Blinkit,Zepto,Amazon Now" > keyword_volume.csv
//   node tools/collect-keywords.mjs --self-test
//
// --platform  = one app.  --platforms = comma list (fetches ONCE, emits a row per app).
//
// Notes:
// - Google autocomplete is a DISCOVERY + popularity-order signal, not a per-platform
//   volume number. It fills `autocomplete_rank`; the app composites that into the
//   volume index. For real per-platform volume, add `ad_impressions` (your ad reports)
//   and `amazon_sqp_rank` (Brand Analytics) columns before uploading.
// - Platform-native autocomplete (Blinkit/Zepto/etc) needs their endpoints + a
//   residential proxy; wire those in `fetchSuggestions` when you have them.

const HEADER = 'platform,keyword,ad_impressions,autocomplete_rank,amazon_sqp_rank,google_volume,competition';
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');

function csvCell(s){ return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function fetchSuggestions(q){
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=' + encodeURIComponent(q);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();          // [ query, [suggestions...] ]
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  } catch (e) {
    process.stderr.write('warn: fetch failed for "' + q + '": ' + e.message + '\n');
    return [];
  }
}

async function collect(seeds, { platform, depth, adMap }){
  const found = new Map();                  // keyword -> best (lowest) autocomplete rank
  const record = (kw, rank) => {
    kw = kw.trim().toLowerCase();
    if (!kw) return;
    if (!found.has(kw) || rank < found.get(kw)) found.set(kw, rank);
  };
  const queries = new Set(seeds.map(s => s.toLowerCase()));
  if (depth >= 1) for (const s of seeds) for (const c of ALPHA) queries.add((s + ' ' + c).toLowerCase());

  for (const q of queries){
    const sugg = await fetchSuggestions(q);
    sugg.forEach((s, i) => record(s, i + 1));
    await new Promise(r => setTimeout(r, 120)); // be polite
  }

  const rows = [...found.entries()].sort((a, b) => a[1] - b[1]);
  const plats = (Array.isArray(platform) ? platform : [platform]);   // one fetch, emit per app
  const out = [HEADER];
  for (const p of plats){
    const ads = (adMap && adMap[p]) || {};   // real keyword -> impressions for this app
    const seen = new Set();
    // discovered keywords: fill real ad_impressions when we actually advertise that term
    for (const [kw, rank] of rows){
      out.push([p, csvCell(kw), ads[kw] != null ? ads[kw] : '', rank, '', '', ''].join(','));
      seen.add(kw);
    }
    // real advertised keywords autocomplete never surfaced — always include them (concrete, real volume)
    for (const kw of Object.keys(ads))
      if (!seen.has(kw)) out.push([p, csvCell(kw), ads[kw], '', '', '', ''].join(','));
  }
  return out.join('\n') + '\n';
}

// minimal CSV parse (handles quoted fields) -> array of row objects
function parseCSV(text){
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++){ const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; } }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim() !== ''))
    .map(r => Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()])));
}

// Real keyword volume from the ad reports: platform display-name -> { keyword: total impressions }.
// This is the concrete, high-confidence signal (vs autocomplete guesses).
const PLATNAME = { blinkit:'Blinkit', zepto:'Zepto', instamart:'Instamart',
  'amazon now':'Amazon Now', bigbasket:'BigBasket', 'flipkart minutes':'Flipkart Minutes' };
function loadAds(text){
  const map = {};
  for (const r of parseCSV(text)){
    const kw = (r.keyword || '').trim().toLowerCase();
    if (!kw) continue;
    const p = PLATNAME[(r.platform || '').toLowerCase()] || r.platform;
    (map[p] = map[p] || {}); map[p][kw] = (map[p][kw] || 0) + (Number(r.impressions) || 0);
  }
  return map;
}

// Seasonal festival keywords: pick festivals whose date falls within [today, today+window]
// and return their keyword modifiers. Pure fn so it's testable and the monthly cron self-updates.
function festivalKeywords(csvText, today, windowDays){
  const horizon = new Date(today.getTime() + windowDays * 864e5);
  const keywords = [], names = [];
  for (const r of parseCSV(csvText)){
    const d = new Date(r.date);
    if (isNaN(d) || d < today || d > horizon || !r.keywords) continue;
    names.push(r.name + ' (' + r.date + ')');
    for (const k of r.keywords.split(';').map(s => s.trim()).filter(Boolean)) keywords.push(k);
  }
  return { keywords, names };
}

function parseArgs(argv){
  const seeds = [], opts = { platform: 'Google', depth: 0, selfTest: false, seedsFile: null,
    adsFile: 'data/ads.csv', festivalsFile: null, festWindow: 60, today: null };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--platform') opts.platform = argv[++i];
    else if (a === '--platforms') opts.platform = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--depth') opts.depth = parseInt(argv[++i], 10) || 0;
    else if (a === '--seeds') opts.seedsFile = argv[++i];
    else if (a === '--ads') opts.adsFile = argv[++i];
    else if (a === '--festivals') opts.festivalsFile = argv[++i];
    else if (a === '--festival-window') opts.festWindow = parseInt(argv[++i], 10) || 60;
    else if (a === '--today') opts.today = argv[++i];
    else if (a === '--self-test') opts.selfTest = true;
    else seeds.push(a);
  }
  return { seeds, opts };
}

async function main(){
  const { seeds, opts } = parseArgs(process.argv.slice(2));

  if (opts.selfTest){
    // no network: verify csv assembly + dedup/rank-keep logic
    const found = new Map();
    const rec = (k, r) => { if (!found.has(k) || r < found.get(k)) found.set(k, r); };
    rec('eco plates', 3); rec('eco plates', 1); rec('paper cups', 2);
    console.assert(found.get('eco plates') === 1, 'should keep best rank');
    const line = ['Blinkit', csvCell('eco, plates'), '', 1, '', '', ''].join(',');
    console.assert(line.includes('"eco, plates"'), 'should quote commas');
    console.assert(HEADER.split(',').length === 7, 'header width');
    // real ad keywords get injected with impressions, even if autocomplete missed them
    const am = loadAds('date,platform,keyword,impressions\nx,blinkit,dona,9858\n');
    console.assert(am.Blinkit && am.Blinkit.dona === 9858, 'loadAds maps platform + sums impressions');
    // seasonal festival picker: includes upcoming, excludes far-off
    const fk = festivalKeywords('date,name,keywords\n2026-08-26,Onam,onam sadya plate;banana leaf plate\n2026-12-25,Christmas,xmas plate\n', new Date('2026-07-29'), 60);
    console.assert(fk.keywords.includes('onam sadya plate') && !fk.keywords.includes('xmas plate'), 'festival window picks upcoming only');
    console.log('collect-keywords self-test passed');
    return;
  }

  let allSeeds = seeds;
  if (opts.seedsFile){
    const fs = await import('node:fs');
    allSeeds = allSeeds.concat(fs.readFileSync(opts.seedsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
  }
  if (!allSeeds.length){
    process.stderr.write('No seeds. Pass terms as args or --seeds file.txt (or --self-test).\n');
    process.exit(1);
  }
  // Auto-add keywords for festivals coming up within the window (seasonal, self-updating each run)
  if (opts.festivalsFile){
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(opts.festivalsFile)){
        const today = opts.today ? new Date(opts.today) : new Date();
        const fk = festivalKeywords(fs.readFileSync(opts.festivalsFile, 'utf8'), today, opts.festWindow);
        if (fk.names.length){
          allSeeds = allSeeds.concat(fk.keywords);
          process.stderr.write('Festivals in next ' + opts.festWindow + 'd: ' + fk.names.join(', ') + '\n');
          process.stderr.write('Added ' + fk.keywords.length + ' festival keyword seed(s)\n');
        } else process.stderr.write('No festivals within ' + opts.festWindow + ' days.\n');
      }
    } catch (e) { process.stderr.write('warn: could not read festivals file: ' + e.message + '\n'); }
  }

  // Pull real keyword impressions from the ad reports (concrete signal, not autocomplete)
  let adMap = {};
  try {
    const fs = await import('node:fs');
    if (fs.existsSync(opts.adsFile)){
      adMap = loadAds(fs.readFileSync(opts.adsFile, 'utf8'));
      const n = Object.values(adMap).reduce((a, m) => a + Object.keys(m).length, 0);
      process.stderr.write('Loaded ' + n + ' real ad keyword(s) from ' + opts.adsFile + '\n');
    }
  } catch (e) { process.stderr.write('warn: could not read ads file: ' + e.message + '\n'); }

  process.stderr.write('Expanding ' + allSeeds.length + ' seed(s), depth ' + opts.depth + '…\n');
  process.stdout.write(await collect(allSeeds, { ...opts, adMap }));
}

main();
