"""Offline search in an index generated from official MŠMT school registry JSON-LD.

No third-party geocoder, database, or network request is needed for searching.
Run: python -m weather_service.school_registry /path/to/RSSZ-cela-CR.jsonld
"""
import json
import sys
import unicodedata
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "data" / "schools.json"


# Some distributed MŠMT exports contain UTF-8 bytes decoded as ISO-8859-2.
_LATIN2_REVERSE = {ord(bytes([i]).decode("iso8859_2")): i for i in range(256)}


def repair_mojibake(value):
    """Repair reversible UTF-8/ISO-8859-2 mojibake without altering valid Czech."""
    if not isinstance(value, str) or not any(ch in value for ch in ("Ă", "Ä", "Ĺ")):
        return value
    try:
        repaired = value.encode("iso-8859-2").decode("utf-8")
    except (UnicodeError, ValueError):
        return value
    return repaired


def fold(value):
    value = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def records(document):
    if isinstance(document, list):
        return document
    if isinstance(document, dict):
        for key in ("list", "@graph", "data", "items", "polozky"):
            if isinstance(document.get(key), list):
                return document[key]
        return [document]
    return []


def make_index(document):
    output = {}
    for organization in records(document):
        if not isinstance(organization, dict):
            continue
        for school in organization.get("skolyAZarizeni", []):
            if not isinstance(school, dict):
                continue
            # Generic facility names do not identify the actual institution.
            if str(school.get("druh") or "").startswith(("G", "L")):
                continue
            name = " ".join(repair_mojibake(organization.get("uplnyNazev") or school.get("uplnyNazev")).split())
            for place in school.get("mistaVyuky", []):
                if not isinstance(place, dict):
                    continue
                address = place.get("adresa")
                if not isinstance(address, dict) or not name:
                    continue
                municipality = repair_mojibake(str(address.get("obec") or address.get("nazevObce") or "")).strip()
                street = repair_mojibake(str(address.get("ulice") or address.get("nazevUlice") or "")).strip()
                number = str(address.get("cisloDomovni") or address.get("cisloPopisne") or "").strip()
                orient = str(address.get("cisloOrientacni") or "").strip()
                if orient:
                    number += "/" + orient + str(address.get("dodatekOrientacnihoCisla") or "")
                address_text = ", ".join(part for part in
                    (" ".join(part for part in (street, number) if part),
                     (lambda part: part if fold(part) != fold(municipality) else "")(repair_mojibake(str(address.get("castObce") or "")).strip()), municipality, str(address.get("psc") or "").strip()) if part)
                if not municipality:
                    continue
                ruian = str(address.get("kodRUIAN") or "").strip()
                item = {"label": str(name), "municipality": municipality,
                        "address": address_text, "ruian": ruian}
                output[(item["label"], address_text, ruian)] = item
    return sorted(output.values(), key=lambda x: (fold(x["label"]), fold(x["address"])))


def find_schools(query, limit=30):
    if not INDEX.is_file():
        return None
    words = fold(query).split()
    if not words:
        return []
    result = []
    with INDEX.open(encoding="utf-8") as source:
        items = json.load(source)
    for item in items:
        name = fold(item["label"])
        combined = name + " " + fold(item["address"])
        if all(word in combined for word in words):
            result.append(((0 if name.startswith(fold(query)) else 1,
                            0 if fold(query) in name else 1, name), item))
    result.sort(key=lambda pair: pair[0])
    return [item for _, item in result[:limit]]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m weather_service.school_registry official.jsonld")
    source = Path(sys.argv[1])
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    items = make_index(data)
    if not items:
        raise SystemExit("No teaching locations found: verify official MŠMT JSON-LD structure")
    import os
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=INDEX.parent, delete=False) as tmp:
        json.dump(items, tmp, ensure_ascii=False, separators=(",", ":"))
        temp_path = Path(tmp.name)
    os.replace(temp_path, INDEX)
    print("Indexed", len(items), "school teaching locations")
