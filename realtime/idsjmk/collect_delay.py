#!/usr/bin/env python3
"""Refresh the public IDS JMK delay snapshot for TEST.

Requires the isolated Python dependencies listed in requirements.txt. It
reads the official KORDIS GTFS feeds and Brno's published vehicle stream.
No vehicle locations are written to disk.
"""
import json
import os
from pathlib import Path
import secrets
import time
import urllib.request

from inspect_live import get_feed, get_stream
from idsjmk_delay import encode_snapshot, snapshot

ROOT = Path('/srv/eduvize-test-national-data')
REGIONAL = ROOT / 'idsjmk'
STATIC = REGIONAL / 'gtfs.zip'
OUTPUT = REGIONAL / 'delays.json'
STATIC_URL = 'https://kordis-jmk.cz/gtfs/gtfs.zip'


def atomic(path, data):
    tmp = path.with_name('.' + path.name + '.' + secrets.token_hex(6))
    with tmp.open('xb') as stream:
        os.fchmod(stream.fileno(), 0o644)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def refresh_static():
    REGIONAL.mkdir(mode=0o755, exist_ok=True)
    if STATIC.is_file() and time.time()-STATIC.stat().st_mtime < 20*3600:
        return
    request = urllib.request.Request(STATIC_URL, headers={'User-Agent': 'Eduvize-TEST/1.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read(20_000_001)
    if len(data) > 20_000_000 or len(data) < 100_000:
        raise ValueError('Unexpected static GTFS size')
    import io
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if not {'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'} <= set(archive.namelist()):
            raise ValueError('Incomplete static GTFS')
        if archive.testzip():
            raise ValueError('Corrupt static GTFS')
    atomic(STATIC, data)


def main():
    refresh_static()
    manifest = json.loads((ROOT / 'national/manifest.json').read_text())
    catalog = json.loads((ROOT / 'national/stops.json').read_text())
    generation = manifest['generation_id']
    feed = get_feed()
    vehicles = get_stream(seconds=12, maximum=1500)
    value = snapshot(feed, [{'attributes': v} for v in vehicles.values()], STATIC, catalog)
    if not value['observed_at'] or not value['delays']:
        raise RuntimeError('No fresh, matched delay observations')
    payload = encode_snapshot(value, generation)
    atomic(OUTPUT, (json.dumps(payload, ensure_ascii=False, separators=(',', ':'))+'\n').encode())
    print(json.dumps({'generation': generation, 'stream_vehicles': len(vehicles),
                      'matched_stop_times': len(value['delays']), 'observed_at': value['observed_at']}))


if __name__ == '__main__':
    main()
