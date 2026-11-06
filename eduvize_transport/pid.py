"""Small PID live departure service; the Golemio token never leaves the server."""
import json
import math
import os
import re
import time
from pathlib import Path
from datetime import datetime, timezone
from threading import Lock
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title='Eduvize PID realtime')
app.add_middleware(CORSMiddleware, allow_origins=['https://pborovicka72-dotcom.github.io'], allow_methods=['GET'], allow_headers=[])
_cache = {}
_lock = Lock()

def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None

def normalize(payload, name):
    result = []
    stops = {s.get('stop_id'): s.get('stop_name', name) for s in payload.get('stops', [])}
    for item in payload.get('departures', []):
        times = item.get('departure_timestamp') or {}
        scheduled = timestamp(times.get('scheduled'))
        if scheduled is None:
            continue
        trip, route, stop = (item.get(k) or {} for k in ('trip', 'route', 'stop'))
        delay = item.get('delay') or {}
        available = delay.get('is_available') is True
        predicted = timestamp(times.get('predicted')) if available else None
        seconds = delay.get('seconds')
        if not isinstance(seconds, (float, int)) or isinstance(seconds, bool) or not math.isfinite(seconds):
            seconds = (predicted - scheduled).total_seconds() if predicted else None
        if not available:
            seconds = None
        result.append(dict(scheduled_at=scheduled.isoformat(), predicted_at=predicted.isoformat() if predicted else None,
            delay_seconds=seconds, realtime_available=available, is_canceled=trip.get('is_canceled') is True,
            stop_id=stop.get('id'), stop_name=stops.get(stop.get('id'), name), trip_id=trip.get('id'),
            line=str(route.get('short_name') or ''), route_type=route.get('type', 3), destination=trip.get('headsign') or '—'))
    return result

def _fetch_direct_board(name, minutes):
    key = (name, minutes)
    with _lock:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 20:
            return cached[1], cached[2]
    token = os.environ.get('GOLEMIO_API_KEY') or os.environ.get('GOLEMIO_TOKEN')
    if not token:
        raise HTTPException(503, 'Živá data PID nejsou nakonfigurována.')
    query = urlencode(dict(names=name, limit=200, total=200, minutesBefore=30, minutesAfter=minutes, preferredTimezone='Europe/Prague', includeMetroTrains='true'))
    request = Request('https://api.golemio.cz/v2/pid/departureboards?' + query,
        headers={'x-access-token': token, 'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=3) as response:
            payload = json.loads(response.read(4_000_001))
        if not isinstance(payload.get('departures'), list):
            raise ValueError('Invalid departure board')
        result = normalize(payload, name)
    except HTTPError as error:
        if error.code in (401,403):
            raise HTTPException(403, "Přístup ke zdroji PID byl odmítnut.") from None
        raise HTTPException(502, "Zdroj PID není dostupný.") from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Živá data PID jsou dočasně nedostupná.') from None
    observed = datetime.now(timezone.utc).isoformat()
    with _lock:
        if len(_cache) >= 512:
            _cache.clear()
        _cache[key] = (time.monotonic(), result, observed)
    return result, observed

def fetch_stop(name, minutes):
    return _fetch_direct_board(name, minutes)[0]

@app.get('/health')
def health():
    return {'status': 'ok', 'realtime_configured': bool(os.environ.get('GOLEMIO_API_KEY') or os.environ.get('GOLEMIO_TOKEN'))}

@app.get('/api/v1/national/shards/{shard}')
def national_shard(shard: str):
    # A public, release-owned timetable shard; arbitrary paths are never accepted.
    if not re.fullmatch(r'[a-f0-9]{2}\.json\.gz', shard):
        raise HTTPException(404, 'Soubor jízdního řádu nebyl nalezen.')
    root = os.getenv('EDUVIZE_TRANSPORT_DATA_DIR')
    if not root:
        raise HTTPException(503, 'Dopravní data nejsou nakonfigurována.')
    path = Path(root) / 'national' / 'shards' / shard
    if not path.is_file():
        raise HTTPException(404, 'Soubor jízdního řádu nebyl nalezen.')
    return FileResponse(path, media_type='application/gzip', headers={'Cache-Control': 'public, max-age=900', 'X-Content-Type-Options': 'nosniff'})

@app.get('/api/v1/pid/departures')
def departures(stops: str = Query(min_length=2, max_length=2000), minutes: int = Query(60, ge=1, le=720)):
    names = list(dict.fromkeys(stops.split('|')))
    if len(names) > 20 or any(not name.strip() or len(name) > 100 for name in names):
        raise HTTPException(422, 'Vyberte nejvýše 20 zastávek.')
    boards = [fetch_board(name, minutes) for name in names]
    items = [item for rows, stamp in boards for item in rows]
    items.sort(key=lambda item: item['predicted_at'] or item['scheduled_at'])
    observed = min(stamp for rows, stamp in boards)
    return {'generated_at': observed, 'fetched_at': datetime.now(timezone.utc).isoformat(), 'source': 'golemio', 'known_stops': names, 'departures': items}

def fetch_board(name, minutes):
    endpoint = os.getenv('EDUVIZE_TRANSPORT_REALTIME_URL')
    if endpoint:
        # Only the release-controlled internal service; never a URL from a publication.
        value = urlsplit(endpoint)
        if (value.scheme, value.hostname, value.port, value.path) != ('http', 'transit', 8000, '/api/v1/pid/departures') or value.username or value.password or value.query or value.fragment:
            raise HTTPException(503, 'Interní zdroj PID není správně nakonfigurován.')
        try:
            request = Request(endpoint + '?' + urlencode({'stops': name, 'minutes': minutes}), headers={'Accept': 'application/json'})
            with urlopen(request, timeout=4) as response:
                data = json.loads(response.read(4_000_001))
            observed = timestamp(data.get('generated_at'))
            rows = data.get('departures')
            if data.get('source') != 'golemio' or data.get('known_stops') != [name] or observed is None or not isinstance(rows, list) or any(not isinstance(row, dict) or row.get('stop_name') != name for row in rows):
                raise ValueError('Invalid internal board')
            return rows, observed.isoformat()
        except HTTPError as error:
            raise HTTPException(403 if error.code in (401, 403) else 502, 'Interní zdroj PID není dostupný.') from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, 'Interní zdroj PID není dostupný.') from None
    return _fetch_direct_board(name, minutes)
