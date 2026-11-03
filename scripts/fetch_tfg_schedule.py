"""Read the public TFG vessel schedule over verified HTTPS.

This is a conservative parser: if the TFG layout changes or the page cannot
be verified, no new snapshot is produced and the web app fails closed.
"""
from __future__ import annotations
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
try:
    from scripts.tfg_verified_https import fetch_verified_tfg_html
except ModuleNotFoundError:
    from tfg_verified_https import fetch_verified_tfg_html

URL = "https://tfg.bucci.it/@/TFGW_TP_ETA"
OUT = Path(__file__).resolve().parent.parent / "data" / "tfg_schedule.json"
DATE = re.compile(r"\b\d{2}/\d{2}/(?:\d{2}|\d{4})\b")
UPDATE = re.compile(
    r"Ultimo\s+aggiornamento\s*:\s*(\d{2}/\d{2}/(?:\d{2}|\d{4}))\s+alle\s+(\d{1,2}:\d{2}:\d{2})",
    flags=re.I,
)


def source_updated_at(soup):
    text = soup.get_text(" ", strip=True)
    match = UPDATE.search(text)
    if not match:
        raise ValueError("TFG last-updated timestamp missing; refusing to publish unverified feed")
    day, hhmmss = match.groups()
    fmt = "%d/%m/%y %H:%M:%S" if len(day.split("/")[-1]) == 2 else "%d/%m/%Y %H:%M:%S"
    local = datetime.strptime(day + " " + hhmmss, fmt).replace(tzinfo=ZoneInfo("Europe/Rome"))
    return local.isoformat()


def terminal_di_consegna(value):
    """Only the official schedule column TERMINAL DI CONSEGNA."""
    p = re.sub(r"\s+", " ", str(value)).strip().upper()
    bad = {"", "S", "N", "SI", "NO", "N/D", "ND", "N.A.", "NA", "N/A", "-",
           "—", "NON INDICATO", "NON DISPONIBILE", "DA VERIFICARE",
           "UNKNOWN", "NULL", "LUOGO NON PUBBLICATO"}
    if p in bad or len(p) < 3 or len(p) > 80:
        return ""
    if not re.fullmatch(r"[A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 .,&()'/-]{2,79}", p):
        return ""
    return "DRYPORT" if p == "DRY PORT" else p


def parse_tfg_html(html):
    soup = BeautifulSoup(html, "html.parser")
    content = soup.get_text(" ", strip=True).upper()
    required = ("ARR.VOY", "DEPT.VOY", "ACCETTA CARICO", "TERMINAL DI CONSEGNA")
    if not all(term in content for term in required):
        raise ValueError("TFG schedule header missing or changed")
    updated = source_updated_at(soup)
    rows = []
    seen = set()
    for tr in soup.select("tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) < 14:
            continue
        values = [cell.get_text(" ", strip=True).replace("\xa0", " ").strip() for cell in cells]
        # Official TFG grid uses four ETA/ETB date/time cells before vessel.
        # Reject unexpectedly different layouts instead of shifting columns.
        if not DATE.fullmatch(values[0]):
            continue
        if len(values) < 14 or not DATE.fullmatch(values[2]) and values[2].strip():
            # ETB can be empty for future ships; dates must otherwise be valid.
            continue
        vessel = values[4].strip()
        arrival_voyage = values[5].strip()
        departure_voyage = values[8].strip()
        acceptance = values[10].strip()
        custom_close_time = values[9].strip()
        fast_corridor_cut_off = values[11].strip()
        destination = terminal_di_consegna(values[12])
        eta = (values[0] + " " + values[1]).strip()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9 .'-]{2,80}", vessel, flags=re.I):
            continue
        if not re.fullmatch(r"[A-Z0-9./-]{1,26}", departure_voyage, flags=re.I):
            continue
        if not re.fullmatch(r"[A-Z0-9./-]{1,26}", arrival_voyage, flags=re.I):
            continue
        if not any(token in acceptance.upper() for token in (
            "ACCETTA CARICO", "NAVE CHIUSA", "CARICO DAL", "IMBARCO CHIUSO", "NON ACCETTA"
        )):
            # Missing text or image-only state: leave it as unconfirmed.
            acceptance = ""
        key = (vessel.upper(), departure_voyage.upper(), eta)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "vessel": vessel,
            "arrival_voyage": arrival_voyage,
            "departure_voyage": departure_voyage,
            "eta": eta,
            "acceptance": acceptance,
            "custom_close_time": custom_close_time,
            "fast_corridor_cut_off": fast_corridor_cut_off,
            # The public table has no unambiguous general gate-in cut-off.
            # Do not interpret Fast Corridor cut-off as universal closure.
            "gate_cut_off": "",
            "destination": destination,
        })
    if not rows:
        raise ValueError("No TFG rows parsed; keeping previous data")
    return {"source": URL, "source_updated_at": updated, "rows": rows}


def main():
    html=fetch_verified_tfg_html()
    data = parse_tfg_html(html)
    now = datetime.now(timezone.utc)
    published_time = datetime.fromisoformat(data["source_updated_at"])
    if published_time.astimezone(timezone.utc) > now.replace(microsecond=0) and (published_time.astimezone(timezone.utc) - now).total_seconds() > 300:
        raise ValueError("TFG reports a timestamp more than five minutes in the future")
    existing = {}
    if OUT.is_file():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            existing = {}
    # Una verifica riuscita va registrata anche se i dati ufficiali non sono cambiati.
    # acquired_at = ultima lettura, source_updated_at = ultimo update dichiarato
    # dal terminal. Non devono mai essere confusi: solo il secondo prova
    # l'aggiornamento della programmazione pubblicata.
    unchanged = (
        existing.get("rows") == data["rows"]
        and existing.get("source_updated_at") == data["source_updated_at"]
    )
    if existing.get("rows") and len(data["rows"]) < len(existing["rows"]) // 2:
        raise ValueError("Unexpected large drop in TFG vessel count; manual review needed")
    data["acquired_at"] = now.isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(OUT)
    print("TFG public schedule " + ("verified unchanged" if unchanged else "updated")
          + ": " + str(len(data["rows"])) + " rows, acquired " + data["acquired_at"]
          + ", terminal source " + data["source_updated_at"])


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print("TFG public schedule unavailable; keeping previous snapshot: " + str(err)[:300], file=sys.stderr)
        sys.exit(1)
