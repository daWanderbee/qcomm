#!/usr/bin/env python3
"""Build qcomm-report.xlsx — the whole picture in one workbook, from the data/ feeds.
Sheets map to the business questions: competitor prices, rankings & gaps, best-sellers
by city, keyword opportunities, competitor leaderboard. Run: python tools/build-excel.py
"""
import os, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')

def read(name):
    p = os.path.join(D, name + '.csv')
    return pd.read_csv(p, dtype=str).fillna('') if os.path.exists(p) else pd.DataFrame()

rank, comp, sales = read('rank'), read('competitors'), read('sales')
skus, pricing, kv, ads = read('skus'), read('pricing'), read('keyword_volume'), read('ads')

name_of = dict(zip(skus.get('internal_sku', []), skus.get('product_name', []))) if len(skus) else {}
def pname(sku): return name_of.get(sku, sku)
def numcol(df, c): return pd.to_numeric(df[c], errors='coerce') if c in df else pd.Series(dtype=float)

sheets = {}

# 1) Rankings & gaps — per platform, per keyword: your best rank vs competitors
if len(comp) or len(rank):
    rows = []
    plats = sorted(set(list(comp.get('platform', [])) + list(rank.get('platform', []))))
    for p in plats:
        pr, pc = rank[rank.platform == p] if len(rank) else rank, comp[comp.platform == p] if len(comp) else comp
        kws = sorted(set(list(pc.get('keyword', [])) + list(pr.get('keyword', []))))
        for k in kws:
            mine = pd.to_numeric(pr[pr.keyword == k]['rank'], errors='coerce').min() if len(pr) else None
            ck = pc[pc.keyword == k].copy()
            ck['rnk'] = pd.to_numeric(ck['rank'], errors='coerce')
            top = ck.sort_values('rnk').head(1)
            rows.append({'platform': p, 'keyword': k,
                         'your_best_rank': int(mine) if pd.notna(mine) else '',
                         'status': 'ranked' if pd.notna(mine) else 'GAP — not listed',
                         'top_competitor': (top['competitor'].iloc[0] if len(top) else ''),
                         'competitors_seen': len(ck)})
    sheets['Rankings_Gaps'] = pd.DataFrame(rows)

# 2) Competitor prices — same-keyword rivals with price/rating (Q1)
if len(comp):
    cp = comp.copy()
    cp['price'] = numcol(cp, 'price'); cp['rank_'] = numcol(cp, 'rank')
    sheets['Competitor_Prices'] = (cp.sort_values(['platform', 'keyword', 'rank_'])
        [['platform', 'keyword', 'rank', 'competitor', 'product', 'price', 'rating']])

# 3) Best-sellers by city — top Chuk products per city (Q4)
if len(sales):
    s = sales.copy()
    s['units'] = numcol(s, 'units'); s['revenue'] = numcol(s, 'revenue')
    s['product'] = s['internal_sku'].map(pname)
    g = (s.groupby(['city', 'product'], as_index=False).agg(units=('units', 'sum'), revenue=('revenue', 'sum')))
    top_cities = g.groupby('city')['revenue'].sum().sort_values(ascending=False).head(10).index
    g = g[g.city.isin(top_cities)].sort_values(['city', 'revenue'], ascending=[True, False])
    sheets['BestSellers_byCity'] = g.groupby('city').head(5)

# 4) Keyword opportunities — volume signal (ad impressions) + your ad spend (Q3)
if len(kv):
    k = kv.copy()
    k['ad_impressions'] = numcol(k, 'ad_impressions'); k['autocomplete_rank'] = numcol(k, 'autocomplete_rank')
    sheets['Keyword_Volume'] = (k.sort_values(['platform', 'ad_impressions'], ascending=[True, False])
        [['platform', 'keyword', 'ad_impressions', 'autocomplete_rank']])

# 5) Competitor leaderboard — who shows up most / best avg rank (Q1)
if len(comp):
    c = comp.copy(); c['rank_'] = numcol(c, 'rank')
    lb = c.groupby(['platform', 'competitor']).agg(appearances=('product', 'count'),
        avg_rank=('rank_', 'mean')).reset_index().sort_values(['platform', 'appearances'], ascending=[True, False])
    lb['avg_rank'] = lb['avg_rank'].round(1)
    sheets['Competitor_Leaderboard'] = lb

out = os.path.join(ROOT, 'qcomm-report.xlsx')
with pd.ExcelWriter(out, engine='openpyxl') as w:
    if not sheets:
        pd.DataFrame({'note': ['No data yet — run the collectors first.']}).to_excel(w, 'README', index=False)
    for nm, df in sheets.items():
        df.to_excel(w, sheet_name=nm[:31], index=False)
print('wrote', out, '| sheets:', ', '.join(sheets) or 'README')
