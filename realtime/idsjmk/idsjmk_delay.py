"""Conservative IDS JMK delay overlay for the official CIS JŘ timetable.

The Brno public vehicle stream supplies Delay (minutes). The KORDIS GTFS-RT
vehicle label joins that stream to a GTFS trip; GTFS static supplies its stop
times. Only a unique stop/line/time match may annotate a CIS JŘ departure.
Missing or ambiguous realtime data always leaves the planned time untouched.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from io import TextIOWrapper
import csv
import json
import math
from pathlib import Path
import zipfile
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Europe/Prague')
MAX_AGE_SECONDS = 90
MAX_DELAY_MINUTES = 120
MAX_STOP_DISTANCE_METERS = 150


def distance_meters(lat1, lon1, lat2, lon2):
    a, b = math.radians(lat1), math.radians(lat2)
    da, db = b-a, math.radians(lon2-lon1)
    return 12742000*math.asin(min(1, math.sqrt(math.sin(da/2)**2 + math.cos(a)*math.cos(b)*math.sin(db/2)**2)))


def read_csv(archive, name):
    with archive.open(name) as source:
        yield from csv.DictReader(TextIOWrapper(source, encoding='utf-8-sig'))


def stop_crosswalk(gtfs_stops, national_catalog):
    """Map platform IDs only when the nearby national stop name is unique."""
    names = national_catalog['stops']
    coordinates = national_catalog['coordinates']
    suffixes = defaultdict(list)
    for name in names:
        suffixes[name.split(', ', 1)[-1]].append(name)
    result = {}
    for row in gtfs_stops:
        if row.get('location_type') not in ('', '0'):
            continue
        try:
            lat, lon = float(row['stop_lat']), float(row['stop_lon'])
        except (KeyError, ValueError):
            continue
        label = row['stop_name']
        candidates = set(suffixes.get(label, []))
        if label in names:
            candidates.add(label)
        near = [name for name in candidates if any(
            distance_meters(lat, lon, point[0], point[1]) <= MAX_STOP_DISTANCE_METERS
            for point in coordinates.get(name, []))]
        if len(near) == 1:
            result[row['stop_id']] = near[0]
    return result


def gtfs_index(archive):
    routes = {row['route_id']: row['route_short_name'] for row in read_csv(archive, 'routes.txt')}
    trips = {row['trip_id']: routes.get(row['route_id']) for row in read_csv(archive, 'trips.txt')}
    times = defaultdict(list)
    for row in read_csv(archive, 'stop_times.txt'):
        if row['trip_id'] in trips and row['departure_time']:
            times[row['trip_id']].append((row['stop_id'], row['departure_time']))
    return trips, times


def snapshot(feed, stream_rows, archive_path, national_catalog, now=None):
    now = now or datetime.now(timezone.utc)
    now_epoch = now.timestamp()
    if abs(now_epoch-feed.header.timestamp) > MAX_AGE_SECONDS:
        return {'observed_at': None, 'delays': {}, 'reason': 'stale_feed'}
    vehicles = defaultdict(list)
    for entity in feed.entity:
        if entity.HasField('vehicle') and entity.vehicle.vehicle.label and entity.vehicle.trip.trip_id:
            vehicle = entity.vehicle
            if abs(now_epoch-vehicle.timestamp) <= MAX_AGE_SECONDS:
                vehicles[vehicle.vehicle.label].append(vehicle)
    with zipfile.ZipFile(archive_path) as archive:
        stops = stop_crosswalk(read_csv(archive, 'stops.txt'), national_catalog)
        routes, times = gtfs_index(archive)
    local_day = now.astimezone(ZONE).date()
    found = defaultdict(list)
    for item in stream_rows:
        attrs = item.get('attributes', item)
        label = str(attrs.get('ID', ''))
        if len(vehicles[label]) != 1:
            continue
        vehicle = vehicles[label][0]
        trip_id = vehicle.trip.trip_id
        line = routes.get(trip_id)
        if not line or line != str(attrs.get('LineName', '')):
            continue
        delay = attrs.get('Delay')
        if isinstance(delay, bool) or not isinstance(delay, (int, float)) or not math.isfinite(delay) or abs(delay) > MAX_DELAY_MINUTES:
            continue
        updated = attrs.get('TimeUpdated')
        if not isinstance(updated, (int, float)) or abs(now_epoch-updated/1000) > MAX_AGE_SECONDS:
            continue
        # The live vehicle descriptor has no start_date. Keep only same-day
        # GTFS departures; overnight trips require an explicit service date.
        for stop_id, clock in times.get(trip_id, []):
            name = stops.get(stop_id)
            parts = clock.split(':')
            if not name or len(parts) != 3:
                continue
            try:
                hours, minutes, seconds = map(int, parts)
            except ValueError:
                continue
            if hours >= 24 or not (0 <= minutes < 60 and 0 <= seconds < 60):
                continue
            scheduled = datetime.combine(local_day, datetime.min.time(), ZONE) + timedelta(hours=hours, minutes=minutes, seconds=seconds)
            if not -MAX_DELAY_MINUTES*60 <= scheduled.timestamp()-now_epoch <= 3*3600:
                continue
            key = (name, line, int(scheduled.timestamp()))
            found[key].append((trip_id, int(round(delay*60))))
    # Different live trips at the same departure minute are not distinguishable
    # from the current national response, so omit their realtime values.
    delays = {key: values[0][1] for key, values in found.items() if len(set(values)) == 1}
    return {'observed_at': datetime.fromtimestamp(feed.header.timestamp, timezone.utc).isoformat(),
            'delays': delays, 'joined_stop_times': len(delays), 'reason': None}


def annotate(rows, live_snapshot, now=None):
    """Return fresh, unique matches as predicted times; preserve other rows."""
    now = now or datetime.now(timezone.utc)
    observed = live_snapshot.get('observed_at')
    if not observed or abs((now-datetime.fromisoformat(observed)).total_seconds()) > MAX_AGE_SECONDS:
        return rows
    counts = Counter((row['stop_name'], row['line'], int(datetime.fromisoformat(row['scheduled_at']).timestamp())) for row in rows)
    result = []
    for row in rows:
        key = (row['stop_name'], row['line'], int(datetime.fromisoformat(row['scheduled_at']).timestamp()))
        delay = live_snapshot['delays'].get(key)
        if counts[key] == 1 and delay is not None and not row.get('realtime_available'):
            copy = dict(row)
            copy['delay_seconds'] = delay
            copy['predicted_at'] = (datetime.fromisoformat(row['scheduled_at'])+timedelta(seconds=delay)).isoformat()
            copy['realtime_available'] = True
            result.append(copy)
        else:
            result.append(row)
    return result


def encode_snapshot(value, generation):
    """Compact schema for an atomic file shared with the output adapter."""
    return {'schemaVersion': 1, 'provider': 'idsjmk',
            'nationalGeneration': generation, 'observedAt': value['observed_at'],
            'delays': [[name, line, epoch, delay] for (name, line, epoch), delay
                       in sorted(value['delays'].items())]}


def read_snapshot(path, generation, now=None):
    now = now or datetime.now(timezone.utc)
    try:
        raw = json.loads(Path(path).read_text())
        if (raw.get('schemaVersion') != 1 or raw.get('provider') != 'idsjmk'
                or raw.get('nationalGeneration') != generation
                or len(raw.get('delays', [])) > 30000):
            return None
        observed = datetime.fromisoformat(raw['observedAt'])
        if observed.tzinfo is None or abs((now-observed).total_seconds()) > MAX_AGE_SECONDS:
            return None
        delays = {}
        for record in raw['delays']:
            if (not isinstance(record, list) or len(record) != 4
                    or not isinstance(record[0], str) or not isinstance(record[1], str)
                    or type(record[2]) is not int or type(record[3]) is not int
                    or abs(record[3]) > MAX_DELAY_MINUTES*60):
                return None
            key = tuple(record[:3])
            if key in delays:
                return None
            delays[key] = record[3]
        return {'observed_at': raw['observedAt'], 'delays': delays}
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return None
