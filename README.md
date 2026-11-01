# Eduvize – jízdní řády PID

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
