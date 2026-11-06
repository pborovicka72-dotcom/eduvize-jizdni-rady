# Propojení zastávek – změna k revizi

Výběr národního katalogu používá PID jen při přesné shodě názvu a oboustranném ověření všech souřadnic nástupišť do 150 m. Ostatní zastávky zůstávají plánované. PID výpadek používá národní zálohu pouze při stejném ověření. Úspěšná prázdná tabule není výpadek. Neprovádí se fuzzy párování ani předávání národních GTFS ID do PID.

PID klient čte centrální konfiguraci s relativním same-origin endpointem `/doprava-api/api/v1/pid/departures`, který odpovídá existujícímu Caddy směrování. Cizí origin odmítne. Token patří výhradně na server. Záloha nemá příznak realtime, predikci ani údaj o zpoždění. Stáří dat se zachovává podle nejstaršího zdroje. Národní zdroj je uveden i při PID fallbacku.

Veřejná stránka již neaplikuje zastávky ani inline styl z lokální administrátorské relace. Tato změna nevytváří alternativní generátor/resolver. Finální integrace společného registru publikovaných výstupů zůstává závislostí koordinovaného proudu podle ../EDUVIZE-OUTPUT-CONTRACT.md; současný lokální generátor v administraci není novým stabilním kontraktem.

## Ověření

- 4 regresní scénáře routování: výpadek, rozdílná poloha, kombinace PID/národní, prázdná tabule.
- 3 scénáře národního readeru: časová zóna, kalendářní výjimky, odjezdy po půlnoci.
- 4 testy normalizace PID a 2 testy exportů.
- Kontrola syntaxe inline skriptů a git diff --check.

## Před schválením vydání

Toto je změna k revizi kódu, nikoliv potvrzení připravenosti produkce. Zbývá živý pilot a E2E matice kontraktu (dvě školy/profily, resolver, režimy a orientace, blokace Renderu na klientu i serveru po vyprázdnění cache a restartu). Same-origin URL sama neprokazuje nezávislost serveru na Renderu. Test používá vlastní Golemio klíč. Existující Render služby se touto změnou neruší. Přenos na test a produkci výhradně podle společného deployment procesu; produkci schvaluje vlastník.
