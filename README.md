# Eduvize – jízdní řády

Plánované odjezdy z GTFS se doplňují živými daty Golemio.

## Aktivace živých dat
1. V Render vytvořte Blueprint z tohoto repozitáře (`render.yaml`), služba `eduvize-pid-realtime`. Je nezávislá na databázi.
2. Do serverové proměnné `GOLEMIO_API_KEY` vložte vlastní klíč z https://api.golemio.cz/api-keys. Klíč nepatří do veřejného repozitáře ani do odkazu.
3. Ověřte `/health`: `realtime_configured: true`.
4. V `realtime-config.json` nastavte `endpoint` na HTTPS adresu služby s cestou `/api/v1/pid/departures`.
5. Obnovte výstup. Patička oznámí „Živá data PID · Golemio“.

Bez nakonfigurovaného endpointu nebo při výpadku se používá statický jízdní řád. „Bez údaje“ neznamená nulové zpoždění. Plánovaný čas zůstává v prvním sloupci, odpočet a řazení používají očekávaný čas. Odřeknuté spoje jsou výslovně označeny.

Klient aktualizuje data každých 30 sekund, server sdílí odpovědi po dobu 20 sekund. Každá zastávka se načítá samostatně; při neúplném dotazu se použije plánovaný přehled pro všechny zvolené zastávky.

Testy: `cd realtime && python -m unittest test_realtime -v`.

## Celostátní plánované odjezdy
Administrace nabízí zdroje `pid` (výchozí, včetně Golemio) a `cz_gtfs` (celostátní plánované jízdní řády). Zdroj se ukládá do odkazu, místní konfigurace i profilu. Při změně zdroje se vybírají zastávky z jeho samostatného katalogu. Národní identifikátory se nikdy neposílají do Golemio.

Zdroj: [Jízdní řády České republiky — Patrick Zandl](https://github.com/tangero/jizdni-rady-czech-republic), licence **CC BY 4.0**. Atribuce je také v patičce výstupu. Pokrytí a správnost odpovídají upstream datasetu CIS JŘ; nejde o celostátní živé odjezdy ani záruku pokrytí všech druhů dopravy.

Workflow `update-national.yml` denně ověřuje nejnovější Release a exportuje jeho sloučenou variantu do `data/national/`. Komprimované soubory jsou dělené podle hashe názvu zastávky. Kalendáře a výjimky se vyhodnocují pro vybrané zastávky v časovém pásmu Europe/Prague; podporují se i odjezdy po 24:00. Starší release než 10 dní vyvolá upozornění. Platnost jednotlivých spojů určují kalendáře GTFS.

Výběr zastávek se ukládá jménem, protože interní ID upstreamu nejsou stabilní. Terminální příjezdy se nevydávají za odjezdy. Neplatné nulové souřadnice se nenabízejí při hledání v okolí. Čtení komprese vyžaduje moderní prohlížeč s DecompressionStream.

Lokální export:
```sh
python scripts/export_national_gtfs.py --zip gtfs-cz.zip --version data-2026-10-23 --output data/national
python -m unittest discover -s scripts -p 'test_export*.py' -v
```
