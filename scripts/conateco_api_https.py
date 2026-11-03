"""Verified HTTPS session for the public api.conateco.it endpoints.

Only Sectigo intermediates are downloaded, and they are NEVER installed as
trust anchors. The server leaf is verified against OS-trusted roots. Requests
continues to validate the hostname, full certificate chain and dates.
"""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
import re
import subprocess
import requests

from scripts.conateco_verified_https import _intermediate, _bundle

HOST="api.conateco.it"
FORECAST_URL="https://api.conateco.it/ConatecoServicesApi/BerthForecast"
BOOKING_URL="https://api.conateco.it/ConatecoServicesApi/Booking"
CA_FILES=("SectigoPublicServerAuthenticationCADVR36.crt",
          "SectigoPublicServerAuthenticationRootR46_USERTrust.crt")

@contextmanager
def verified_conateco_api_session():
  with TemporaryDirectory(prefix="conateco-api-") as temp:
    wd=Path(temp)
    root=_bundle()
    chain="\n".join(_intermediate(name) for name in CA_FILES)+"\n"
    (wd/"untrusted.pem").write_text(chain,encoding="ascii")
    proc=subprocess.run(
      ["openssl","s_client","-connect",HOST+":443","-servername",HOST,"-showcerts"],
      input="",capture_output=True,text=True,timeout=18)
    match=re.search("-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
      proc.stdout+"\n"+proc.stderr,re.S)
    if not match:raise RuntimeError("CONATECO API leaf certificate missing")
    (wd/"leaf.pem").write_text(match.group(0)+"\n",encoding="ascii")
    result=subprocess.run([
      "openssl","verify","-purpose","sslserver","-verify_hostname",HOST,
      "-CAfile",str(root),"-untrusted",str(wd/"untrusted.pem"),str(wd/"leaf.pem")
    ],capture_output=True,text=True,timeout=15)
    if result.returncode:raise RuntimeError("CONATECO API chain cannot be verified: "+result.stderr[:230])
    bundle=wd/"ca.pem"
    bundle.write_bytes(root.read_bytes()+b"\n"+chain.encode("ascii"))
    s=requests.Session()
    s.verify=str(bundle)
    s.headers.update({"User-Agent":"ContainerBookingWeb-PublicSchedule/1.0","Accept":"application/json"})
    try:yield s
    finally:s.close()
