# Lazada vouchers, codes and the 10.10 sale

This guide explains how Lazada Vietnam vouchers and checkout codes work, what the 10.10 2026 sale offered, and how to collect current offers automatically with `scripts/collect-promotions.mjs`. Collected results are written to [`docs/acceptance/promotions-10-10/`](acceptance/promotions-10-10/README.md).

Vouchers change by the hour and are personalised per account. Everything below is a lead until checkout shows the discount for your own cart.

## 10.10 2026: how the sale works

10.10 ("Sale Đỉnh") is Lazada's October mega-sale. It runs **07.10 – 12.10.2026** in two phases (Vietnam time, UTC+7):

| Phase                | Window                                        | What happens                                                                                                 |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Collection           | 07.10 00:00 – 09.10 19:59                     | Collect vouchers, earn coins and LazRewards points, add items to the cart. Only Voucher MAX can be used now. |
| Sale                 | 09.10 20:00 – 12.10 23:59                     | Collected vouchers activate, prices drop, brand gifts appear.                                                |
| Combo MAX peak       | 09.10 20:00–22:00 and 10.10 00:00–02:00       | New Combo MAX batches (biggest vouchers).                                                                    |
| LazMall golden slots | 00:00, 12:00 and 20:00 daily from 09.10 20:00 | Brand drops up to 50% off, brand vouchers up to 20%.                                                         |
| LazFlash             | Hourly slots                                  | Subsidised flash deals up to 70% off.                                                                        |

Vouchers are collected from 07.10 to 12.10 and used from 09.10 20:00 to 12.10 23:59.

