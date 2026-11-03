"""Compatibility check for the public CO.NA.TE.CO. Booking Export endpoint.

Only synthetic, definitely nonexistent booking identifiers are used.
Never prints response data or identifiers; examines type/keys/security only.
TLS hostname/chain verification is mandatory, no credential or CAPTCHA bypass.
"""
from scripts.conateco_api_https import verified_conateco_api_session,BOOKING_URL
from scripts.conateco_verified_https import get_public_conateco_html
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import requests,re,json

HOST="api.conateco.it"
ORIGIN="https://pasqualemilano0-rgb.github.io"
SYNTHETIC="QA_NOT_A_REAL_BOOKING_999999999"

def structure(value,depth=0):
    if isinstance(value,dict):
        return {str(k)[:60]: structure(v,depth+1) if depth<1 else type(v).__name__
                for k,v in list(value.items())[:32]}
    if isinstance(value,list):
        return {"type":"array","items":len(value),"first_type":type(value[0]).__name__ if value else None,
                "first_fields": sorted(list(value[0].keys()))[:32] if value and isinstance(value[0],dict) else []}
    return {"type":type(value).__name__}

def main():
    print("=== OFFICIAL PUBLIC BOOKING PAGE (READ ONLY) ===",flush=True)
    try:
        html=get_public_conateco_html("https://www.conateco.it/booking-export/")
        soup=BeautifulSoup(html,"html.parser")
        print("Official page GET: success; bytes",len(html),flush=True)
        print("Script paths:",[x.get("src") for x in soup.select("script[src]") if x.get("src")][:25],flush=True)
        inline=[x.get_text() for x in soup.select("script:not([src])")]
        for snippet in inline:
            for match in re.finditer(r"[^\n]{0,120}(?:ConatecoServicesApi|id_booking|/Booking|\.get\(|\.post\()[^\n]{0,120}",snippet,re.I):
                line=match.group(0)
                if re.search("token|password|bearer|apikey|authorization",line,re.I):continue
                print("Form JS endpoint hint:",re.sub(r"['\"]?[A-Z0-9]{16,}['\"]?","[redacted]",line[:240]),flush=True)
    except Exception as e:print("Page read failed",type(e).__name__,str(e)[:180],flush=True)

    # Read only the publicly served booking form's Vue/axios handler.
    for snippet in inline:
        p=snippet.find("ConatecoServicesApi/Booking")
        if p>=0:
            text=snippet[max(0,p-1100):p+4200]
            text=re.sub(r"(?i)(?:password|token|authorization|api[_-]?key)\\s*[:=]\\s*['\\\"][^'\\\"]+['\\\"]",
                        "[sensitive assignment redacted]",text)
            print("OFFICIAL FORM JS LOGIC:",text,flush=True)
            break

    print("=== VERIFIED API WITH SYNTHETIC NONEXISTENT BOOKING ===",flush=True)
    try:
        with verified_conateco_api_session() as session:
            for params in ({},{"id_booking":SYNTHETIC}):
                result=session.get(BOOKING_URL,params=params,
                    headers={"Origin":ORIGIN,"Accept":"application/json"},
                    allow_redirects=False,timeout=20)
                print("Query mode", "empty" if not params else "synthetic",
                      "HTTP",result.status_code,
                      "content-type",result.headers.get("Content-Type",""),
                      "CORS",result.headers.get("Access-Control-Allow-Origin","(none)"),
                      "bytes",len(result.content),flush=True)
                if urlparse(result.url).hostname!=HOST:raise RuntimeError("Untrusted API redirect")
                if len(result.content)>250000:raise RuntimeError("Oversized API response")
                try:
                    payload=result.json()
                except ValueError:
                    print("Not JSON / payload not printed",flush=True)
                    continue
                print("Schema (types only):",json.dumps(structure(payload),ensure_ascii=False),flush=True)
                if isinstance(payload,dict):
                    print("All response keys:",sorted(map(str,payload.keys())),flush=True)
                    print("Non-null field count:",sum(v is not None for v in payload.values()),flush=True)
                    # These are statuses for a synthetic booking only, not customer data.
                    print("Synthetic ReturnCode:",repr(payload.get("ReturnCode")),flush=True)
                    message=str(payload.get("ReturnMessage","")).replace(SYNTHETIC,"[fictional booking]")
                    print("Synthetic ReturnMessage:",repr(message[:130]),flush=True)
    except Exception as e:
        print("Verified booking API unavailable:",type(e).__name__,str(e)[:250],flush=True)

if __name__=="__main__":main()
