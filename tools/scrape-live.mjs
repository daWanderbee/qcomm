#!/usr/bin/env node
// Generalized live q-commerce scraper through YOUR logged-in Edge session (local = home IP).
// One tool, many platforms via the registry below. Instamart uses its clean search/v2 JSON;
// the rest use a generic DOM reader (every q-comm search renders name + ₹price + position).
// Adding a platform = one line in PLATFORMS. Password never handled here — you sign in in the window.
//
// Usage: node tools/scrape-live.mjs --platform zepto --seeds data/seeds.txt --city Bangalore --brand Chuk
//        node tools/scrape-live.mjs --platform instamart --keywords "dona, katori" --fill-gaps

import fs from 'node:fs';
import { chromium } from 'playwright';
import { mergeWrite, classify, readCsv, festivalKeywords } from './feedmerge.mjs';

const enc = encodeURIComponent;
const PLATFORMS = {
  instamart:          { search: kw => 'https://www.swiggy.com/instamart/search?custom_back=true&query=' + enc(kw), method: 'imjson' },
  zepto:              { search: kw => 'https://www.zeptonow.com/search?query=' + enc(kw), method: 'dom' },
  // general marketplace (best-effort, not the pure q-comm storefront) — needs card selectors to be clean
  'amazon now':       { search: kw => 'https://www.amazon.in/s?k=' + enc(kw), method: 'dom',
                        dom: { card: 'div[data-component-type="s-search-result"]', name: 'h2 span, h2 a span', price: '.a-price .a-offscreen' } },
  // flipkart minutes dropped: Flipkart's CSS classes are obfuscated + rotate, so scraping returns 0.
  // Add its ad-console keyword export instead when available.
};

