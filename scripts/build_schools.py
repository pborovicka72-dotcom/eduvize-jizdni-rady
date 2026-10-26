"""Build the static PID school search catalog from the official MŠMT JSON-LD export."""
import json
import os
import tempfile
import urllib.request
from pathlib import Path

URL = "https://lkod-ftp.msmt.gov.cz/00022985/88a7c12b-6084-4e47-8b50-46097c6e683f/RSSZ-cela-CR.jsonld"
DEST = Path("data/schools.json")

def build(data):
    rows = {}
    for org in data.get("list", []):
        if not isinstance(org, dict):
            continue
        for school in org.get("skolyAZarizeni", []):
            if not isinstance(school, dict) or str(school.get("druh") or "").startswith(("G", "L")):
                continue
            name = " ".join(str(org.get("uplnyNazev") or school.get("uplnyNazev") or "").split())
            for place in school.get("mistaVyuky", []):
                address = place.get("adresa") if isinstance(place, dict) else None
                if not isinstance(address, dict) or not name:
                    continue
                city = str(address.get("obec") or address.get("nazevObce") or "").strip()
                if not city:
                    continue
                street = str(address.get("ulice") or address.get("nazevUlice") or "").strip()
                number = str(address.get("cisloDomovni") or address.get("cisloPopisne") or "").strip()
                orient = str(address.get("cisloOrientacni") or "").strip()
                if orient:
                    number += "/" + orient
                addr = ", ".join(x for x in (" ".join(x for x in (street, number) if x), city, str(address.get("psc") or "").strip()) if x)
                ruian = str(address.get("kodRUIAN") or "").strip()
                if not ruian.isdigit():
                    continue
                row = {"label": name, "address": addr, "municipality": city, "ruian": ruian}
                rows[(name, addr, ruian)] = row
    return sorted(rows.values(), key=lambda x: (x["label"].casefold(), x["address"].casefold()))

def main():
    with urllib.request.urlopen(URL, timeout=180) as response:
        data = json.load(response)
    if len(data.get("list", [])) < 5000:
        raise RuntimeError("Unexpected registry size")
    items = build(data)
    if len(items) < 9000:
        raise RuntimeError(f"Unexpected school catalog size: {len(items)}")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=DEST.parent, delete=False) as tmp:
        json.dump(items, tmp, ensure_ascii=False, separators=(",", ":"))
        tmp_path = tmp.name
    os.replace(tmp_path, DEST)
    print("School locations:", len(items))

if __name__ == "__main__":
    main()
