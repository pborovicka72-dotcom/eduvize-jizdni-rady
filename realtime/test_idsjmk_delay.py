import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from eduvize_transport.idsjmk_delay import annotate, encode_snapshot, read_snapshot


class DelaySafetyTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 21, 20, 45, tzinfo=timezone.utc)
        self.at = self.now + timedelta(minutes=5)
        self.row = {'stop_name': 'Brno, Pálavské náměstí', 'line': '27',
                    'trip_id': 'cis-1', 'scheduled_at': self.at.isoformat(),
                    'realtime_available': False, 'predicted_at': None,
                    'delay_seconds': None}
        self.key = (self.row['stop_name'], self.row['line'], int(self.at.timestamp()))
        self.value = {'observed_at': self.now.isoformat(), 'delays': {self.key: 240}}

    def test_unique_fresh_match_sets_prediction(self):
        result = annotate([self.row], self.value, self.now)[0]
        self.assertEqual(result['delay_seconds'], 240)
        self.assertEqual(datetime.fromisoformat(result['predicted_at']), self.at + timedelta(minutes=4))
        self.assertTrue(result['realtime_available'])
        self.assertIsNone(self.row['predicted_at'])

    def test_ambiguous_national_departures_stay_planned(self):
        other = dict(self.row, trip_id='cis-2')
        result = annotate([self.row, other], self.value, self.now)
        self.assertFalse(any(row['realtime_available'] for row in result))

    def test_stale_and_wrong_generation_stay_planned(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'delays.json'
            path.write_text(json.dumps(encode_snapshot(self.value, 'generation-1')))
            self.assertIsNone(read_snapshot(path, 'generation-2', self.now))
            self.assertIsNone(read_snapshot(path, 'generation-1', self.now + timedelta(seconds=91)))
            self.assertIsNotNone(read_snapshot(path, 'generation-1', self.now))
        self.assertFalse(annotate([self.row], self.value, self.now + timedelta(seconds=91))[0]['realtime_available'])


if __name__ == '__main__':
    unittest.main()
