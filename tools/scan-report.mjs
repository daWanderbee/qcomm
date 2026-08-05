#!/usr/bin/env node
// Prints a chat-friendly, PER-PLATFORM summary of the latest scan (data/rank.csv + data/competitors.csv):
// where your brand ranks, true visibility gaps, and who owns each keyword's top 3.
// Used by the /scan-keywords skill so results show in the chat, not just the app.

import fs from 'node:fs';

function parseCSV(t){
  const rows=[]; let row=[],cur='',q=false; t=t.replace(/\r/g,'');
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else{ if(c==='"')q=true; else if(c===','){row.push(cur);cur='';}
      else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';} else cur+=c; } }
  if(cur!==''||row.length){row.push(cur);rows.push(row);}
  const h=rows.shift(); if(!h) return []; return rows.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(h.map((k,j)=>[k,(r[j]||'').trim()])));
}
const read = f => fs.existsSync(f) ? parseCSV(fs.readFileSync(f,'utf8')) : [];

const rank=read('data/rank.csv'), comp=read('data/competitors.csv');
if(!rank.length && !comp.length){ console.log('No scan data yet. Run tools/collect-bigbasket.mjs / collect-instamart.mjs first.'); process.exit(0); }
const seeds=fs.existsSync('data/seeds.txt')
  ? fs.readFileSync('data/seeds.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean)
  : [...new Set(comp.map(r=>r.keyword))];

const platforms=[...new Set([...rank,...comp].map(r=>r.platform))].filter(Boolean);

for(const plat of platforms){
  const pr=rank.filter(r=>r.platform===plat), pc=comp.filter(r=>r.platform===plat);
  const byKw={}; pc.forEach(r=>{(byKw[r.keyword]=byKw[r.keyword]||[]).push(r);});
  Object.values(byKw).forEach(a=>a.sort((x,y)=>(+x.rank||99)-(+y.rank||99)));
  const myBest={}; pr.forEach(r=>{const v=+r.rank; if(!myBest[r.keyword]||v<myBest[r.keyword])myBest[r.keyword]=v;});

  let ranked=0,gap=0,none=0; const gaps=[];
  console.log('\n===== ' + plat.toUpperCase() + ' =====');
  console.log('KEYWORD                    YOU        WHO OWNS THE TOP (rank order)');
  console.log('-'.repeat(78));
  for(const k of seeds){
    const c=byKw[k]||[];
    const top=c.slice(0,3).map(x=>'#'+x.rank+' '+x.competitor).join(', ');
    let me;
    if(myBest[k]){me='#'+myBest[k];ranked++;}
    else if(c.length){me='ABSENT';gap++;gaps.push(k);}
    else {me='(no results)';none++;}
    console.log(k.padEnd(26)+me.padEnd(11)+(top||'—'));
  }
  console.log('-'.repeat(78));
  console.log(`SUMMARY: ranked ${ranked} | true gaps ${gap} | no results ${none} (of ${seeds.length})`);
  if(gaps.length) console.log('FIX FIRST (you sell it, you don\'t show up): '+gaps.join(', '));
  const bc={}; pc.forEach(r=>{bc[r.competitor]=(bc[r.competitor]||0)+1;});
  if(Object.keys(bc).length) console.log('TOP RIVALS: '+Object.entries(bc).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([b,n])=>`${b}(${n})`).join('  '));
}
