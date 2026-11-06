import io
import json
import unittest
import gzip
import tempfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from fastapi import HTTPException
from fastapi.testclient import TestClient
from eduvize_transport import pid

class InternalPID(unittest.TestCase):
    endpoint = 'http://transit:8000/api/v1/pid/departures'

    def test_scoped_internal_board_preserves_source_age_and_unknown_delay(self):
        stamp = '2026-11-02T12:00:00+00:00'
        data = {'source': 'golemio', 'known_stops': ['A'], 'generated_at': stamp,
                'departures': [{'stop_name': 'A', 'delay_seconds': None, 'realtime_available': False}]}
        with patch.dict('os.environ', EDUVIZE_TRANSPORT_REALTIME_URL=self.endpoint), patch.object(pid, 'urlopen', return_value=io.BytesIO(json.dumps(data).encode())) as request:
            rows, observed = pid.fetch_board('A', 60)
        self.assertEqual(observed, stamp)
        self.assertIsNone(rows[0]['delay_seconds'])
        self.assertEqual(request.call_args.args[0].full_url, self.endpoint + '?stops=A&minutes=60')

    def test_internal_target_cannot_be_render_production_or_arbitrary_host(self):
        for endpoint in ['https://example.onrender.com/api', 'https://skola.eduvize.cz/api', 'http://transit:8000/other', self.endpoint + '?token=x']:
            with self.subTest(endpoint=endpoint), patch.dict('os.environ', EDUVIZE_TRANSPORT_REALTIME_URL=endpoint), patch.object(pid, 'urlopen') as request:
                with self.assertRaises(HTTPException) as error:
                    pid.fetch_board('A', 60)
                self.assertEqual(error.exception.status_code, 503)
                request.assert_not_called()

    def test_internal_authentication_failure_remains_denial(self):
        for status in [401, 403]:
            with patch.dict('os.environ', EDUVIZE_TRANSPORT_REALTIME_URL=self.endpoint), patch.object(pid, 'urlopen', side_effect=HTTPError(self.endpoint, status, 'denied', {}, None)):
                with self.assertRaises(HTTPException) as error:
                    pid.fetch_board('A', 60)
                self.assertEqual(error.exception.status_code, 403)

    def test_departure_endpoint_retains_oldest_observation_instead_of_refreshing_it(self):
        with patch.object(pid, 'fetch_board', side_effect=[([], '2026-11-02T12:00:00+00:00'), ([], '2026-11-02T12:01:00+00:00')]):
            data = pid.departures('A|B', 60)
        self.assertEqual(data['generated_at'], '2026-11-02T12:00:00+00:00')
        self.assertEqual(data['departures'], [])

    def test_internal_board_cannot_return_another_selection_or_missing_age(self):
        for data in [{'source': 'golemio', 'known_stops': ['B'], 'generated_at': '2026-11-02T12:00:00Z', 'departures': []}, {'source': 'golemio', 'known_stops': ['A'], 'departures': []}]:
            with patch.dict('os.environ', EDUVIZE_TRANSPORT_REALTIME_URL=self.endpoint), patch.object(pid, 'urlopen', return_value=io.BytesIO(json.dumps(data).encode())):
                with self.assertRaises(HTTPException):
                    pid.fetch_board('A', 60)

    def test_public_compressed_shards_are_bytes_not_automatically_decompressed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root/'national/shards').mkdir(parents=True)
            content = gzip.compress(b'{"schemaVersion":1}')
            (root/'national/shards/ab.json.gz').write_bytes(content)
            (root/'private.txt').write_text('not public')
            with patch.dict('os.environ', EDUVIZE_TRANSPORT_DATA_DIR=folder):
                client = TestClient(pid.app)
                response = client.get('/api/v1/national/shards/ab.json.gz')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, content)
                self.assertNotIn('content-encoding', response.headers)
                self.assertEqual(response.headers['content-type'], 'application/gzip')
                self.assertEqual(client.get('/api/v1/national/shards/private.txt').status_code, 404)
                self.assertEqual(client.get('/api/v1/national/shards/cc.json.gz').status_code, 404)
