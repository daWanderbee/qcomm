#!/usr/bin/env node
// Live Instamart scraper through YOUR logged-in Edge session (Playwright, local = your home IP).
// This sidesteps the cloud actor's blocked datacenter IP. A visible Edge window opens; you sign in
// and set your delivery city once, then it scrapes each keyword and writes rank + competitors.
//
// The password is never handled here — you type it in the window. Login persists in a gitignored
// profile (tools/.pw-profile) so later runs reuse it.
//
// Usage: node tools/scrape-instamart-live.mjs --seeds data/seeds.txt --city Bangalore --brand Chuk
//        node tools/scrape-instamart-live.mjs --keywords "dona, katori" --fill-gaps

import fs from 'node:fs';
import { chromium } from 'playwright';
import { mergeWrite, classify, readCsv } from './feedmerge.mjs';

const A = process.argv.slice(2);
const arg = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i+1] : d; };
const BRAND = arg('--brand', 'Chuk');
const CITY  = arg('--city', 'Bangalore');
const TODAY = new Date().toISOString().slice(0, 10);
const KEEP_EXISTING = A.includes('--fill-gaps');
const seeds = A.includes('--keywords')
  ? arg('--keywords', '').split(',').map(s => s.trim()).filter(Boolean)
  : fs.readFileSync(arg('--seeds', 'data/seeds.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);

const num = s => { const n = Number(String(s ?? '').replace(/[^\d.]/g, '')); return isNaN(n) ? '' : n; };

// Instamart search/v2: products live at data.cards[].card.card.gridElements.infoWithStyle.items[]
function itemsFrom(json){
  const out = [];
  const cards = json?.data?.cards;
  if (Array.isArray(cards)) for (const c of cards){
    const list = c?.card?.card?.gridElements?.infoWithStyle?.items;
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}

async function main(){
  const ctx = await chromium.launchPersistentContext('tools/.pw-profile', {
    headless: false, channel: 'msedge', viewport: null,
    args: ['--disable-blink-features=AutomationControlled'],
  }).catch(() => chromium.launchPersistentContext('tools/.pw-profile', {
    headless: false, viewport: null, args: ['--disable-blink-features=AutomationControlled'],
  }));
  const page = ctx.pages()[0] || await ctx.newPage();

  let curr = null; const cap = {};
  page.on('response', async res => {
    if (!/instamart\/search\/v2/.test(res.url())) return;
    try { (cap[curr] = cap[curr] || []).push(await res.json()); } catch {}
  });

  async function search(kw){
    curr = kw; cap[kw] = [];
    try {
      await page.goto('https://www.swiggy.com/instamart/search?custom_back=true&query=' + encodeURIComponent(kw),
        { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {}
    await page.waitForTimeout(4000);
    const seen = new Set(), items = [];
    for (const j of (cap[kw] || [])) for (const it of itemsFrom(j)){
      const id = it.productId || (it.variations?.[0]?.skuId);
      if (id && seen.has(id)) continue; if (id) seen.add(id);
      items.push(it);
    }
    return items;
  }

  process.stderr.write('\n>>> A browser window opened. SIGN IN to Swiggy + SET LOCATION to ' + CITY + '.\n>>> Scraping auto-starts once search returns results (checking every 8s, up to ~5 min)…\n\n');
  let ready = false;
  for (let i = 0; i < 34 && !ready; i++){
    if ((await search('disposable bowl')).length){ ready = true; break; }
    process.stderr.write('  waiting for sign-in + location… (' + (i+1) + ')\n');
    await page.waitForTimeout(8000);
  }
  if (!ready){ process.stderr.write('Timed out — not signed in / no location. Re-run when ready.\n'); await ctx.close(); process.exit(1); }
  process.stderr.write('signed in ✓ scraping ' + seeds.length + ' keyword(s)…\n');

  const rankRows = [], compRows = [];
  for (const kw of seeds){
    const items = await search(kw);
    items.forEach((it, i) => {
      const v = it.variations?.[0] || {};
      const name = it.displayName || v.displayName || '';
      const brandName = it.brand || v.brandName || '';
      const price = num(v.price?.offerPrice?.units ?? v.price?.storePrice?.units);
      const mrp = num(v.price?.mrp?.units);
      const rating = it.ratings?.value || '';
      const rank = i + 1;
      if (classify([{ brand: brandName, name }], BRAND).mine.length)
        rankRows.push({ date: TODAY, platform: 'instamart', keyword: kw, rank, product: name });
      else
        compRows.push({ platform: 'instamart', competitor: brandName || '—', product: name, price, rating, rank, keyword: kw, date: TODAY });
    });
    process.stderr.write('  ' + kw + ': ' + items.length + ' products\n');
  }

  let keepR = [], keepC = [];
  if (KEEP_EXISTING){
    const scanned = new Set(seeds);
    keepR = readCsv('data/rank.csv').filter(r => r.platform === 'instamart' && !scanned.has(r.keyword));
    keepC = readCsv('data/competitors.csv').filter(r => r.platform === 'instamart' && !scanned.has(r.keyword));
  }
  const r1 = mergeWrite('data/rank.csv', 'instamart', keepR.concat(rankRows), ['date','platform','keyword','rank','product']);
  const r2 = mergeWrite('data/competitors.csv', 'instamart', keepC.concat(compRows), ['platform','competitor','product','price','rating','rank','keyword','date']);
  process.stderr.write('rank.csv instamart=' + r1.added + ' (kept ' + r1.kept + ' other) · competitors.csv instamart=' + r2.added + '\n');
  await ctx.close();
}
main();
