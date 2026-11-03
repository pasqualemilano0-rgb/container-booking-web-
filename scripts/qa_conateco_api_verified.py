"""Probe public CONATECO booking API with one definitely fictional booking.

Verifies Sectigo chain to preexisting system trusted root, no verify=False.
Prints schema only; no booking result values or real booking numbers.
"""
import re
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
import requests
from scripts.conateco_verified_https import _intermediate,_bundle

HOST="api.conateco.it"
URL="https://api.conateco.it/ConatecoServicesApi/Booking"
CA_FILES=("SectigoPublicServerAuthenticationCADVR36.crt",
          "SectigoPublicServerAuthenticationRootR46_USERTrust.crt")

def test():
    p=subprocess.run(
      ["openssl","s_client","-connect",HOST+":443","-servername",HOST,"-showcerts"],
      input="",capture_output=True,text=True,timeout=18)
    match=re.search("-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        p.stdout+"\n"+p.stderr,re.S)
    if not match:raise RuntimeError("API leaf missing")
    with TemporaryDirectory() as temp:
      wd=Path(temp)
      (wd/"leaf.pem").write_text(match.group(0)+"\n")
      chain="\n".join(_intermediate(name) for name in CA_FILES)+"\n"
      (wd/"chain.pem").write_text(chain)
      root=_bundle()
      verified=subprocess.run(["openssl","verify","-purpose","sslserver",
        "-verify_hostname",HOST,"-CAfile",str(root),
        "-untrusted",str(wd/"chain.pem"),str(wd/"leaf.pem")],
        capture_output=True,text=True,timeout=15)
      if verified.returncode:raise RuntimeError("API leaf invalid: "+verified.stderr[:200])
      print("API TLS certificate verified to OS trusted roots.",flush=True)
      (wd/"bundle.pem").write_bytes(root.read_bytes()+b"\n"+chain.encode())
      response=requests.get(URL,params={"id_booking":"QA_NONEXISTENT_BOOKING_00000000"},
          headers={"Origin":"https://pasqualemilano0-rgb.github.io","Accept":"application/json",
                   "User-Agent":"ContainerBookingWeb-CompatibilityTest/1.0"},
          verify=str(wd/"bundle.pem"),timeout=20,allow_redirects=False)
      print("API HTTP:",response.status_code,flush=True)
      print("API Content-Type:",response.headers.get("Content-Type"),flush=True)
      print("CORS Allow-Origin:",response.headers.get("Access-Control-Allow-Origin"),flush=True)
      print("CORS Allow-Methods:",response.headers.get("Access-Control-Allow-Methods"),flush=True)
      print("Content length:",len(response.content),flush=True)
      if urlparse(response.url).hostname!=HOST:raise RuntimeError("Unexpected API location")
      if response.headers.get("Content-Type","").lower().startswith("application/json"):
        try:
            data=response.json()
            print("Response type:",type(data).__name__,flush=True)
            if isinstance(data,dict):print("Response keys:",sorted(map(str,data.keys()))[:45],flush=True)
        except ValueError: print("Invalid JSON",flush=True)

if __name__=="__main__":test()
