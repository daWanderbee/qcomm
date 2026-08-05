// Shared feed writer: merge new rows into a CSV by platform, so multiple collectors
// (BigBasket, Instamart, …) can each refresh their own slice of rank.csv / competitors.csv
// without overwriting the other platform's rows.
import fs from 'node:fs';

export function csvCell(s){ s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// Split a keyword's results into "yours" (brand/title matches) vs competitors.
export function classify(items, brand){
  const rx = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const mine = [], comp = [];
  for (const x of items) (rx.test((x.brand || '') + ' ' + (x.title || x.name || '')) ? mine : comp).push(x);
  return { mine, comp };
}

function parse(t){
  const rows = []; let row = [], cur = '', q = false; t = t.replace(/\r/g, '');
  for (let i = 0; i < t.length; i++){ const c = t[i];
    if (q){ if (c === '"'){ if (t[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; } }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  const h = rows.shift(); if (!h) return [];
  return rows.filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(h.map((k, j) => [k, (r[j] || '').trim()])));
}

// Replace this platform's rows in `file` with `rows`; keep every other platform untouched.
export function mergeWrite(file, platform, rows, cols){
  const keep = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')).filter(r => r.platform !== platform) : [];
  const all = keep.concat(rows);
  fs.writeFileSync(file, cols.join(',') + '\n' + all.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n') + '\n');
  return { kept: keep.length, added: rows.length };
}
