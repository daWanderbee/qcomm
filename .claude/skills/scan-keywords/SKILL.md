---
name: scan-keywords
description: Live keyword mapping for Q-Commerce IQ. On demand, scans BigBasket for real rank + competitor + rating data via Apify (cost-capped to stay inside the free credit) and refreshes the autocomplete + festival keyword volume, then rebuilds the app data and reports what changed. Use when the user wants a fresh keyword scan now instead of waiting for the monthly cron. Optional arguments = specific keywords to scan just those (comma-separated).
---

# /scan-keywords — live keyword mapping

Run from the project root (`C:\Users\Asmita\documents\asmita\apps\qcomm`). Refresh the keyword mapping on demand and report what changed. If the user passed keywords as arguments, scan only those; otherwise scan the full seed list.

## 1. Load the Apify token — NEVER print, log, or commit it
```bash
TOKEN=$(cat tools/.apify-token 2>/dev/null || printf '%s' "$APIFY_TOKEN")
```
If `$TOKEN` is empty: tell the user to create `tools/.apify-token` containing their Apify API token (it's gitignored, never committed) and stop here.

## 2. BigBasket rank + competitors (real data, cost-capped)
The `--max-cost` cap keeps spend inside the Apify free $5 credit — do **not** raise it without asking the user.
```bash
# full seed list:
APIFY_TOKEN="$TOKEN" node tools/collect-bigbasket.mjs --brand Chuk --per-kw 20 --max-cost 1.5 --seeds data/seeds.txt
# OR, if the user gave keywords as arguments (e.g. /scan-keywords disposable plate, paper cup):
APIFY_TOKEN="$TOKEN" node tools/collect-bigbasket.mjs --brand Chuk --per-kw 20 --max-cost 0.5 --keywords "<arguments>"
```
Writes `data/rank.csv` (where Chuk ranks) and `data/competitors.csv`.

## 3. Keyword volume — free (Google autocomplete + upcoming festivals)
```bash
node tools/collect-keywords.mjs --seeds data/seeds.txt --festivals data/festivals.csv \
  --festival-window 60 --platforms "Blinkit,Zepto,Instamart,Amazon Now,BigBasket,Flipkart Minutes" \
  --depth 1 > data/keyword_volume.csv
```

## 4. Rebuild the viewable offline app
```bash
python tools/make-offline.py
```
(The hosted app auto-loads the CSVs on its own; this only refreshes the local `qcomm-offline.html`.)

## 5. Report to the user
- **Where you rank vs gaps**: from `rank.csv`, which keywords Chuk appears for and their best rank; from `competitors.csv`, keywords that returned competitors but **no** Chuk row = visibility gaps (you sell it, you don't show up).
- **Top competitor brands** across the scan.
- **Keyword volume** row count and any **upcoming festival keywords** added this run.
- **Apify spend**: `rows_saved × $0.002`, and that it stays inside the free credit.
- Remind: run `git push origin master` (via the `!` prefix) to publish the refresh to the hosted app.

## Guardrails
- Never echo, log, or commit the token. It lives only in `tools/.apify-token` (gitignored) or `$APIFY_TOKEN`.
- Keep `--max-cost` ≤ 1.5 for a full scan unless the user explicitly asks for more.
- Instamart real data is **not** included here — its actor demands full account access. This skill uses BigBasket (clean, no-login) for real rank/competitor data.
