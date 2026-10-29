# Portuguese retailer source coverage

Verified on **29 October 2026**. A registered supermarket is not a claim that its entire catalogue is collected. Public online prices can vary by selected store, delivery area, date, stock and loyalty conditions. Preserve the original URL, observation time, store, validity dates and source type with every price.

| Retailer | Verified public source | Coverage and current limits |
| --- | --- | --- |
| Continente | [Online shop](https://www.continente.pt/) and the site's `Search-UpdateGrid` product listings | Automated catalogue connector; public product pages supply prices and product metadata. A successful page does not prove complete catalogue coverage. |
| Auchan | [Online shop](https://www.auchan.pt/) and its public `Search-UpdateGrid` listings | Automated catalogue connector. Prices refer to the public online assortment and context served by the retailer. |
| Pingo Doce | [Online shop](https://www.pingodoce.pt/) and its public `Search-UpdateGrid` listings | Automated catalogue connector. Older site selectors and category paths needed replacement; store/delivery context remains relevant. |
| Lidl | [Public offers](https://www.lidl.pt/) and its frontend's `/q/api/search` results | Automated public-listing connector. This is an advertised subset, not every grocery item sold in every shop. |
| Aldi | [Official website](https://www.aldi.pt/) and its linked current leaflet assets | Automated leaflet connector. Advertised prices have campaign dates; do not infer full stock or full catalogue coverage. |
| Froiz | [Portuguese shop](https://loja.froiz.com/), [public products endpoint](https://serviciospt.froiz.com/api/products?page=1&size=2) | A public, unauthenticated GET returned product objects, prices and pagination statistics, with `productTotal=6706` at verification. The frontend-linked category endpoint is `/api/categories?channel.id=1&isEnabled=true&coverage[gte]=0`. A dedicated connector uses this source; the old HTML-only shell did not expose product cards. |
| Intermarché | [Official campaign catalogue](https://intermarche.pt/shop/2119), [another homepage-linked catalogue](https://intermarche.pt/shop/2871), [folhetos](https://intermarche.pt/sign/brands/catalog-page) | A normal browser displayed priced product cards without signing in. An optional Playwright DOM connector is included and disabled by default. Both direct HTTP and the local headless Chromium smoke test returned **403**; it stops on this restriction and is not claimed as a healthy unattended source. The former `lojaonline.intermarche.pt` root returned **404**. |
| El Corte Inglés | [Portuguese supermarket](https://www.elcorteingles.pt/supermercado/) | The tested public category request returned **403**. Registered for observations/imports; no working automatic source is claimed. |
| E.Leclerc | [Official leaflets](https://e-leclerc.pt/folhetos/), [app information](https://e-leclerc.pt/o-meu-e-leclerc/) | Official HTML returned **200**, with store filters and campaign dates. Leaflet detail pages embed public Publuu viewers. Prices are presented in brochures rather than a verified structured product feed. Registered for observations/imports; brochure extraction would need validation before automatic publication. |
| Mercadona | [Portuguese website](https://www.mercadona.pt/), [retailer-maintained app listing](https://play.google.com/store/apps/details?id=es.mercadona.tienda&hl=pt_PT) | No Portuguese price feed was verified. Developer responses on the app listing identify its online shopping service as Spain-only; Spanish prices must not be imported as Portuguese prices. Use dated Portuguese store observations or an agreed retailer feed. |
| Minipreço | [Official leaflet application](https://folhetos.minipreco.pt/) | Public discovery found a JavaScript leaflet application; a live content fetch failed with **502**. No current machine-readable price source was verified. Registered for observations/imports. |
| Amanhecer | [Official website](https://www.amanhecer.pt/), [leaflets](https://www.amanhecer.pt/folhetos) | Official homepage publishes a weekly leaflet link and product names. No complete structured price feed was verified. Store participation and leaflet validity need preserving. Registered for observations/imports. |
| SPAR | [Official leaflets](https://www.spar.pt/folhetos/resumo) | Public leaflets separate mainland and Azores offers and state that prices apply to participating shops. No complete structured price feed was verified. Registered for observations/imports. |

## Concrete public Intermarché discovery

The current homepage links to `/shop/2119`. A live browser displayed **1,678 products**; a search-engine rendering showed an older count, so cached search results must never become the ingestion source. Product-card DOM identifiers include the EAN, such as `productEan_5601043111019`.

Following the visible card opened [Farinha de Trigo Fina com Fermento, 1 kg](https://intermarche.pt/product/farinha-de-trigo-fina-com-fermento-emb.-1-kg/5601043111019). The public detail page exposed brand, category, image, price, price/kg, campaign end date, ingredients, allergens, storage information, supplier and nutrition. This verifies a useful public source beyond the mobile app. It does **not** establish stable unattended access or nationwide price applicability. The site's store picker explicitly warns that prices and availability vary by selected store. `/shop/2119` is a listing identifier, not evidence of physical store 2119. No authentication, CAPTCHA or access-control bypass was attempted.

### Optional browser collector

Install browser dependencies separately, following the [Playwright Python library setup](https://playwright.dev/python/docs/library):

```sh
python -m pip install -r scraper/requirements-browser.txt
python -m playwright install chromium
INTERMARCHE_LISTING_IDS=2119 python scraper/main.py --scraper Intermarche
```

Select current listing IDs from the official homepage before running; none are assumed by default. `INTERMARCHE_MAX_PAGES` defaults to 40 (maximum 400), and `INTERMARCHE_HEADLESS=0` uses a normal visible Chromium window where a desktop is available. Browser collectors require explicit selection; `--scraper Intermarche` runs only that collector. `INTERMARCHE_STORE_LOCATION` is an optional user-supplied observation label and does not select or verify a physical store.

The collector reads cards and their published pagination links, preserves barcodes, brands, prices, price/kg or litre, images, promotion end dates and loyalty labels, and marks coverage as a partial public campaign with unverified store scope. It never deletes products absent from the campaign. Missing cards, repeated pagination, page limits, HTTP restrictions and incomplete counts are reported as partial failures. It reads the public listing only; the richer detail-page fields above are a verified opportunity for later bounded enrichment, not a claim that all detail pages are fetched now.

## App-only and unstructured sources

An app's existence does not establish a public price API. Use a documented public feed or frontend-linked public data when available. Otherwise accept a verified import from dated store observations, receipts, retailer exports or reviewed leaflet extraction. Account-specific coupons and loyalty offers must remain marked and excluded from ordinary-price comparisons by default.

Keep `source_type`, `source_url`, `observed_at`, `store_location`, `valid_from`, `valid_to` and `requires_loyalty_card` populated when applicable. Missing information stays missing; do not substitute a zero price, today's date for an older observation, a Spanish price for a Portuguese one, or an advertised offer for confirmed stock. Uploaded receipt data should be reduced to product/price/store/time fields before sharing; personal and payment details are not price evidence.

The Froiz connector demonstrates the next useful expansion route: inspect the official public frontend, identify data URLs it already uses, verify a small read-only response and pagination, then add parser fixtures and coverage reporting. Leaflet-only chains need reviewed extraction rather than an invented full-catalogue scraper.
