# IDS JMK live delays on Eduvize TEST

This directory records the deployed TEST collector. The backend adapter and
matching module live in `eduvize_transport/`. The collector uses a copy of the
same matching module beside its script in the TEST audit directory. Before
building a new release, compare the two copies byte-for-byte.

Official inputs:

- KORDIS static GTFS: `https://kordis-jmk.cz/gtfs/gtfs.zip`
- KORDIS GTFS Realtime vehicle positions: `https://kordis-jmk.cz/gtfs/gtfsReal.dat`
- Brno vehicle stream: `wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe`
- CIS JŘ national schedule, already managed separately in TEST.

The collector joins the Brno stream vehicle ID to the GTFS Realtime vehicle
label, then maps the GTFS trip to the national schedule. It accepts only fresh
observations (at most 90 seconds), nearby uniquely named stops, and unique
stop/line/scheduled-time matches. No vehicle identifiers or coordinates are
written to the output. If data is missing, stale, ambiguous, or from an older
national schedule generation, the adapter leaves departures planned. Trips
past midnight are excluded until a reliable service date is available.

The deployed TEST audit directory is
`/srv/eduvize-test/idsjmk-delay-20261121-r1/`. Its isolated venv uses
`requirements.txt`; `collect_delay.py` writes a temporary file then atomically
replaces `/srv/eduvize-test-national-data/idsjmk/delays.json`. The read-only
backend mount sees it through the **relative** symlink
`/srv/eduvize-test-national-data/idsjmk-delays.json -> idsjmk/delays.json`.
Install the checked-in service and timer files only after reviewing paths,
permissions, and the active release; do not copy data or credentials from
production.

TEST release `0eddc40b733ecf93bf2f`, backend generation 8, was verified on
21 November 2026. A running-container smoke check returned fresh realtime
values with nonzero delays. This release has no browser acceptance or
production approval. The previous release `0b0ffed0430d4ba2d082` remains
available for rollback.
