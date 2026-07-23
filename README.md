# Pakka Q-Commerce IQ

A standalone marketing-intelligence dashboard for q-commerce. Upload your monthly
exports → it answers across 13 intelligence domains. No backend, no build step,
no database.

## How it works
- **Upload data** tab: download templates, upload each monthly export. Every feed
  you add unlocks more of the dashboard. Missing feeds are labelled, not broken.
- **Dashboard** tab: a sidebar of intelligence domains, each showing its questions
  answered live from your data. The sidebar shows **ready/total** per domain.
- **Load full sample** to see one month of demo data light up every domain at once.

Data is stored in the browser (localStorage). It stays on your machine.

## The feeds (upload once a month)
Templates are in `/templates` and downloadable in-app. Keep headers exact.

| Feed | Columns | Unlocks |
|------|---------|---------|
| `sales.csv` | date, platform, internal_sku, city, units, revenue | Sales, Marketplace, Geographic |
| `skus.csv` | internal_sku, product_name, category, pack_size | product names, categories |
| `ads.csv` | date, platform, campaign, keyword, internal_sku, spend, impressions, clicks, attributed_sales | Advertising, Keywords, Profitability |
| `rank.csv` | date, platform, keyword, internal_sku, city, rank | Keyword rank / losing rankings |
| `reviews.csv` | date, platform, internal_sku, rating, review_text | Customer (themes, rating trend) |
| `inventory.csv` | date, platform, internal_sku, warehouse, stock_on_hand | Inventory, stockout forecast |
| `competitors.csv` | date, platform, competitor, product, price, rating, is_new, sponsored | Competitors, Pricing |
| `cost.csv` | internal_sku, unit_cost, platform_fee_pct | Profitability (margin after ads) |
| `returns.csv` | date, platform, internal_sku, units_returned | Marketplace return rate |
| `listing.csv` | platform, internal_sku, image_count, title, has_aplus, attributes_missing | Content (images, A+, attributes, SEO) |
| `keyword_volume.csv` | platform, keyword, volume_index, competition, trend | Keyword volume, low-competition, emerging |
| `festivals.csv` | date, name, lift_pct, category | Forecast (festival impact) |

The app answers **70 questions** across 13 domains; each lights up when its feed
is present. A few questions (bundles, price-elasticity, inventory ageing,
competitor listing snapshots) show what extra data they need.

`sales.csv` is the minimum. The **Recommendations** page synthesises actions
across whatever feeds are present, ranked by severity × impact.

## Deploy to Vercel (zero config — static site)
```
npm i -g vercel
cd qcomm
vercel --prod
```
Or push to GitHub → import in Vercel → preset **Other** → Deploy. No env vars.

## Honest limits
- **Monthly cadence = monthly alerts.** Aggregate questions (what sold, profit,
  ROAS, who moved) are answered well. Time-sensitive ones (stockout-in-6-days,
  overnight rank drop) are only as fresh as your last upload — upload weekly if
  you want faster warnings.
- **Content domain** (listing images / titles / CTR) needs a listing-scrape feed,
  not a monthly CSV — shown as a gap.
- **Not available from q-comm data at all:** customer-level repeat purchase,
  organic (non-ad) CTR, audience-level ad breakdowns.

## Deliberately not built yet (ponytail)
- **Shared/persistent storage** — localStorage is per-browser. Swap in Supabase
  when multiple people need the data. Only `load()`/`save()` change.
- **Competitor / rank / review feeds** are populated by upload today; automate
  later via QuickCommerceAPI (rent) or an Apify actor (build) — rent is cheaper
  at this volume.
