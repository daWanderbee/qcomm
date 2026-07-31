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
    if {'Targeting Value', 'Direct Sales'} <= h:     return 'blinkit_ads'
    if {'Ad Spend', 'Ad Revenue'} <= h:              return 'bigbasket_ads'
    if {'SkuCode', 'WarehouseQtyAvailable'} <= h:    return 'instamart_inventory'
    return None

def num(v): return (str(v).strip() or '0')

def rating_num(s):
    """'4+' -> 4.0, '4.5999..' -> 4.6, '' -> None."""
    s = str(s).strip().rstrip('+')
    try: return round(float(s), 1)
    except ValueError: return None

def main():
    sales, skus, ads, inv, reviews, pricing = [], {}, [], {}, [], []

    for path in sorted(glob.glob(os.path.join(RAW, '*'))):
        low = path.lower()
        if low.endswith('.xlsx'):
            rows = read_xlsx_sheet1(path)
            hdr = rows[0]
            names = {v: k for k, v in hdr.items()}            # header text -> col index
            if 'ITEM_CODE' not in names or 'GMV' not in names:
                # mrp sheet: two blocks (INSTA cols 1-4, BB cols 5-8), header in row 2, RATING per platform
                flat = ' '.join(v for r in rows[:3] for v in r.values())
                if 'RATING' in flat and 'MRP' in flat:
                    skumap = {(v['product_name'] or '').strip().lower(): k for k, v in skus.items()}
                    def money(v):
                        try: return round(float(str(v).strip()), 2)
                        except (ValueError, TypeError): return None
                    for r in rows[2:]:
                        iname = (r.get(1) or '').strip()
                        isku = (skumap.get(iname.lower()) or iname) if iname else ''
                        irat = rating_num(r.get(4, ''))
                        if irat is not None and iname:
                            # use the SKU code when the name matches sales, else the name itself so
                            # name() still renders a readable label in the by-product rating view
                            reviews.append({'platform': 'instamart', 'internal_sku': isku,
                                            'rating': irat, 'review_text': '', 'product_name': iname})
                        imrp, isp = money(r.get(2)), money(r.get(3))
                        if iname and imrp and isp:
                            pricing.append({'platform': 'instamart', 'internal_sku': isku,
                                            'product': iname, 'mrp': imrp, 'sp': isp})
                        bname = (r.get(5) or '').strip()
                        brat = rating_num(r.get(8, ''))
                        if brat is not None and bname:
                            reviews.append({'platform': 'bigbasket', 'internal_sku': bname,
                                            'rating': brat, 'review_text': '', 'product_name': bname})
                        bmrp, bsp = money(r.get(6)), money(r.get(7))
                        if bname and bmrp and bsp:
                            pricing.append({'platform': 'bigbasket', 'internal_sku': bname,
                                            'product': bname, 'mrp': bmrp, 'sp': bsp})
                    print('  mrp sheet -> reviews (ratings) + pricing (MRP/SP):', os.path.basename(path))
                else:
                    print('  skip (unknown xlsx):', os.path.basename(path))
                continue
            for r in rows[1:]:
                g = lambda name: r.get(names.get(name, -1), '')
                item = g('ITEM_CODE')
                if not item: continue
                sales.append({'date': iso(g('ORDERED_DATE')), 'platform': 'instamart',
                              'internal_sku': item, 'city': g('CITY'),
                              'units': num(g('UNITS_SOLD')), 'revenue': num(g('GMV'))})
                if item not in skus:
                    skus[item] = {'internal_sku': item, 'product_name': g('PRODUCT_NAME'),
                                  'category': g('L3_CATEGORY')}
            print('  instamart sales (total GMV):', os.path.basename(path))
        elif low.endswith('.csv'):
            with open(path, encoding='utf-8-sig', errors='replace', newline='') as f:
                rd = list(csv.DictReader(f))
            kind = classify_csv(rd[0].keys()) if rd else None
            if kind == 'blinkit_ads':
                for r in rd:
                    kw = r.get('Targeting Value', '') if r.get('Targeting Type') == 'Keyword' else ''
                    d_sales = float(num(r.get('Direct Sales'))) + float(num(r.get('Indirect Sales')))
                    ads.append({'date': iso(r['Date']), 'platform': 'blinkit',
                                'spend': num(r.get('Estimated Budget Consumed')),
                                'impressions': num(r.get('Impressions')), 'clicks': '',
                                'attributed_sales': str(d_sales), 'keyword': kw, 'internal_sku': ''})
                # Option A: Blinkit stays in ads only — its report is keyword-level ad-attributed
                # with no product detail, so it's kept OUT of the sales feed. Add a Blinkit orders
                # export (units + GMV + item codes) to get real Blinkit sales.
                print('  blinkit ads (ads only, excluded from sales):', os.path.basename(path))
            elif kind == 'bigbasket_ads':
                for r in rd:
                    ads.append({'date': iso(r['Date']), 'platform': 'bigbasket',
                                'spend': num(r.get('Ad Spend')), 'impressions': num(r.get('Ad Impressions')),
                                'clicks': '', 'attributed_sales': num(r.get('Ad Revenue')),
                                'keyword': '', 'internal_sku': r.get('Product ID', '')})
                    pid = r.get('Product ID', '')
                    sales.append({'date': iso(r['Date']), 'platform': 'bigbasket',
                                  'internal_sku': pid, 'city': '',
                                  'units': num(r.get('Orders (SKU)')), 'revenue': num(r.get('Ad Revenue'))})
                    if pid and pid not in skus:
                        skus[pid] = {'internal_sku': pid, 'product_name': r.get('Product Name', pid),
                                     'category': r.get('Category', '—')}
                print('  bigbasket ads + ad-attributed sales:', os.path.basename(path))
            elif kind == 'instamart_inventory':
                for r in rd:
                    sku = (r.get('SkuCode') or '').strip()
                    wh  = (r.get('FacilityName') or '').strip()
                    if not sku: continue
                    inv[(sku, wh)] = {'date': '', 'platform': 'instamart', 'internal_sku': sku,
                                      'warehouse': wh or (r.get('City') or '').strip(),
                                      'stock_on_hand': num(r.get('WarehouseQtyAvailable'))}
                    if sku not in skus:   # inventory carries product names sales may not have
                        skus[sku] = {'internal_sku': sku, 'product_name': r.get('SkuDescription', sku),
                                     'category': r.get('L2', '—')}
                print('  instamart inventory (per facility):', os.path.basename(path))
            else:
                print('  skip (unknown csv):', os.path.basename(path))

    def write(name, rows, cols):
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
        print('wrote %s (%d rows)' % (name, len(rows)))

    write('sales.csv', sales, ['date','platform','internal_sku','city','units','revenue'])
    write('skus.csv',  list(skus.values()), ['internal_sku','product_name','category'])
    write('ads.csv',   ads, ['date','platform','spend','impressions','clicks','attributed_sales','keyword','internal_sku'])
    write('inventory.csv', list(inv.values()), ['date','platform','internal_sku','warehouse','stock_on_hand'])
    write('reviews.csv', reviews, ['platform','internal_sku','rating','review_text','product_name'])
    write('pricing.csv', pricing, ['platform','internal_sku','product','mrp','sp'])

    # ponytail: one self-check — dates normalise and columns don't misalign
    assert rating_num('4+') == 4.0 and rating_num('4.5999999999999996') == 4.6 and rating_num('') is None
    assert iso('46226') == '2026-07-23', iso('46226')
    assert iso('06-05-2026') == '2026-05-06'
    assert iso('2026-06-14 00:00:00') == '2026-06-14'
    assert all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', s['date']) for s in sales[:50]), 'bad sales date'
    assert all(float(s['revenue']) >= 0 for s in sales[:50]), 'bad revenue'
    print('self-check OK')

if __name__ == '__main__':
    main()
