"""Compact national GTFS export. IDs are release-local; public selection uses stop names."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import sqlite3
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = 'tangero/jizdni-rady-czech-republic'
WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def rows(archive, name):
    stream = archive.open('data/merged/' + name + '.txt' + ('.gz' if name == 'stop_times' else ''))
    if name == 'stop_times':
        stream = gzip.GzipFile(fileobj=stream)
    return csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig'))


def export(filename, output, version):
    output = Path(output)
    (output / 'shards').mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(filename) as archive, tempfile.TemporaryDirectory() as temp:
        stops = {r['stop_id']: r for r in rows(archive, 'stops')}
        routes = {r['route_id']: r for r in rows(archive, 'routes')}
        trips = {r['trip_id']: r for r in rows(archive, 'trips')}
        services = {r['service_id']: {'start': r['start_date'], 'end': r['end_date'], 'days': [int(r[d]) for d in WEEK], 'exceptions': {}} for r in rows(archive, 'calendar')}
        for r in rows(archive, 'calendar_dates'):
            services.setdefault(r['service_id'], {'start': '00000000', 'end': '00000000', 'days': [0]*7, 'exceptions': {}})['exceptions'][r['date']] = int(r['exception_type'])
        db = sqlite3.connect(str(Path(temp) / 'times.db'))
        db.execute('CREATE TABLE times (bucket TEXT, name TEXT, seconds INTEGER, trip TEXT, stop TEXT, sequence INTEGER)')
        terminal = {}
        batch = []
        count = 0
        for r in rows(archive, 'stop_times'):
            trip, stop = r['trip_id'], r['stop_id']
            if trip not in trips or stop not in stops:
                raise ValueError('GTFS contains an unresolved trip/stop reference')
            sequence = int(r['stop_sequence'])
            if sequence > terminal.get(trip, (-1, ''))[0]:
                terminal[trip] = (sequence, stops[stop]['stop_name'])
            value = r.get('departure_time') or r.get('arrival_time')
            if not value or r.get('pickup_type') == '1':
                continue
            h, m, s = map(int, value.split(':'))
            if h < 0 or not 0 <= m < 60 or not 0 <= s < 60:
                raise ValueError('Invalid GTFS time')
            name = stops[stop]['stop_name']
            batch.append((hashlib.sha256(name.encode()).hexdigest()[:2], name, h*3600+m*60+s, trip, stop, sequence))
            count += 1
            if len(batch) == 10000:
                db.executemany('INSERT INTO times VALUES (?,?,?,?,?,?)', batch)
                batch.clear()
        db.executemany('INSERT INTO times VALUES (?,?,?,?,?,?)', batch)
        db.execute('CREATE INDEX bucket_idx ON times(bucket)')
        coordinates = {}
        for stop in stops.values():
            try:
                lat, lon = float(stop['stop_lat']), float(stop['stop_lon'])
                if lat and lon:
                    coordinates.setdefault(stop['stop_name'], []).append([lat, lon])
            except ValueError:
                pass
        base = {'schemaVersion': 1, 'source': 'cz_gtfs', 'feed_version': version, 'generated_at': version.removeprefix('data-') + 'T00:00:00Z'}
        for bucket in range(256):
            key = f'{bucket:02x}'
            schedule = {s['stop_name']: [] for s in stops.values() if hashlib.sha256(s['stop_name'].encode()).hexdigest()[:2] == key}
            compact_trips, indices, used_services = [], {}, {}
            for name, seconds, trip_id, stop_id, sequence in db.execute('SELECT name,seconds,trip,stop,sequence FROM times WHERE bucket=? ORDER BY seconds', (key,)):
                if sequence == terminal[trip_id][0]:
                    continue  # Final arrival is not a boardable departure.
                if trip_id not in indices:
                    trip = trips[trip_id]
                    route = routes[trip['route_id']]
                    service = trip['service_id']
                    if service not in services:
                        raise ValueError('Unresolved service reference')
                    indices[trip_id] = len(compact_trips)
                    compact_trips.append([trip_id, service, route.get('route_short_name') or route['route_id'], int(route['route_type']), trip.get('trip_headsign') or terminal[trip_id][1]])
                    used_services[service] = services[service]
                schedule.setdefault(name, []).append([seconds, indices[trip_id], stop_id])
            payload = {**base, 'stops': schedule, 'trips': compact_trips, 'services': used_services}
            (output / 'shards' / (key + '.json.gz')).write_bytes(gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
        (output / 'stops.json').write_text(json.dumps({'stops': sorted({s['stop_name'] for s in stops.values()}), 'coordinates': coordinates}, ensure_ascii=False), encoding='utf-8')
        (output / 'manifest.json').write_text(json.dumps({**base, 'stop_count': len(stops), 'stop_times': count, 'attribution': 'Patrick Zandl · CC BY 4.0', 'url': 'https://github.com/' + REPOSITORY}, ensure_ascii=False), encoding='utf-8')
        print(f'Exported {len(stops)} stops, {count} stop times ({version})')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip')
    parser.add_argument('--version')
    parser.add_argument('--output', default='data/national')
    args = parser.parse_args()
    if args.zip:
        if not args.version:
            parser.error('--version is required with --zip')
        export(args.zip, args.output, args.version)
    else:
        request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/releases/latest', headers={'User-Agent': 'Eduvize-national-GTFS'})
        with urllib.request.urlopen(request, timeout=60) as response:
            release = json.load(response)
        asset = next(a for a in release['assets'] if a['name'].startswith('gtfs-cz-') and a['name'].endswith('.zip'))
        with tempfile.TemporaryDirectory() as temp:
            filename = str(Path(temp) / 'gtfs.zip')
            urllib.request.urlretrieve(asset['browser_download_url'], filename)
            export(filename, args.output, release['tag_name'])


if __name__ == '__main__':
    main()
