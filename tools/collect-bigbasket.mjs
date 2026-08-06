#!/usr/bin/env node
// BigBasket rank + competitor collector via Apify (actor: fascinating_lentil/bigbasket-grocery-scraper).
// Free-tier friendly: the actor charges ~$0.002/result. A --max-cost guard caps spend so a
// scheduled run can NEVER drain your Apify credit. No login; token comes from env APIFY_TOKEN.
//
// Fills two feeds the app already understands:
//   data/rank.csv        -> where YOUR brand ranks for each keyword (unlocks keyword-rank questions)
//   data/competitors.csv -> rival products/prices/ratings per keyword (unlocks competitor questions)
//
// Usage:
//   APIFY_TOKEN=xxx node tools/collect-bigbasket.mjs --seeds data/seeds.txt --brand Chuk --per-kw 20 --max-cost 3
//   node tools/collect-bigbasket.mjs --self-test
//
// ponytail: per-keyword run-sync calls (simple, ~12s each). Batch via --batch if 40+ keywords make it slow.

import fs from 'node:fs';
import { mergeWrite, classify, festivalKeywords } from './feedmerge.mjs';

const ACTOR = 'fascinating_lentil~bigbasket-grocery-scraper';
const PRICE_PER_RESULT = 0.002;                 // USD, from the actor's pricing
const API = t => `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${t}`;

function parseArgs(argv){
  // batch=1: one keyword per actor call so each keyword gets its OWN result budget.
  // Batching shares maxResults across the group, which starves later keywords (false "absent").
  const o = { seedsFile: 'data/seeds.txt', keywords: null, brand: 'Chuk', perKw: 20, batch: 1, maxCost: 3,
              today: new Date().toISOString().slice(0, 10), festivals: null, festWindow: 60, selfTest: false };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--seeds') o.seedsFile = argv[++i];
    else if (a === '--keywords') o.keywords = argv[++i].split(',').map(s => s.trim()).filter(Boolean);  // ad-hoc inline scan
    else if (a === '--festivals') o.festivals = argv[++i];
    else if (a === '--festival-window') o.festWindow = parseInt(argv[++i], 10) || 60;
    else if (a === '--brand') o.brand = argv[++i];
    else if (a === '--per-kw') o.perKw = parseInt(argv[++i], 10) || 20;
    else if (a === '--batch') o.batch = parseInt(argv[++i], 10) || 5;
    else if (a === '--max-cost') o.maxCost = parseFloat(argv[++i]) || 3;
    else if (a === '--today') o.today = argv[++i];
    else if (a === '--self-test') o.selfTest = true;
  }
  return o;
}

async function runActor(token, keywords, maxResults){
  const r = await fetch(API(token), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, maxResults, maxPagesPerSource: 2 }) });
  if (!r.ok){ const t = await r.text(); throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200)); }
  const items = await r.json();
  if (!Array.isArray(items)) throw new Error('non-array response: ' + JSON.stringify(items).slice(0, 200));
  return items;
}

function chunk(arr, n){ const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function main(){
  const o = parseArgs(process.argv.slice(2));

  if (o.selfTest){
    const sample = [
      { brand: 'Chuk', title: 'Disposable Bowl 120 ml', position: 6 },
      { brand: 'Agrileaf', title: 'Square Disposable', position: 1 },
      { brand: '', title: 'Chuk Party Caddy', position: 9 },   // brand blank, name carries it
    ];
    const { mine, comp } = classify(sample, 'Chuk');
    console.assert(mine.length === 2 && comp.length === 1, 'classify should match brand in brand OR title');
    console.assert(Math.floor(3 / PRICE_PER_RESULT) === 1500, 'budget math: $3 -> 1500 results');
    console.log('collect-bigbasket self-test passed');
    return;
  }

  const token = process.env.APIFY_TOKEN;
  if (!token){ process.stderr.write('No APIFY_TOKEN in env. Set it (GitHub secret in cron) and retry.\n'); process.exit(1); }

  const seeds = o.keywords || fs.readFileSync(o.seedsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  if (o.festivals){                                    // also scrape upcoming festival keywords
    const fk = festivalKeywords(o.festivals, o.festWindow);
    const add = fk.keywords.filter(k => !seeds.includes(k));
    if (add.length){ seeds.push(...add); process.stderr.write('+ ' + add.length + ' festival keyword(s) [' + fk.names.join(', ') + ']\n'); }
  }
  const budgetResults = Math.floor(o.maxCost / PRICE_PER_RESULT);   // hard cap: never spend past --max-cost
  let spent = 0;
  const rankRows = [], compRows = [];

  for (const grp of chunk(seeds, o.batch)){
    if (spent >= budgetResults){ process.stderr.write('budget cap hit, stopping\n'); break; }
    const want = Math.min(o.perKw * grp.length, budgetResults - spent);
    process.stderr.write('BigBasket: ' + grp.join(', ') + ' (max ' + want + ')…\n');
    let items;
    try { items = await runActor(token, grp, want); }
    catch (e){ process.stderr.write('  warn: ' + e.message + '\n'); continue; }
    spent += items.length;

    const byKw = {};
    for (const x of items) (byKw[x.searchQuery] = byKw[x.searchQuery] || []).push(x);
    for (const kw of Object.keys(byKw)){
      const { mine, comp } = classify(byKw[kw], o.brand);
      for (const x of mine)
        rankRows.push({ date: o.today, platform: 'bigbasket', keyword: kw, rank: x.position, product: x.title });
      for (const x of comp)
        compRows.push({ platform: 'bigbasket', competitor: x.brand || '—', product: x.title,
                        price: x.price ?? '', rating: x.rating ?? '', rank: x.position ?? '', keyword: kw, date: o.today });
    }
  }

  const r1 = mergeWrite('data/rank.csv', 'bigbasket', rankRows, ['date', 'platform', 'keyword', 'rank', 'product']);
  const r2 = mergeWrite('data/competitors.csv', 'bigbasket', compRows, ['platform', 'competitor', 'product', 'price', 'rating', 'rank', 'keyword', 'date']);
  process.stderr.write('rank.csv +' + r1.added + ' bigbasket (kept ' + r1.kept + ' other) · competitors.csv +' + r2.added + '\n');
  process.stderr.write('done. ~' + spent + ' results ≈ $' + (spent * PRICE_PER_RESULT).toFixed(2) + ' of your Apify credit.\n');
}

main();