Sources: the App Store listing ("Sale Đỉnh bắt đầu từ 20h ngày 09.10 đến 12.10.2026"), [magiamgialazada.vn](https://magiamgialazada.vn/lazada-10-10/) and [magiamgia.com](https://magiamgia.com/lazada-sale-10-10/) (both 07–08.10.2026, identical lists), and the [iPrice 10.10 posts](https://iprice.vn/o-nha-mua-sam/sale-10-10-voucher-lazada-giam-gia-12-toi-da-100k-cho-don-tu-400k/). Lazada's banners on 11.10 confirm the 0h/12h/20h LazMall slots ("Brand voucher up to 20%, golden timeslot 0H-12H-20H").

Lazada's own main campaign page is `wh_pid=/lazada/megascenario/vn/sale-10-10-2026/trang-chinh`; the bare `…/sale-10-10-2026` path returns "Page Not Found". Sub-pages: `/lazmall`, `/lazglobal`, `/ban-chay`, `/bachhoa-mebe`, `/lam-dep`, `/doi-song`, `/dien-tu`, `/thoi-trang`.

### Lazada-wide vouchers (toàn sàn)

Collected without a code on the voucher hub (signed in) or the 10.10 page.

**Voucher MAX**: all categories except electronics.

| Discount | Max saving | Min. order | Order size where the cap is reached |
| -------: | ---------: | ---------: | ----------------------------------: |
|      10% |     20,000 |    150,000 |                             200,000 |
|      12% |     45,000 |    250,000 |                             375,000 |
|      12% |    100,000 |    400,000 |                             833,333 |
|      14% |    150,000 |    600,000 |                           1,071,429 |
|      12% |    500,000 |  1,000,000 |                           4,166,667 |
|      12% |  1,000,000 |  5,000,000 |                           8,333,333 |
|      18% | 10,000,000 |  5,000,000 |                          55,555,556 |

**Voucher MAX, electronics**: 10% off, max saving 1,000,000, min. order 2,000,000.

**FreeShip MAX**: shipping discount, only on items with the "Freeship Max" tag.

| Shipping discount | Min. order |
| ----------------: | ---------: |
|            20,000 |     50,000 |
|            30,000 |    200,000 |
|            40,000 |    300,000 |
|            45,000 |    500,000 |

**Combo MAX**: one Voucher MAX plus one FreeShip MAX on the same order.

- Voucher MAX up to 10M + FreeShip up to 500K on FreeShip-tagged items.
- Voucher MAX up to 3M for beauty, fashion and home appliances + FreeShip MAX up to 70K for LazMall items.

Coupon sites also list everyday platform FreeShip vouchers, undated: 20K off from 29K for "Sale hết dưới 49K" items, and 20K off from 45K ([anhvoucher](https://anhvoucher.com/ma-giam-gia/lazada/)).

**Best single platform voucher by order total** (computed with `voucherValue` in `src/promotions.js`):

| Order total (₫) | Best voucher | Saving (₫) | Effective |
| --------------: | ------------ | ---------: | --------: |
|         200,000 | 10% max 20K  |     20,000 |       10% |
|         300,000 | 12% max 45K  |     36,000 |       12% |
|         500,000 | 12% max 100K |     60,000 |       12% |
|       1,000,000 | 14% max 150K |    140,000 |       14% |
|       2,000,000 | 12% max 500K |    240,000 |       12% |
|       4,000,000 | 12% max 500K |    480,000 |       12% |
|       5,000,000 | 18% max 10M  |    900,000 |       18% |

Add FreeShip MAX on top (e.g. 45K off shipping from 500K). The jump at 5,000,000 ₫ matters for bulk buying. A 4.6M basket gets 12% (500K max) and pays 4.1M. A 5.0M basket gets 18% (900K) and also pays 4.1M, so the extra 400K of goods is effectively free.

### Category vouchers (ngành hàng)

| Category                       | Vouchers (discount, max saving, min. order)                                         |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Home appliances & TV           | 14%, 2M, 2M                                                                         |
| Electronic parts & accessories | 17%, 108K, 350K                                                                     |
| Home & living                  | 12%, 100K, 300K · 14%, 300K, 400K · 16%, 300K, 600K · 20%, 1M, 2M                   |
| Fashion                        | 14%, 120K, 250K · 18%, 200K, 350K · 16%, 250K, 900K · 18%, 400K, 2M · 22%, 500K, 2M |
| Health & beauty                | 14%, 50K, 150K · 18%, 300K, 350K · 25%, 1.2M, 1M                                    |

### TMALL vouchers (TMALL-labelled items on Lazada)

| Discount | Max saving | Min. order | Applies to                |
| -------: | ---------: | ---------: | ------------------------- |
|      20% |    150,000 |     99,000 | All TMALL items           |
|      16% |    500,000 |  1,000,000 | All TMALL items           |
|      28% |    200,000 |    149,000 | Consumer goods and beauty |
|      25% |    180,000 |    149,000 | Fashion                   |
|      30% |    250,000 |    199,000 | Lifestyle                 |

### Other 10.10 programmes

- **LazMall brand party**: up to 50% off at 0h/12h/20h. Livestreams drop extra vouchers of up to 50%.
- **LazFlash**: subsidised flash deals of up to 70%, by hourly slot.
- **Concert deals**: fashion and accessories at 50% off + FreeShip 0 ₫. These combine with Voucher MAX and TMALL vouchers.
- **Points**: every completed order earns points, which are exchanged for vouchers later. A "×5 points" wheel runs during big sales.
- **Coins (Xu / LazCoins)**: earned by check-ins and games, and spent as a discount at checkout.

### Payment (bank and e-wallet) offers

No 10.10-specific bank voucher was found. Lazada's payment pages show image banners only:

- **VIB LazCard Visa**: collect the voucher in the app, pay with the VIB card, use it the same day it is collected. One voucher per day while the budget lasts. Excludes SIM cards, top-ups, infant milk (0–3 years), feeding bottles, newborn accessories and Vinamilk products. The banner's dates are 01.08.2024 – 31.03.2025, so check the current terms.
- **Lazada Citi Platinum**: card perks, including a 200K birthday voucher and reward points; not an order discount.
- Standing offers on [Picodi](https://www.picodi.com/vn/lazada), 25.09.2026, before the sale:
  - Mastercard: 10% off, max saving 800K.
  - ACB Visa, Tuesdays: 300K off from 1M, or 20% off orders of 500–999K; returns not allowed.
  - VietinBank and VPBank: 10% off, max saving 300K.

### Typed codes found (unverified)

Codes are typed in **Mã giảm giá** at checkout. All come from coupon sites; none appeared in Lazada's own page data.

| Code          | Discount | Min. order | Condition / note                                 | Source, date                                                      |
| ------------- | -------: | ---------: | ------------------------------------------------ | ----------------------------------------------------------------- |
| `LAZDOCQUYEN` |   50,000 |    250,000 | "Exclusive" voucher                              | [anhvoucher](https://anhvoucher.com/ma-giam-gia/lazada/), undated |
| `LZDDQ25K`    |   25,000 |     99,000 | "Exclusive" voucher                              | anhvoucher, undated                                               |
| `TECH100`     |  100,000 |  1,000,000 | Technology items                                 | anhvoucher, undated                                               |
| `FREESHIPMAX` |        — |          — | Daily FreeShip MAX for items under 49K; no terms | anhvoucher, undated                                               |
| `Vui7`        |       7% |          — | Up to 1,000,000                                  | [Picodi](https://www.picodi.com/vn/lazada), 25.09.2026            |
| `Vui12`       |      12% |          — | New customers; up to 150,000                     | Picodi, 25.09.2026                                                |

Codes like `LAZ13…` are refund e-credit, not discounts. Most 10.10 vouchers have **no code**: coupon sites' "Lấy mã" / "Lưu tại trang" buttons open Lazada's own collect page.

### Store and brand vouchers on Lazada's pages (collected 11.10 00:47–00:58, logged out)

[The full collected list](acceptance/promotions-10-10/README.md) has **79 distinct vouchers** from Lazada's own page data, each with discount, max saving, min. order, validity, uses per customer and budget, plus 42 voucher cards from 20 pages. They are store, brand and co-funded vouchers; none has a typed code. Store-wide ones apply to the whole shop; "Lazada specific product" applies only to listed items. Highlights:

| Voucher                     | Scope            | Discount      |   Min. order | Valid until   |
| --------------------------- | ---------------- | ------------- | -----------: | ------------- |
| 1tr đơn từ 5tr              | Store-wide       | 1,000,000     |    5,000,000 | 31.10         |
| OCT2026                     | Store-wide       | 200,000       |      499,000 | 01.11         |
| Followers tháng 10          | Store-wide       | 100,000       |      500,000 | 31.10         |
| 100k đơn từ 1tr             | Store-wide       | 100,000       |    1,000,000 | 31.10         |
| voucher20%                  | Store-wide       | 20%, max 100K |      299,000 | 11.10 only    |
| D10 7%                      | Store-wide       | 7%, max 500K  |    1,200,000 | 12.10         |
| CFV 2 thùng                 | Special promo    | 25%, max 1M   |      120,000 | 12.10         |
| CFV 20% đơn từ 150k         | Special promo    | 20%, max 1M   |      150,000 | 12.10         |
| Co-Funded Voucher 10/10     | Special promo    | 18%, max 90K  |      269,000 | 12.10         |
| 20% Mov 329k Cap 90k        | Special promo    | 20%, max 90K  |      329,000 | 12.10         |
| CFV storewide 10%           | Special promo    | 10%, max 500K |    3,000,000 | 31.10         |
| Molfix 40%                  | Specific product | 40%, max 500K |      399,000 | 31.10         |
| Anessa 26%                  | Specific product | 26%, max 250K |      450,000 | 31.10         |
| Philips 18%                 | Specific product | 18%, max 600K |    2,000,000 | 31.10         |
| Samsung phones              | Specific product | 700K – 16M    | 4.7M – 43.4M | 12.10 – 31.10 |
| Apple iWatch SE 3 / MacBook | Specific product | 2M / 1.5M     |  7.85M / 22M | 12.10 / 31.10 |

Uses per customer range from 1 to 15 (most 1–5). The Lazada-wide Voucher MAX and FreeShip MAX tiers were not in the logged-out page data: the voucher hub redirects to the homepage unless signed in, and product pages show shop vouchers only when signed in.

## Kinds of discount

| Kind                                             | How you get it                                                                                | Typed code? |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------- |
| Platform voucher (Voucher MAX, "toàn sàn")       | Press **Thu thập** / **Lưu** on the voucher hub, campaign page or a banner                    | No          |
| FreeShip MAX                                     | Collected the same way; applies only to tagged items                                          | No          |
| Category / TMALL / LazMall voucher               | Category pages, TMALL and LazMall channels, brand slots and livestreams                       | No          |
| Shop voucher ("Voucher của Shop", "Mã của Shop") | **Lưu** / **Thu thập** on the product page or the seller's store page                         | No          |
| Payment voucher                                  | Collect on "Ưu đãi thanh toán", then pay with that bank card or e-wallet                      | Sometimes   |
| Typed code                                       | Enter in **Mã giảm giá** at checkout (new-user, partner or livestream codes)                  | Yes         |
| Coins (Xu) and points                            | Earned by check-ins, games and orders; spent at checkout or exchanged for vouchers in the app | No          |

## How to use vouchers, step by step

### In the Lazada app

1. Sign in (**Tài khoản** tab).
2. On **Trang chủ** (Home), tap the **Voucher** icon in the round shortcut row under the banner, or tap the 10.10 banner.
3. Tap **Thu thập** next to each voucher. It changes to **Đã thu thập** or **Dùng ngay** once saved.
4. For shop vouchers, open the product and tap the **Voucher** / **Mã giảm giá của Shop** row under the price, or the vouchers at the top of the shop page, then tap **Thu thập**.
5. Check saved vouchers in **Tài khoản → Mã giảm giá của tôi** (My Vouchers).
6. At checkout, tap **Voucher Lazada** / **Mã giảm giá của Shop** to see or switch the applied voucher. Type a code there if you have one, then tap **Áp dụng**.

Menu names can differ slightly between app versions. If the icon is missing, search "voucher" in the app.

### Checklist

1. **Sign in on the app or website** with the account that will pay. Vouchers belong to that account.
2. **Collect before the slot opens.** Open the voucher hub (`Vouchers` in the top bar) or the 10.10 page and press **Thu thập** on each voucher tier. During the sale, new batches drop at 00:00, 12:00 and 20:00, and popular tiers run out within minutes. Some vouchers exist only in the app ("chỉ trên App").
3. **Collect shop vouchers** on each product page you plan to buy (the "Voucher của Shop" row under the price), or on the store page.
4. **Check the tags.** FreeShip MAX needs the "Freeship Max" label on the item. LazMall and TMALL vouchers need the matching badge. Electronics use their own tier.
5. **Fill the cart to the right threshold.** Minimum spend is checked on the item subtotal before vouchers and shipping. Use the tables above to land just above a threshold, or near a cap's best size.
6. **At checkout**, open **Voucher Lazada** / **Mã giảm giá**. Lazada usually preselects the best collected voucher. Confirm which one it chose, apply the shop voucher, then pick the payment method if a bank or e-wallet offer applies. Type a code only if you have one, then press **Áp dụng**.
7. **Read the final breakdown** ("Giảm giá voucher", "Giảm giá phí vận chuyển") before paying. If a voucher shows as not applicable, the reason is usually below the minimum, excluded category, wrong payment method, used up, or expired.

### Stacking

One discount from each group can usually combine: **platform voucher + FreeShip voucher + shop voucher + payment voucher + LazCoins**. Two platform vouchers never combine, and code-type vouchers can exclude others. Lazada does not publish a complete Vietnam stacking matrix, so trust the checkout breakdown.

### Pitfalls

- Quantity-limited tiers disappear at peak slots, and a collected voucher can still say "Đã hết lượt" (used up) if the pool empties before checkout.
- Most vouchers are one use per account and expire at the end of their slot or of the sale (12.10 23:59).
- Returning items can void a voucher. Some bank offers state that returns are not allowed.
- Pages for past campaigns return "Page Not Found" or redirect to the homepage. The collector records that as `not-found` or `redirected-home` rather than "no vouchers".
- Coupon sites often recycle earlier years. Riokupon's 10.10 article is from 2023, and older bank tables on aggregators are from 2024. Always check the page date in the report.

## Applying vouchers to this project's comparisons

Comparison prices never subtract a voucher automatically. Captured voucher text stays a condition (`eligibilityConfirmed: false`; see [captured discounts](tables/discounts.md)). Once checkout shows a confirmed discount for your exact basket, pass it as a fixed order discount:

```sh
node bin/lazada-search.js compare --account default --category whey --quantity 10 --discount 140000
```

`--discount` is subtracted once per order, in VND, after the sale price. Use the confirmed amount from checkout, not a percentage from this guide.

## Collecting vouchers and promotions automatically

`scripts/collect-promotions.mjs` uses [Browser Commander](https://github.com/link-foundation/browser-commander) through the project's collector. It reuses the persistent signed-in window, enforces 60-second request spacing, resolves the product-information dialog and saves viewport screenshots. For each page it:

1. Opens the homepage, the campaign page (`--campaign`, default `sale-10-10-2026`), the voucher hub, payment offers, LazFlash, LazMall and the app-offers page, plus any URLs you pass (product or store pages, for shop vouchers).
2. Follows campaign sub-page and promo links it finds, up to `--max-promo-pages` (default 25).
3. Scrolls the page to load lazy modules. It then saves the HTML, before and after screenshots, every voucher-like text block, and the raw JSON of every `mtop.*` API response that mentions vouchers or promotions.
4. Parses each voucher's discount, cap, minimum spend, expiry, scope (freeship, LazMall, payment, new-user, shop, app-only) and whether a collect button was shown. Duplicates across pages are merged.
5. Fetches public coupon sites for typed codes, keeping each code's surrounding text, source and page date. All codes are marked `verified: false`.

It never presses collect, claim or buy buttons.

```sh
# Sign in once (the window stays available for later runs)
node bin/lazada-search.js login --account default

# Signed in: 10.10 pages, voucher hubs, a product's shop vouchers, and coupon-site codes
node scripts/collect-promotions.mjs --account default --headless=false \
  'https://www.lazada.vn/products/pdp-i2128384088-s14998796442.html'

# Logged out, in a fresh window that closes when the run ends
node scripts/collect-promotions.mjs --headless=false --no-persistent-browser

# Publish a redacted summary into the repository
node scripts/collect-promotions.mjs --account default --headless=false \
  --out docs/acceptance/promotions-10-10

# Coupon-site codes only (no browser), or a different campaign
node scripts/collect-promotions.mjs --skip-lazada
node scripts/collect-promotions.mjs --campaign sale-11-11-2026 --require-login
```

| Option                                                  | Meaning                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--campaign NAME`                                       | `megascenario` page name, e.g. `sale-10-10-2026`, `sale-11-11-2026`                                             |
| `--out DIR`                                             | Where `promotions.json` and `README.md` go. Default: `promotions/` inside the (account) store, which is private |
| `--max-promo-pages N`                                   | Maximum Lazada pages per run (default 25)                                                                       |
| `--code-source URL`                                     | Extra coupon site to scan; repeatable                                                                           |
| `--skip-lazada`                                         | Skip the browser and scan coupon sites only                                                                     |
| `--skip-codes`                                          | Skip coupon sites                                                                                               |
| `--require-login`                                       | Stop unless the browser session is signed in                                                                    |
| `--interval-ms`, `--cdp-url`, `--headless`, `--account` | Shared collector options (see the README)                                                                       |

Raw evidence (HTML, screenshots, API JSON) stays in the private account store as `promotion-page` and `promotion-code-source` records. The `--out` summary contains only voucher terms, page statuses and API names, with no cookies, screenshots or account details. Signed-in pages can show personal vouchers, so review the summary before committing it.

Without `--account`, the run is logged out. It shows public platform, campaign and shop vouchers, but not vouchers already collected or targeted to an account. Lazada's router closes the tab for unknown campaign routes, so the collector ignores `window.close()` and keeps going. Use Node.js 22.13 or newer.

Chrome 155 rejects Playwright 1.64's `connectOverCDP` ("Browser.setDownloadBehavior: Browser context management is not supported"). Every collector that reattaches to an already-open persistent window hits this, not only this script. A fresh launch still works. Until Playwright supports Chrome 155, either run logged out with `--no-persistent-browser`, or close the account's collector window and run with `--account default --no-persistent-browser`.

The parsing functions live in `src/promotions.js` and are tested in `tests/promotions.test.js` and `tests/promotion-collector.test.js`. They can re-parse saved HTML and API bodies offline after a pattern fix.