const A = process.argv.slice(2);
const arg = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i+1] : d; };
const PLAT = arg('--platform', 'instamart').toLowerCase();
const cfg = PLATFORMS[PLAT];
if (!cfg){ console.error('unknown --platform. options: ' + Object.keys(PLATFORMS).join(', ')); process.exit(1); }
const BRAND = arg('--brand', 'Chuk'), CITY = arg('--city', 'Bangalore'), TODAY = new Date().toISOString().slice(0, 10);
const KEEP = A.includes('--fill-gaps');
const seeds = A.includes('--keywords')
  ? arg('--keywords', '').split(',').map(s => s.trim()).filter(Boolean)
  : fs.readFileSync(arg('--seeds', 'data/seeds.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
if (A.includes('--festivals')){                       // also scrape upcoming festival keywords
  const fk = festivalKeywords(arg('--festivals', 'data/festivals.csv'), +arg('--festival-window', 60));
  const add = fk.keywords.filter(k => !seeds.includes(k));
  if (add.length){ seeds.push(...add); process.stderr.write('+ ' + add.length + ' festival keyword(s) [' + fk.names.join(', ') + ']\n'); }
}

const num = s => { const n = Number(String(s ?? '').replace(/[^\d.]/g, '')); return isNaN(n) ? '' : n; };
function imItems(json){ const out = []; const cards = json?.data?.cards; if (Array.isArray(cards)) for (const c of cards){ const l = c?.card?.card?.gridElements?.infoWithStyle?.items; if (Array.isArray(l)) out.push(...l); } return out; }

async function main(){
  const ctx = await chromium.launchPersistentContext('tools/.pw-profile', {
    headless: false, channel: 'msedge', viewport: null, args: ['--disable-blink-features=AutomationControlled'],
  }).catch(() => chromium.launchPersistentContext('tools/.pw-profile', { headless: false, viewport: null, args: ['--disable-blink-features=AutomationControlled'] }));
  const page = ctx.pages()[0] || await ctx.newPage();

  let curr = null; const cap = {};
  if (cfg.method === 'imjson') page.on('response', async r => { if (/instamart\/search\/v2/.test(r.url())){ try { (cap[curr] = cap[curr] || []).push(await r.json()); } catch {} } });

  async function search(kw){
    curr = kw; cap[kw] = [];
    try { await page.goto(cfg.search(kw), { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
    await page.waitForTimeout(4500);
    if (cfg.method === 'imjson'){
      const seen = new Set(), items = [];
      for (const j of (cap[kw] || [])) for (const it of imItems(j)){
        const id = it.productId || it.variations?.[0]?.skuId; if (id && seen.has(id)) continue; if (id) seen.add(id);
        const v = it.variations?.[0] || {};
        items.push({ name: it.displayName || '', brand: it.brand || '', price: num(v.price?.offerPrice?.units), mrp: num(v.price?.mrp?.units), rating: it.ratings?.value || '' });
      }
      return items;
    }
    // structured DOM: use the platform's real card/name/price selectors when provided (cleanest)
    if (cfg.dom) return await page.evaluate(sel => {
      const out = [], seen = new Set();
      for (const card of document.querySelectorAll(sel.card)){
        const nm = (card.querySelector(sel.name)?.innerText || '').trim();
        const pe = card.querySelector(sel.price);
        const price = pe ? +String(pe.innerText || '').replace(/[^\d]/g, '') : '';
        if (nm.length < 6 || !price) continue;
        const key = nm.slice(0, 40).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        out.push({ name: nm.slice(0, 60), brand: nm.split(/\s+/).slice(0, 2).join(' '), price, mrp: '', rating: '' });
        if (out.length >= 25) break;
      }
      return out;
    }, cfg.dom);
    // generic DOM: read rendered product cards (name + ₹price + document order = rank)
    return await page.evaluate(() => {
      const rx = /₹\s?\d[\d,]*/; const out = []; const seen = new Set();
      for (const el of document.querySelectorAll('a,li,div')){
        const t = (el.innerText || '').trim();
        if (t.length < 8 || t.length > 250 || !rx.test(t)) continue;
        let prices = (t.match(/₹\s?\d[\d,]*/g) || []).map(s => +s.replace(/[^\d]/g, '')).filter(x => x > 0);
        if (!prices.length) continue; prices.sort((a, b) => b - a);
        const mrp = prices[0], sp = prices.length >= 2 ? prices[1] : prices[0];   // biggest=MRP, next=selling (skips "₹16 OFF")
        const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
          .filter(s => !/^₹|^ADD$|OFF$|^\d+%|^\d+\s*(g|ml|kg|l|pcs|piece|pieces)\b|^save|^sold out|^m\.?r\.?p|^price\b|back with|^up to|coupon|^get it|delivery|^see |^shop |^results|sponsored|^\(?\d|rating|reviews?$/i.test(s));
        const name = lines.sort((a, b) => b.length - a.length)[0] || '';
        if (name.length < 6) continue;
        if (name.split(/\s+/).filter(w => /[a-z]{3}/i.test(w)).length < 2) continue;  // needs ≥2 real words
        const key = name.slice(0, 40).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        const brand = name.split('|')[0].trim().split(/\s+/).slice(0, 2).join(' ') || name;
        out.push({ name: name.slice(0, 60), brand, price: sp, mrp, rating: '' });
        if (out.length >= 25) break;
      }
      return out;
    });
  }

  process.stderr.write('\n>>> Edge window opened for ' + PLAT.toUpperCase() + '. Sign in + set location to ' + CITY + ' if prompted.\n>>> Auto-starts once search returns results (checking every 8s, up to ~4 min)…\n\n');
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++){
    if ((await search(seeds[0] || 'disposable bowl')).length){ ready = true; break; }
    process.stderr.write('  waiting for results… (' + (i+1) + ')\n'); await page.waitForTimeout(8000);
  }
  if (!ready){ process.stderr.write('Timed out — no results (sign in / set location, or platform blocked).\n'); await ctx.close(); process.exit(1); }
  process.stderr.write('ok ✓ scraping ' + seeds.length + ' keyword(s) on ' + PLAT + '…\n');

  const rankRows = [], compRows = [];
  for (const kw of seeds){
    const prods = await search(kw);
    prods.forEach((x, i) => { const rank = i + 1;
      if (classify([{ brand: x.brand, name: x.name }], BRAND).mine.length)
        rankRows.push({ date: TODAY, platform: PLAT, keyword: kw, rank, product: x.name });
      else compRows.push({ platform: PLAT, competitor: x.brand || '—', product: x.name, price: x.price, rating: x.rating, rank, keyword: kw, date: TODAY });
    });
    process.stderr.write('  ' + kw + ': ' + prods.length + '\n');
  }

  let keepR = [], keepC = [];
  if (KEEP){ const sc = new Set(seeds);
    keepR = readCsv('data/rank.csv').filter(r => r.platform === PLAT && !sc.has(r.keyword));
    keepC = readCsv('data/competitors.csv').filter(r => r.platform === PLAT && !sc.has(r.keyword));
  }
  mergeWrite('data/rank.csv', PLAT, keepR.concat(rankRows), ['date', 'platform', 'keyword', 'rank', 'product']);
  mergeWrite('data/competitors.csv', PLAT, keepC.concat(compRows), ['platform', 'competitor', 'product', 'price', 'rating', 'rank', 'keyword', 'date']);
  process.stderr.write('done ' + PLAT + ': rank ' + rankRows.length + ' · competitors ' + compRows.length + '\n');
  await ctx.close();
}
main();
