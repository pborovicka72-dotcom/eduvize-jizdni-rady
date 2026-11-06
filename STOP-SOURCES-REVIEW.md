# Jízdní řády – změna k revizi

PR propojuje ověřené PID zastávky s celostátní zálohou a přidává integraci společného output API v1. Přesná shoda názvu a oboustranná poloha nástupišť do 150 m umožní crossover; nejednoznačné zastávky se nehádají. Prázdná tabule není výpadek a plánovaná data nemají živé zpoždění. Původní stáří zdrojů se zachovává.

Transport dodává vlastní validátor/publish/live hook do společného registru, samostatný publikovaný renderer nad output-runtime/output-client a test-domain ovládání vytvoření/konceptu/publikace/odvolání. Copy/open čtou existující odkaz a nepublikují. Veřejný kontext nepochází z localStorage, query zastávek nebo relace správce. Registry API ani generátor se zde neduplikují.

## Ověřeno lokálně

- 14 původních regresních kontrol (JS reader/routing/settings, normalizace PID a exporty).
- 10 HTTP testů skutečného společného registry+transport adaptéru nad izolovanou SQLite: publikace, draft, stálý odkaz, cizí škola, revoke, scoped live data, prázdná tabule, odmítnutý zdroj, nejednoznačná poloha, národní fallback a původní observedAt.
- 45 browser případů skutečného publikovaného rendereru a shared runtime: web, všechny centrální NSP segmenty, kioskové orientace/menu/tiles/display/interactive, publikovaná revize i styl pod stejným ID, cizí localStorage ignorována, revoke vyčistí obsah a zastaví data polling.
- Browser test administračních akcí se skutečným sdíleným klientem a řízeným HTTP backendem: explicitní create/publish, copy před publikací odmítnuto, copy po publikaci bez mutace/duplicity.
- 4 původní browser scénáře klientského výběru zdrojů zůstávají samostatným testem.

Ve všech browser případech se povoluje pouze konkrétní test origin; neprokazují síťovou nezávislost nasazeného serveru. Použita výhradně syntetická data a fixture identity. Podrobnosti nasazení, payload, zdroje, hranice důkazů a přesné lokální příkazy: OUTPUT-INTEGRATION.md.

## Zbývající přijímací brány

Koordinátor dodal neměnné GitHub implementační SHA v output-dependencies.json. Lokální registry i browser testy jsou opakovány proti čistým přesným checkoutům; integrační CI je nyní povinné v PR. Zbývá izolovaný test build s balíčkem transport adaptéru/dat a reálným testovacím Golemio přístupem, dvě školy/profily, testovací auth/licence, persistence/restart a úplná klientská I SERVEROVÁ blokace Renderu při studeném startu bez cache. Samotný same-origin endpoint ani HTTP 200 toto nepotvrzují. PR zůstává draft do těchto kontrol. Produkce nebyla nasazena a její vydání není schválené.
