"""Probe only a synthetically nonexistent booking using the public CONATECO endpoint.

No real customer bookings, no credential discovery, no brute force, no response
bodies or identifiers are printed. We only inspect HTTP/TLS/CORS and schema.
"""
from urllib.parse import urlparse
import requests
import subprocess,re
from pathlib import Path
from tempfile import TemporaryDirectory

HOST="api.conateco.it"
URL="https://api.conateco.it/ConatecoServicesApi/Booking"
PARAMS={"id_booking":"QA_NONEXISTENT_BOOKING_00000000"}
headers={"User-Agent":"ContainerBookingWeb-ReadOnlyCompatibility/1.0",
         "Origin":"https://pasqualemilano0-rgb.github.io",
         "Accept":"application/json"}
try:
    response=requests.get(URL,params=PARAMS,headers=headers,timeout=15,allow_redirects=False)
    print("=== Public booking service probe ===")
    print("HTTP:",response.status_code,"content-type:",response.headers.get("Content-Type",""))
    print("ACAO:",response.headers.get("Access-Control-Allow-Origin","(none)"))
    print("Vary:",response.headers.get("Vary","(none)"))
    if response.status_code in (301,302,303,307,308):
        print("Redirect status, not followed")
    elif response.headers.get("Content-Type","").lower().startswith("application/json"):
        try:
            data=response.json()
            print("JSON shape:",type(data).__name__)
            print("JSON fields:",sorted(str(key)[:80] for key in data.keys())[:50] if isinstance(data,dict) else "(not object)")
        except ValueError:
            print("Malformed JSON")
except requests.exceptions.SSLError as e:
    print("API TLS not verifiable:",str(e)[:230])
    p=subprocess.run(["openssl","s_client","-connect",HOST+":443","-servername",HOST,"-showcerts"],
       input="",capture_output=True,text=True,timeout=15)
    blob=p.stdout+"\n"+p.stderr
    for line in blob.splitlines():
        if re.search("issuer=|subject=|Verify return code",line):print(line[:230])
except (requests.RequestException, subprocess.TimeoutExpired) as e:
    print("API probe unavailable:",type(e).__name__,str(e)[:220])
