import gzip
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from export_national_gtfs import export


class NationalExportTest(unittest.TestCase):
    def test_compressed_feed_calendar_overnight_and_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with zipfile.ZipFile(root/'feed.zip', 'w') as z:
                files = {
                    'stops': 'stop_id,stop_name,stop_lat,stop_lon\nST_99,Test,50,14\nST_2,Terminal,0,0\n',
                    'routes': 'route_id,route_short_name,route_type\nR,123,3\n',
                    'trips': 'trip_id,route_id,service_id\nT,R,S\n',
                    'calendar': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,0,0,20260101,20261231\n',
                    'calendar_dates': 'service_id,date,exception_type\nS,20261101,1\nS,20261102,2\n',
                    'stop_times': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT,ST_99,1,25:10:00,25:10:00\nT,ST_2,2,25:20:00,25:20:00\n'}
                for name, text in files.items():
                    z.writestr('data/merged/'+name+'.txt'+('.gz' if name=='stop_times' else ''), gzip.compress(text.encode()) if name=='stop_times' else text)
            export(root/'feed.zip', root/'output', 'data-2026-10-23')
            feeds = [json.loads(gzip.decompress(p.read_bytes())) for p in (root/'output/shards').glob('*.gz')]
            feed = next(f for f in feeds if f['stops'].get('Test'))
            self.assertEqual(feed['stops']['Test'][0][0], 90600)
            self.assertEqual(feed['trips'][0][4], 'Terminal')
            self.assertEqual(feed['services']['S']['exceptions'], {'20261101': 1, '20261102': 2})
            catalog = json.loads((root/'output/stops.json').read_text())
            self.assertNotIn('Terminal', catalog['coordinates'])
            self.assertEqual(sum(len(f['trips']) for f in feeds), 1)


if __name__ == '__main__':
    unittest.main()
