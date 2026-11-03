"""Read only the four official public CO.NA.TE.CO. berth forecast feeds.

Never submits a booking number or credentials. TLS is verified using the
preexisting system CA trust store and Sectigo's intermediate chain.
The exported JSON contains public vessel schedule fields only.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse

from scripts.conateco_api_https import verified_conateco_api_session,FORECAST_URL

OUT=Path(__file__).resolve().parent.parent/"data"/"conateco.json"
CATEGORIES=("PRESENTI","PREVISTE","ORMEGGIATE","PARTITE")
VALID_NAME=re.compile(r"^[\w\s.'()/&-]{3,120}$",flags=re.UNICODE)
VALID_VOYAGE=re.compile(r"^[A-Z0-9./_-]{1,35}$",flags=re.I)
DATE_DAY=re.compile(r"^\d{4}-\d{2}-\d{2}$")

def parse_terminal_date(day,clock):
    """UTC-free wall-clock datetime in Europe/Rome; validation is strict."""
    raw=str(day or "").strip()
    if not raw or raw=="0":return ""
    if re.fullmatch(r"\d{8}",raw):
        raw=raw[:4]+"-"+raw[4:6]+"-"+raw[6:]
    if not DATE_DAY.fullmatch(raw):return ""
    time=str(clock or "").strip().replace(".",":")
    if not re.fullmatch(r"\d{1,2}:\d{2}",time):return ""
    try:
        dt=datetime.strptime(raw+" "+time,"%Y-%m-%d %H:%M")
        return dt.strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return ""

def text(obj,key):
    raw=obj.get(key,"")
    return str(raw).strip() if raw is not None else ""

def normalize_public_row(item,category):
    if not isinstance(item,dict):return None
    vessel=text(item,"nome_nave")
    voyage=text(item,"viaggioimbarco")
    if not VALID_NAME.fullmatch(vessel) or not VALID_VOYAGE.fullmatch(voyage):return None
    eta=parse_terminal_date(item.get("data_previ"),item.get("ora_previs"))
    if not eta:return None
    status=text(item,"cod_stato").upper()
    booking_accepted=text(item,"accettaCarico")
    icon=text(item,"iconaStatoNave").upper()
    stop=text(item,"stopcarico").upper()
    if booking_accepted not in ("0","1",""):booking_accepted=""
    if icon not in ("ACCETTA_CARICO","NO_ACCETTA_CARICO","CHIUSA",""):
        icon=""
    return {
       "vessel":vessel,
       "voyage":voyage,
       "eta":eta,
       "vessel_status":status,
       "category":category,
       "voyage_id":text(item,"id_viaggio")[:40],
       "carrier":text(item,"nome_armatore")[:100],
       "acceptance_flag":booking_accepted,
       "acceptance_icon":icon,
       "stop_cargo":stop[:20],
       "external_depot":text(item,"accettazioneesterni")[:140],
       "opening":parse_terminal_date(item.get("tdtac1"),item.get("torac1")),
       "closing":parse_terminal_date(item.get("tdtcd1"),item.get("torcd1")),
       "notes":(text(item,"note")+" "+text(item,"note2")).strip()[:160],
    }

def build_rows(data_by_category):
    result={}
    priority={"PREVISTE":0,"PRESENTI":1,"ORMEGGIATE":2,"PARTITE":3}
    for category in CATEGORIES:
        original=data_by_category.get(category)
        if not isinstance(original,list):raise ValueError("CONATECO category "+category+" must be a JSON array")
        for item in original:
            row=normalize_public_row(item,category)
            if row is None:continue
            key=(row["voyage_id"],row["vessel"].upper(),row["voyage"].upper())
            if key in result:
                existing=result[key]
                conflict=(existing["acceptance_flag"],existing["acceptance_icon"],existing["stop_cargo"],existing["closing"],existing["external_depot"]) != (
                    row["acceptance_flag"],row["acceptance_icon"],row["stop_cargo"],row["closing"],row["external_depot"])
                row["source_conflict"]=conflict or existing.get("source_conflict",False)
                if priority[category]>=priority[existing["category"]]:
                    result[key]=row
                elif conflict:
                    existing["source_conflict"]=True
            else:
                row["source_conflict"]=False
                result[key]=row
    return sorted(result.values(),key=lambda r:(r["eta"],r["vessel"]))

def fetch_forecast_data():
    records={}
    with verified_conateco_api_session() as session:
        for category in CATEGORIES:
            response=session.get(FORECAST_URL,params={"stato":category},timeout=25,allow_redirects=False)
            if urlparse(response.url).hostname!="api.conateco.it":
                raise ValueError("CONATECO API redirected to unexpected host")
            response.raise_for_status()
            if "json" not in response.headers.get("Content-Type","").lower():
                raise ValueError("CONATECO API returned non-JSON for "+category)
            records[category]=response.json()
    rows=build_rows(records)
    if len(rows)<2:raise ValueError("Too few valid CONATECO vessels; refusing to publish")
    return {"source":FORECAST_URL,"source_updated_at":None,"rows":rows}

def main():
    data=fetch_forecast_data()
    data["acquired_at"]=datetime.now(timezone.utc).isoformat()
    existing={}
    if OUT.is_file():
        try:existing=json.loads(OUT.read_text(encoding="utf-8"))
        except (ValueError,OSError):existing={}
    if existing.get("rows") and len(data["rows"])<max(2,len(existing["rows"])//2):
        raise RuntimeError("Sudden loss of over half CONATECO vessels; retaining old snapshot")
    OUT.parent.mkdir(parents=True,exist_ok=True)
    temp=OUT.with_suffix(".tmp")
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    temp.replace(OUT)
    print("CO.NA.TE.CO. Berth Forecast:",len(data["rows"]),"public voyages acquired")

if __name__=="__main__":
    try:main()
    except Exception as err:
        print("CONATECO public forecast unavailable: "+str(err)[:350],file=sys.stderr)
        sys.exit(1)
