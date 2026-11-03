"""Import public SCT vessel schedule with strict column mapping and verified HTTPS.

The source is an official iframe, not an API. Never publish a new snapshot when
the HTML structure changes or the result appears damaged. A fetch timestamp is
not the same thing as a terminal-declared last-update timestamp.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

URL = "https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php"
OUT = Path(__file__).resolve().parent.parent / "data" / "sct.json"
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
STATUS_ALLOWED = {
    "PENDING", "FORECAST", "SCHEDULED", "ARRIVED", "BERTHED",
    "IN PORT", "WORKING", "LOADING", "DEPARTED", "SAILED",
    "CLOSED", "CANCELLED", "CANCELED", "COMPLETED", "TERMINATED",
}
ACCEPTANCE_ALLOWED = {
    "CARGO ACCEPTED", "NOT ACCEPTED", "CARGO NOT ACCEPTED",
    "NOT ACCEPTING", "CARGO REJECTED", "REJECTED",
}
# An explicit upstream update time can be introduced when SCT publishes it.
# At present no such timestamp was found on the public iframe.
UPSTREAM_UPDATED = re.compile(
    r"(?:last\s+updated|ultimo\s+aggiornamento|updated\s+at)\s*[:\-]?\s*"
    r"(\d{2}/\d{2}/\d{4})\s+(?:alle\s+)?(\d{1,2}:\d{2})(?::\d{2})?",
    flags=re.I,
)


def text_of(cell):
    return " ".join(cell.stripped_strings).replace("\xa0", " ").strip()


def normalize_header(value):
    return re.sub(r"\s+", " ", value.upper()).strip()


def schedule_columns(table):
    """Identify column positions by actual TH cells, not guessed row offsets."""
    for tr in table.select("tr"):
        th=tr.find_all("th",recursive=False)
        headers=[normalize_header(text_of(h)) for h in th]
        required=("DATE","E.T.A.","VESSEL","VOYAGE","CLOSING TIME","STATUS")
        if not all(key in headers for key in required):
            continue
        dry=[i for i,x in enumerate(headers) if x=="ACCEPTANCE DRY"]
        reef=[i for i,x in enumerate(headers) if x in ("ACCEPTANCE REEF","ACCEPTANCE REEFER")]
        if not dry or not reef:
            continue
        mapped={key.lower().replace(" ","_").replace(".",""):headers.index(key) for key in required}
        mapped["dry"]=dry[-1]
        mapped["reef"]=reef[-1]
        if mapped["dry"]<=mapped["status"] or mapped["reef"]<=mapped["status"]:
            continue
        if mapped["dry"]==mapped["reef"]:
            continue
        return mapped
    return None


def extract_rows(html):
    soup=BeautifulSoup(html,"html.parser")
    rows=[]
    seen=set()
    found_header=False
    for table in soup.select("table"):
        cols=schedule_columns(table)
        if not cols:
            continue
        found_header=True
        for tr in table.select("tr"):
            cells=tr.find_all("td",recursive=False)
            if len(cells)<=max(cols.values()):
                continue
            fields=[text_of(c) for c in cells]
            date=fields[cols["date"]]
            if not DATE_RE.fullmatch(date):
                continue
            # A valid date is required; invalid times are retained as missing
            # so the UI fails closed rather than confirming the wrong ETA.
            try:
                datetime.strptime(date,"%d/%m/%Y")
            except ValueError:
                continue
            eta_time=fields[cols["eta"]]
            if not TIME_RE.fullmatch(eta_time):
                eta_time=""
            vessel=fields[cols["vessel"]].strip()
            voyage=fields[cols["voyage"]].strip()
            if not 3<=len(vessel)<=160 or not 1<=len(voyage)<=60:
                continue
            status=normalize_header(fields[cols["status"]])
            if status not in STATUS_ALLOWED:
                status=""  # Unknown states are never treated as accepting cargo.
            dry=normalize_header(fields[cols["dry"]])
            reef=normalize_header(fields[cols["reef"]])
            if dry not in ACCEPTANCE_ALLOWED:dry=""
            if reef not in ACCEPTANCE_ALLOWED:reef=""
            closing=fields[cols["closing_time"]]
            row={
                "vessel":vessel,
                "voyage":voyage,
                "eta":(date+" "+eta_time).strip(),
                "closing":closing,
                "acceptance_dry":dry,
                "acceptance_reef":reef,
                "status":status,
            }
            key=(vessel.upper(),voyage.upper(),row["eta"])
            if key not in seen:
                rows.append(row)
                seen.add(key)
    return rows


def upstream_timestamp(html):
    match=UPSTREAM_UPDATED.search(BeautifulSoup(html,"html.parser").get_text(" ",strip=True))
    if not match:return None
    # The source's timestamp is local Italian time (when present).
    from zoneinfo import ZoneInfo
    local=datetime.strptime(match[1]+" "+match[2],"%d/%m/%Y %H:%M")
    return local.replace(tzinfo=ZoneInfo("Europe/Rome")).isoformat()


def fetch_public_sct():
    response=requests.get(URL,timeout=25,headers={
        "User-Agent":"ContainerBookingWeb-PublicSchedule/1.0",
        "Accept":"text/html",
        "Accept-Language":"it-IT,it;q=0.8,en;q=0.5",
    })
    response.raise_for_status()
    if urlparse(response.url).hostname!="www.salernocontainerterminal.com":
        raise ValueError("Unexpected SCT redirect")
    if "html" not in response.headers.get("Content-Type","").lower():
        raise ValueError("Unexpected SCT response content type")
    rows=extract_rows(response.text)
    if not rows:
        raise ValueError("No valid SCT voyages; refusing to publish an empty/changed table")
    return rows,upstream_timestamp(response.text)


def build_snapshot(rows,now,previous=None,source_updated_at=None):
    previous=previous if isinstance(previous,dict) else {}
    if not rows:
        raise ValueError("SCT empty schedule is not a valid snapshot")
    previous_rows=previous.get("rows") if isinstance(previous.get("rows"),list) else []
    if previous_rows and len(rows)<max(2,len(previous_rows)//2):
        raise ValueError("Unexpected large drop in SCT voyage count; keeping last snapshot")
    changed=previous_rows!=rows
    changed_at=now.isoformat() if changed or not previous.get("data_changed_at") else previous["data_changed_at"]
    return {
        "source":URL,
        "updated_at":now.isoformat(),  # existing UI expects this key
        "acquired_at":now.isoformat(),
        "source_updated_at":source_updated_at,  # null when SCT does not publish it
        "data_changed_at":changed_at,
        "rows":rows
    }


def main():
    rows,source_updated_at=fetch_public_sct()
    previous={}
    if OUT.is_file():
        try:
            previous=json.loads(OUT.read_text(encoding="utf-8"))
        except (ValueError,OSError):
            previous={}
    payload=build_snapshot(rows,datetime.now(timezone.utc),previous,source_updated_at)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    tmp=OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    os.replace(tmp,OUT)
    print(f"SCT verified public schedule: {len(rows)} voyages; "
          f"acquired {payload['acquired_at']}; "
          f"terminal update {source_updated_at or 'not declared'}; "
          f"data changed {payload['data_changed_at']}",flush=True)


if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("SCT scrape unavailable: "+str(exc)[:300],file=sys.stderr)
        sys.exit(1)
