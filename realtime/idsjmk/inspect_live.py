"""Inspect the public IDS JMK GTFS-RT feed and Brno vehicle stream.

Run with PYTHONPATH=deps python3 inspect_live.py. This is read-only and
intentionally reports counts rather than retaining vehicle positions.
"""
import collections
import json
import time
import urllib.request

import websocket
from google.transit import gtfs_realtime_pb2

FEED = 'https://kordis-jmk.cz/gtfs/gtfsReal.dat'
STREAM = 'wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe'


def get_feed():
    request = urllib.request.Request(FEED, headers={'User-Agent': 'Eduvize-research/1.0'})
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(5_000_001)
    if len(raw) > 5_000_000:
        raise ValueError('Feed too large')
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(raw)
    return message


def get_stream(seconds=16, maximum=1000):
    connection = websocket.create_connection(STREAM, timeout=8)
    connection.settimeout(3)
    rows = {}
    try:
        end = time.monotonic() + seconds
        while time.monotonic() < end and len(rows) < maximum:
            try:
                message = json.loads(connection.recv())
            except websocket.WebSocketTimeoutException:
                continue
            attrs = message.get('attributes', {})
            if isinstance(attrs.get('ID'), int):
                rows[str(attrs['ID'])] = attrs
    finally:
        connection.close()
    return rows


def main():
    feed = get_feed()
    vehicles = {e.vehicle.vehicle.label: e.vehicle for e in feed.entity
                if e.HasField('vehicle') and e.vehicle.vehicle.label}
    stream = get_stream()
    joined = [(attrs, vehicles[key]) for key, attrs in stream.items() if key in vehicles]
    delays = [float(attrs['Delay']) for attrs, _ in joined if isinstance(attrs.get('Delay'), (int, float))]
    trip_ids = [vehicle.trip.trip_id for _, vehicle in joined if vehicle.trip.trip_id]
    print(json.dumps({
        'feed_timestamp': feed.header.timestamp,
        'feed_vehicle_count': len(vehicles),
        'feed_trip_update_count': sum(e.HasField('trip_update') for e in feed.entity),
        'stream_vehicle_count': len(stream),
        'joined_vehicle_count': len(joined),
        'joined_trip_count': len(trip_ids),
        'joined_nonzero_delay_count': sum(delay != 0 for delay in delays),
        'joined_delay_minutes_histogram': dict(collections.Counter(delays).most_common(12)),
        'example_nonzero': [dict(line=attrs.get('LineName'), trip=vehicle.trip.trip_id,
                                 delay_minutes=attrs.get('Delay'), age_seconds=round(time.time()-attrs.get('TimeUpdated', 0)/1000))
                            for attrs, vehicle in joined if attrs.get('Delay') not in (None, 0)][:8],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
