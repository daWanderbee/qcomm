#!/usr/bin/env python3
"""Convert raw q-commerce platform exports (data/raw/*) into the app's feed CSVs
(data/sales.csv, data/skus.csv, data/ads.csv).

Feed type is detected by COLUMNS, not filename, so next month's differently-named
exports still ingest. Add a new platform by adding a branch in classify()/convert.
Run: python tools/raw-to-feeds.py
"""
import csv, glob, os, re, sys, zipfile
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW  = os.path.join(ROOT, 'data', 'raw')
OUT  = os.path.join(ROOT, 'data')

def iso(s):
    """Normalise any of: Excel serial, DD-MM-YYYY, YYYY-MM-DD[ hh:mm:ss] -> YYYY-MM-DD."""
    s = str(s).strip()
    if s == '': return ''
    if re.fullmatch(r'\d+(\.0+)?', s):                    # Excel serial day
        return (date(1899, 12, 30) + timedelta(days=int(float(s)))).isoformat()
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s)           # ISO (maybe with time)
    if m: return '%s-%s-%s' % m.groups()
    m = re.match(r'(\d{2})-(\d{2})-(\d{4})', s)           # DD-MM-YYYY
    if m: return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
    return s

# ---- xlsx (stdlib only): read sheet1 positionally so a blank index column can't misalign ----
def col_idx(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0): n = n*26 + (ord(ch)-64)
    return n-1

def read_xlsx_sheet1(path):
    z = zipfile.ZipFile(path)
    ss = re.findall(r'<t[^>]*>(.*?)</t>', z.read('xl/sharedStrings.xml').decode('utf-8','ignore'), re.S)
    x = z.read('xl/worksheets/sheet1.xml').decode('utf-8','ignore')
    out = []
    for r in re.findall(r'<row[^>]*>(.*?)</row>', x, re.S):
        row = {}
        for ref, typ, v in re.findall(r'<c r="([A-Z]+\d+)"(?:[^>]*?t="([^"]*)")?[^>]*?>(?:<v>(.*?)</v>)?', r):
            if v == '': continue
            row[col_idx(ref)] = ss[int(v)] if typ == 's' else v
        out.append(row)
    return out

def classify_csv(header):
    h = set(header)
    if {'Targeting Value', 'Direct Sales'} <= h: return 'blinkit_ads'
    if {'Ad Spend', 'Ad Revenue'} <= h:          return 'bigbasket_ads'
    return None

def num(v): return (str(v).strip() or '0')

def main():
    sales, skus, ads = [], {}, []

    for path in sorted(glob.glob(os.path.join(RAW, '*'))):
        low = path.lower()
        if low.endswith('.xlsx'):
            rows = read_xlsx_sheet1(path)
            hdr = rows[0]
            names = {v: k for k, v in hdr.items()}            # header text -> col index
            if 'ITEM_CODE' not in names or 'GMV' not in names:
                print('  skip (unknown xlsx):', os.path.basename(path)); continue
            for r in rows[1:]:
                g = lambda name: r.get(names.get(name, -1), '')
                item = g('ITEM_CODE')
                if not item: continue
                sales.append({'date': iso(g('ORDERED_DATE')), 'platform': 'blinkit',
                              'internal_sku': item, 'city': g('CITY'),
                              'units': num(g('UNITS_SOLD')), 'revenue': num(g('GMV'))})
                if item not in skus:
                    skus[item] = {'internal_sku': item, 'product_name': g('PRODUCT_NAME'),
                                  'category': g('L3_CATEGORY')}
            print('  blinkit sales:', os.path.basename(path))
        elif low.endswith('.csv'):
            with open(path, encoding='utf-8-sig', errors='replace', newline='') as f:
                rd = list(csv.DictReader(f))
            kind = classify_csv(rd[0].keys()) if rd else None
            if kind == 'blinkit_ads':
                for r in rd:
                    kw = r.get('Targeting Value', '') if r.get('Targeting Type') == 'Keyword' else ''
                    ads.append({'date': iso(r['Date']), 'platform': 'blinkit',
                                'spend': num(r.get('Estimated Budget Consumed')),
                                'impressions': num(r.get('Impressions')), 'clicks': '',
                                'attributed_sales': str(float(num(r.get('Direct Sales'))) + float(num(r.get('Indirect Sales')))),
                                'keyword': kw, 'internal_sku': ''})
                print('  blinkit ads:', os.path.basename(path))
            elif kind == 'bigbasket_ads':
                for r in rd:
                    ads.append({'date': iso(r['Date']), 'platform': 'bigbasket',
                                'spend': num(r.get('Ad Spend')), 'impressions': num(r.get('Ad Impressions')),
                                'clicks': '', 'attributed_sales': num(r.get('Ad Revenue')),
                                'keyword': '', 'internal_sku': r.get('Product ID', '')})
                print('  bigbasket ads:', os.path.basename(path))
            else:
                print('  skip (unknown csv):', os.path.basename(path))

    def write(name, rows, cols):
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
        print('wrote %s (%d rows)' % (name, len(rows)))

    write('sales.csv', sales, ['date','platform','internal_sku','city','units','revenue'])
    write('skus.csv',  list(skus.values()), ['internal_sku','product_name','category'])
    write('ads.csv',   ads, ['date','platform','spend','impressions','clicks','attributed_sales','keyword','internal_sku'])

    # ponytail: one self-check — dates normalise and columns don't misalign
    assert iso('46226') == '2026-07-23', iso('46226')
    assert iso('06-05-2026') == '2026-05-06'
    assert iso('2026-06-14 00:00:00') == '2026-06-14'
    assert all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', s['date']) for s in sales[:50]), 'bad sales date'
    assert all(float(s['revenue']) >= 0 for s in sales[:50]), 'bad revenue'
    print('self-check OK')

if __name__ == '__main__':
    main()
