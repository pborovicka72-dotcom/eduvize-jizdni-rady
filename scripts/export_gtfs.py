"""Export selected PID GTFS stops to a static JSON departure board (no database)."""
import argparse
import csv
import io
import json
import hashlib
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, time
from pathlib import Path
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Prague")
FEED = "https://data.pid.cz/PID_GTFS.zip"


def rows(archive, name):
    if name not in archive.namelist():
        return
    with archive.open(name) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def service_active(service, day, exceptions):
    override = exceptions.get((service, day.strftime("%Y%m%d")))
    if override is not None:
        return override == 1
    return False


def export(archive, names, output, days=2):
    today = datetime.now(TZ).date()
    dates = [today + timedelta(days=i) for i in range(days + 1)]
    targets = {x.casefold().strip() for x in names}
    if not targets and not output.endswith('/_all.json'):
        raise ValueError('No configured stop names')
    stops = {r["stop_id"]: r["stop_name"] for r in rows(archive, "stops.txt")
             if not targets or r["stop_name"].casefold().strip() in targets}
    matched = {name.casefold().strip() for name in stops.values()}
    missing = sorted(targets - matched)
    if missing:
        raise ValueError("Configured stops not found in PID GTFS: " + ", ".join(missing))
    routes = {r["route_id"]: (r.get("route_short_name") or "", int(r.get("route_type") or 3))
              for r in rows(archive, "routes.txt")}
    exceptions = {}
    day_keys = {d.strftime("%Y%m%d") for d in dates}
    for r in rows(archive, "calendar_dates.txt"):
        if r["date"] in day_keys:
            exceptions[(r["service_id"], r["date"])] = int(r["exception_type"])
    active = defaultdict(set)
    weekdays = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    for r in rows(archive, "calendar.txt"):
        for d in dates:
            key = d.strftime("%Y%m%d")
            if r["start_date"] <= key <= r["end_date"] and r[weekdays[d.weekday()]] == "1":
                active[r["service_id"]].add(key)
    for (service, key), value in exceptions.items():
        if value == 1:
            active[service].add(key)
        elif value == 2:
            active[service].discard(key)
    active = {service: daykeys for service, daykeys in active.items() if daykeys}
    trips = {}
    for r in rows(archive, "trips.txt"):
        if r["service_id"] in active:
            trips[r["trip_id"]] = (r["service_id"], r["route_id"], r.get("trip_headsign") or "")
    departures = []
    for r in rows(archive, "stop_times.txt"):
        if r["stop_id"] not in stops or r["trip_id"] not in trips or not r.get("departure_time"):
            continue
        if int(r.get("pickup_type") or 0) == 1:
            continue
        try:
            hh, mm, ss = map(int, r["departure_time"].split(":"))
        except (ValueError, AttributeError):
            continue
        service, route, destination = trips[r["trip_id"]]
        line, route_type = routes.get(route, ("", 3))
        for key in active[service]:
            day = datetime.strptime(key, "%Y%m%d").date()
            # GTFS times are wall-clock times, including hours >= 24.
            # Construct the service-day clock time before attaching Prague TZ.
            local_day = day + timedelta(days=hh // 24)
            moment = datetime.combine(local_day, time(hh % 24, mm, ss), TZ)
            departures.append({
                "scheduled_at": moment.isoformat(),
                "stop_id": r["stop_id"],
                "stop_name": stops[r["stop_id"]],
                "trip_id": r["trip_id"],
                "line": line,
                "route_type": route_type,
                "destination": destination,
            })
    departures.sort(key=lambda d: d["scheduled_at"])
    if not departures:
        raise ValueError("No departures found for selected stops and dates")
    result = {"generated_at": datetime.now(TZ).isoformat(), "source": "pid",
              "realtime_available": False, "departures": departures}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(stops), len(departures)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stops", required=True, help="UTF-8 file: one exact PID GTFS stop_name per line")
    parser.add_argument("--output", default="pid-static/data/departures.json")
    parser.add_argument("--zip", help="Optional local PID GTFS ZIP for offline tests")
    parser.add_argument("--days", type=int, default=2)
    parser.add_argument("--list-stops", action="store_true", help="Print matching stop names from GTFS and exit")
    parser.add_argument("--catalog", help="Write complete stop-name list to JSON")
    parser.add_argument("--all-shards", help="Directory for full PID departures, partitioned into 256 files")
    args = parser.parse_args()
    names = [s.strip() for s in Path(args.stops).read_text(encoding="utf-8").splitlines()
             if s.strip() and not s.lstrip().startswith("#")]
    if not names and not args.all_shards:
        raise ValueError("No stop names configured")
    if args.days < 1 or args.days > 7:
        raise ValueError("--days must be between 1 and 7")
    with TemporaryDirectory() as temp:
        path = Path(args.zip) if args.zip else Path(temp) / "pid.zip"
        if not args.zip:
            urllib.request.urlretrieve(FEED, path)
        with zipfile.ZipFile(path) as archive:
            if args.catalog:
                all_stops = sorted({row["stop_name"] for row in rows(archive, "stops.txt") if row.get("stop_name")})
                geo = defaultdict(list)
                for row in rows(archive, "stops.txt"):
                    try:
                        lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                        if 48 < lat < 52 and 12 < lon < 19:
                            geo[row["stop_name"]].append([round(lat, 6), round(lon, 6)])
                    except (KeyError, ValueError, TypeError):
                        pass
                catalog_path = Path(args.catalog)
                catalog_path.parent.mkdir(parents=True, exist_ok=True)
                catalog_path.write_text(json.dumps({"stops": all_stops, "coordinates": geo}, ensure_ascii=False), encoding="utf-8")
            if args.list_stops:
                words = [name.casefold() for name in names]
                matched = sorted({r['stop_name'] for r in rows(archive, 'stops.txt')
                                  if any(word in r['stop_name'].casefold() for word in words)})
                print('\n'.join(matched) if matched else 'No matching stops')
                return
            count, departures = export(archive, [] if args.all_shards else names, str(Path(args.all_shards) / "_all.json") if args.all_shards else args.output, args.days)
            if args.all_shards:
                root = Path(args.all_shards)
                payload = json.loads((root / "_all.json").read_text(encoding="utf-8"))
                groups = defaultdict(list)
                for departure in payload["departures"]:
                    key = hashlib.sha256(departure["stop_name"].encode("utf-8")).hexdigest()[:2]
                    groups[key].append(departure)
                for key, items in groups.items():
                    (root / (key + ".json")).write_text(json.dumps({"generated_at": payload["generated_at"], "source": "pid", "departures": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                (root / "_all.json").unlink()
        print(f"Exported {departures} departures for {count} stops to {args.output}")


if __name__ == "__main__":
    main()
