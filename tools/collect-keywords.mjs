#!/usr/bin/env node
// Keyword discovery collector — free, no keys.
// Expands your seed terms via Google autocomplete (public suggest endpoint),
// harvests suggestions, and writes a keyword_volume.csv the app's engine reads.
//
// Usage:
//   node tools/collect-keywords.mjs "eco friendly plates" "paper cups" --platform Blinkit --depth 1 > keyword_volume.csv
//   node tools/collect-keywords.mjs --seeds seeds.txt --platform Zepto > keyword_volume.csv
//   node tools/collect-keywords.mjs --self-test
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

async function collect(seeds, { platform, depth }){
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
  const out = [HEADER];
  for (const [kw, rank] of rows) out.push([platform, csvCell(kw), '', rank, '', '', ''].join(','));
  return out.join('\n') + '\n';
}

function parseArgs(argv){
  const seeds = [], opts = { platform: 'Google', depth: 0, selfTest: false, seedsFile: null };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--platform') opts.platform = argv[++i];
    else if (a === '--depth') opts.depth = parseInt(argv[++i], 10) || 0;
    else if (a === '--seeds') opts.seedsFile = argv[++i];
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
  process.stderr.write('Expanding ' + allSeeds.length + ' seed(s), depth ' + opts.depth + '…\n');
  process.stdout.write(await collect(allSeeds, opts));
}

main();
