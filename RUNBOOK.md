# Monthly Run Checklist

Cadence: **1st of each month.** Keep the schema exact (see `README.md`);
everything downstream depends on it.

## Least-work mode (≈10 min)
The app **auto-loads any CSV in the repo `data/` folder** on open — no manual
upload. So the goal each month is simply: *get the CSVs into `data/`, then open
the dashboard.*

- **Automatic (zero touch):** the monthly cron already commits `keyword_volume.csv`.
  Add API-based collectors (Amazon/Flipkart/QCA) and those feeds refresh themselves too.
- **Manual (the irreducible bit):** export the reports that sit behind a login
  (own sales/ads/reviews for no-API portals), drop the files into `data/`, commit.
- **Then:** open the app → it syncs → read **Recommendations**, mark last month's
  actions done. That's it.

The full checklist below is the thorough version; in steady state you only touch
step 2 (export) and step 5 (act).

---

## 0 · Before you start (2 min)
- [ ] Open the app (Vercel URL) → **Recommendations** tab. Note which of last
      month's actions you actually did — you'll grade them in step 5.

## 1 · Collect market data (competitor / rank / keyword volume)
- [ ] **Automated (free keyword discovery):** the `Monthly collect` GitHub Action
      runs on the 1st and writes `data/keyword_volume.csv`. To run it now:
      **Actions tab → Monthly collect → Run workflow.** Download the CSV from `data/`.
- [ ] **Rented (competitor + rank — recommended):** run your QuickCommerceAPI /
      Apify monthly job. Export `rank.csv` and `competitors.csv`.
- [ ] *(Optional, real volume)* add `ad_impressions` + `amazon_sqp_rank` columns
      to `keyword_volume.csv` from your ad reports / Brand Analytics.

## 2 · Export your own reports (only you can get these)
From each platform's seller/brand portal, export **last month**:

| Feed | Source | Notes |
|------|--------|-------|
| `sales.csv` | brand portal — sales/orders report | the one that lights up the dashboard |
| `ads.csv` | ad console (spend, impressions, clicks, attributed sales) | per campaign/keyword |
| `reviews.csv` | ratings/reviews export | include `review_text` for themes |
| `inventory.csv` | WMS / platform stock report | latest stock per warehouse |
| `returns.csv` | returns report | Amazon/Flipkart provide it; q-comm rarely |
| `listing.csv` | listing audit | image_count, title, has_aplus, attributes_missing |
| `cost.csv` | your finance sheet (COGS + platform fee %) | update **only when costs change** |

## 3 · Normalise columns (10 min)
- [ ] Rename each export's headers to match the app schema (README table).
- [ ] Keep `internal_sku` consistent across every file (your `skus.csv` is the master).

## 4 · Get the data in (auto)
- [ ] Commit your CSVs to the repo `data/` folder (`git add data/ && git commit && git push`).
- [ ] Open the app — it **auto-syncs** from `data/` on load; no manual upload needed.
      (Manual **Upload data** still works for one-off/local files.)

## 5 · Review, act, and let it learn
- [ ] **Recommendations** tab: work this month's ranked action list, top-down.
- [ ] Mark last month's actions **Done / Dismiss** → the **Learning** tab reweights
      by what actually worked. This is the self-improving loop's monthly tick.
- [ ] **Keyword Volume** tab: pick up any new *Attack* / *Ride trend* keywords.

## 6 · Archive
- [ ] The cron commits `data/keyword_volume.csv` automatically. If you collect the
      other feeds by hand, drop them in `data/YYYY-MM/` and commit, so you keep a
      month-by-month history (this is what powers trend + seasonality over time).

---

**Honest reminder:** monthly upload = monthly freshness. "Stockout in 6 days" and
overnight rank drops won't surface mid-month. If those matter, run **inventory +
rank weekly** and keep everything else monthly.
