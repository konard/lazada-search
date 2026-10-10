---
'lazada-search': patch
---

Add `scripts/collect-promotions.mjs`, a Browser Commander collector for Lazada campaign pages, voucher hubs, payment offers, shop vouchers and voucher API responses, plus typed codes from public coupon sites. Vouchers are parsed into discount, cap, minimum spend, expiry and scope, deduplicated across pages and reported as unverified conditions. Expired campaigns and homepage redirects are reported as such. Add a guide to using vouchers, codes and the 10.10 sale.
