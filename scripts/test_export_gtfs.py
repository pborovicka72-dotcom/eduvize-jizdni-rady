"""Offline regression tests for the static PID exporter; no network/database."""
import csv
import io
import json
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pid_static_export import export


def csv_bytes(columns, data):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    writer.writerows(data)
    return stream.getvalue()


class StaticPidTest(unittest.TestCase):
    def test_export_calendar_exception_and_after_midnight(self):
        today = datetime.now(ZoneInfo("Europe/Prague")).date()
        key = today.strftime("%Y%m%d")
        other = (today + timedelta(days=1)).strftime("%Y%m%d")
        with tempfile.TemporaryDirectory() as temp:
            archive_path = Path(temp) / "feed.zip"
            with zipfile.ZipFile(archive_path, "w") as z:
                z.writestr("stops.txt", csv_bytes(["stop_id", "stop_name"], [
                    {"stop_id": "1", "stop_name": "Test, centrum"}]))
                z.writestr("routes.txt", csv_bytes(["route_id", "route_short_name", "route_type"], [
                    {"route_id": "r", "route_short_name": "9", "route_type": "3"}]))
                z.writestr("trips.txt", csv_bytes(["trip_id", "route_id", "service_id", "trip_headsign"], [
                    {"trip_id": "t", "route_id": "r", "service_id": "s", "trip_headsign": "Nádraží"}]))
                z.writestr("calendar_dates.txt", csv_bytes(["service_id", "date", "exception_type"], [
                    {"service_id": "s", "date": key, "exception_type": "1"},
                    {"service_id": "s", "date": other, "exception_type": "2"}]))
                z.writestr("stop_times.txt", csv_bytes(
                    ["trip_id", "stop_id", "departure_time", "pickup_type"], [
                    {"trip_id": "t", "stop_id": "1", "departure_time": "25:10:00", "pickup_type": "0"}]))
            output = Path(temp) / "out.json"
            with zipfile.ZipFile(archive_path) as z:
                stops, count = export(z, ["Test, centrum"], output, days=1)
            self.assertEqual((stops, count), (1, 1))
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["departures"][0]["scheduled_at"][:10],
                             (today + timedelta(days=1)).isoformat())
            self.assertEqual(data["departures"][0]["line"], "9")
            self.assertFalse(data["realtime_available"])
            with zipfile.ZipFile(archive_path) as z:
                with self.assertRaisesRegex(ValueError, "not found"):
                    export(z, ["Neexistující zastávka"], output, days=1)


if __name__ == "__main__":
    unittest.main()
