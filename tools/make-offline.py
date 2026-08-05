#!/usr/bin/env python3
"""Bake the current data/ CSVs into a single self-contained qcomm-offline.html.

The offline file overrides load() with baked CSV text so it works on file:// with no
server/sync — for opening locally. The hosted app (index.html) still auto-loads from
the repo, so this is only for the offline copy. Run: python tools/make-offline.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEEDS = ['sales', 'skus', 'ads', 'keyword_volume', 'festivals', 'inventory',
         'reviews', 'pricing', 'rank', 'competitors']

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
feeds = {}
for f in FEEDS:
    p = os.path.join(ROOT, 'data', f + '.csv')
    if os.path.exists(p):
        feeds[f] = open(p, encoding='utf-8').read()

# Inject right before the initial render, bypassing localStorage/sync entirely.
inject = ('window.__BAKED=' + json.dumps(feeds) +
          ';load=function(f){return window.__BAKED[f]?parseCSV(window.__BAKED[f]):[];};\n')
marker = "loadAll();renderNav('Overview');renderDomain('Overview');"
assert marker in html, 'render marker not found in index.html'
out = html.replace(marker, inject + marker, 1)

open(os.path.join(ROOT, 'qcomm-offline.html'), 'w', encoding='utf-8').write(out)
print('wrote qcomm-offline.html  %.1f MB  | feeds: %s' % (len(out) / 1e6, ','.join(feeds)))
