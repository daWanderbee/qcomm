#!/usr/bin/env node
// Instamart rank + competitor collector via Apify (actor: smacient/swiggy-instamart-data-extractor).
// NOTE: this actor requires a one-time "full account access" approval in your Apify console before
// it will run via API. The user approved it consciously; see the /scan-keywords skill note.
//
// Cost ~$0.005/result. --max-cost caps spend so a scheduled run stays inside the Apify free credit.
// Instamart is city-specific (unlike BigBasket), so results depend on --city. Rank = result order.
// Fills the SAME rank.csv / competitors.csv as BigBasket, merged by platform (no clobbering).
//
// Usage:
//   APIFY_TOKEN=xxx node tools/collect-instamart.mjs --seeds data/seeds.txt --city Bangalore --brand Chuk --per-kw 20 --max-cost 1.5
//   node tools/collect-instamart.mjs --self-test

import fs from 'node:fs';
import { mergeWrite, classify, readCsv } from './feedmerge.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const ACTOR = 'smacient~swiggy-instamart-data-extractor';
const PRICE_PER_RESULT = 0.005;
const API = t => `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${t}`;

function parseArgs(argv){
  const o = { seedsFile: 'data/seeds.txt', keywords: null, city: 'Bangalore', brand: 'Chuk',
              perKw: 20, maxCost: 1.5, today: new Date().toISOString().slice(0, 10),
              fillGaps: false, delay: 0, retries: 1, selfTest: false };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--seeds') o.seedsFile = argv[++i];
    else if (a === '--keywords') o.keywords = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--city') o.city = argv[++i];
    else if (a === '--brand') o.brand = argv[++i];
    else if (a === '--per-kw') o.perKw = parseInt(argv[++i], 10) || 20;
    else if (a === '--max-cost') o.maxCost = parseFloat(argv[++i]) || 1.5;
    else if (a === '--fill-gaps') o.fillGaps = true;                  // only re-scan keywords with no instamart data yet
    else if (a === '--delay') o.delay = parseInt(argv[++i], 10) || 0; // ms between calls, to dodge throttling
    else if (a === '--retries') o.retries = parseInt(argv[++i], 10) || 1;
    else if (a === '--today') o.today = argv[++i];
    else if (a === '--self-test') o.selfTest = true;
  }
  return o;
}

async function runActor(token, searchQuery, city, maxResults){
  const r = await fetch(API(token), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchQuery, city, maxResults }) });
  const items = await r.json();
  if (!r.ok || !Array.isArray(items)){
    const msg = JSON.stringify(items).slice(0, 200);
    if (/not-approved|approvePermissions/.test(msg))
      throw new Error('Actor not approved yet. Approve it once in the Apify console, then retry.\n  ' + msg);
    throw new Error('HTTP ' + r.status + ' ' + msg);
  }
  return items;
}

async function main(){
  const o = parseArgs(process.argv.slice(2));

  if (o.selfTest){
    const { mine, comp } = classify(
      [{ brand: 'Chuk', name: 'Disposable Bowl 120 ml' }, { brand: 'Agrileaf', name: 'Square' }], 'Chuk');
    console.assert(mine.length === 1 && comp.length === 1, 'classify splits by brand (name field)');
    console.assert(Math.floor(1.5 / PRICE_PER_RESULT) === 300, 'budget: $1.5 -> 300 results');
    console.log('collect-instamart self-test passed');
    return;
  }

  const token = process.env.APIFY_TOKEN;
  if (!token){ process.stderr.write('No APIFY_TOKEN in env.\n'); process.exit(1); }

  const allSeeds = o.keywords || fs.readFileSync(o.seedsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);

  // In --fill-gaps we only re-scan keywords that have NO instamart data yet, and preserve the rows
  // we already collected (e.g. the #1-bowl rankings) so a retry pass can never wipe good data.
  let keepRank = [], keepComp = [], targets = allSeeds;
  if (o.fillGaps){
    keepRank = readCsv('data/rank.csv').filter(r => r.platform === 'instamart');
    keepComp = readCsv('data/competitors.csv').filter(r => r.platform === 'instamart');
    const have = new Set([...keepRank, ...keepComp].map(r => r.keyword));
    targets = allSeeds.filter(k => !have.has(k));
    process.stderr.write('fill-gaps: ' + targets.length + ' empty keyword(s); keeping ' + keepRank.length + ' rank + ' + keepComp.length + ' competitor rows\n');
    if (!targets.length){ process.stderr.write('nothing empty — done.\n'); return; }
  }

  const budget = Math.floor(o.maxCost / PRICE_PER_RESULT);
  let spent = 0;
  const rankRows = [], compRows = [], found = new Set();
  let pending = targets.slice();

  for (let pass = 0; pass < o.retries && pending.length && spent < budget; pass++){
    if (pass > 0) process.stderr.write('— retry pass ' + (pass + 1) + ' for ' + pending.length + ' still-empty keyword(s) —\n');
    const stillEmpty = [];
    for (const kw of pending){
      if (spent >= budget){ stillEmpty.push(kw); continue; }
      const want = Math.min(o.perKw, budget - spent);
      process.stderr.write('Instamart/' + o.city + ': ' + kw + ' (max ' + want + ')…\n');
      let items;
      try { items = await runActor(token, kw, o.city, want); }
      catch (e){ process.stderr.write('  warn: ' + e.message + '\n'); if (/not approved/i.test(e.message)) process.exit(1); stillEmpty.push(kw); continue; }
      spent += items.length;
      if (!items.length){ stillEmpty.push(kw); if (o.delay) await sleep(o.delay); continue; }
      found.add(kw);
      items.forEach((x, i) => {                      // result order = search rank
        const rank = i + 1, name = x.name || x.title || '';
        const { mine } = classify([x], o.brand);
        if (mine.length) rankRows.push({ date: o.today, platform: 'instamart', keyword: kw, rank, product: name });
        else compRows.push({ platform: 'instamart', competitor: x.brand || '—', product: name,
                             price: x.price ?? '', rating: x.rating ?? '', rank, keyword: kw, date: o.today });
      });
      if (o.delay) await sleep(o.delay);
    }
    pending = stillEmpty;
  }

  const r1 = mergeWrite('data/rank.csv', 'instamart', keepRank.concat(rankRows), ['date', 'platform', 'keyword', 'rank', 'product']);
  const r2 = mergeWrite('data/competitors.csv', 'instamart', keepComp.concat(compRows), ['platform', 'competitor', 'product', 'price', 'rating', 'rank', 'keyword', 'date']);
  process.stderr.write('rank.csv instamart=' + r1.added + ' (kept ' + r1.kept + ' other) · competitors.csv instamart=' + r2.added + '\n');
  process.stderr.write('this run: found ' + found.size + '/' + targets.length + ' target keyword(s)' + (pending.length ? ', still empty: ' + pending.join(', ') : '') + '\n');
  process.stderr.write('spent ~' + spent + ' results ≈ $' + (spent * PRICE_PER_RESULT).toFixed(2) + ' this run.\n');
}

main();
