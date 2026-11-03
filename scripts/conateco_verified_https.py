"""Verified read-only HTTPS for publicly available CONATECO pages.

CONATECO currently omits an intermediate CA certificate. Download Sectigo's
intermediates, validate the server leaf to OS trusted roots, then use a
CA bundle (system roots + intermediates) with Requests. Never verify=False.
"""
import re
import ssl
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen,Request
from urllib.parse import urlparse
import requests

HOST="www.conateco.it"
URLS={
 "forecast":"https://www.conateco.it/berth-forecast/",
 "booking":"https://www.conateco.it/booking-export/",
 "robots":"https://www.conateco.it/robots.txt",
 "berth-script":"https://www.conateco.it/scripts/berth.js",
}
CA_FILES=(
 "SectigoPublicServerAuthenticationCAOVR36.crt",
 "SectigoPublicServerAuthenticationRootR46_USERTrust.crt",
)

def _bundle():
    for name in ("/etc/ssl/certs/ca-certificates.crt",ssl.get_default_verify_paths().cafile):
        if name and Path(name).is_file():return Path(name)
    raise RuntimeError("No system CA bundle available")

def _intermediate(filename):
    url="http://crt.sectigo.com/"+filename
    with urlopen(Request(url,headers={"User-Agent":"ContainerBookingWeb-HTTPS-Check/1.0"}),timeout=15) as response:
        if urlparse(response.url).hostname!="crt.sectigo.com":
            raise RuntimeError("Unexpected Sectigo redirect")
        blob=response.read(20001)
    if not blob or len(blob)>20000:raise RuntimeError("Invalid certificate file length")
    return blob.decode("ascii") if blob.startswith(b"-----BEGIN CERTIFICATE-----") else ssl.DER_cert_to_PEM_cert(blob)

def _leaf():
    proc=subprocess.run(
      ["openssl","s_client","-connect",HOST+":443","-servername",HOST,"-showcerts"],
      input="",capture_output=True,text=True,timeout=18
    )
    match=re.search("-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
      proc.stdout+"\n"+proc.stderr,re.S)
    if not match:raise RuntimeError("No public CONATECO leaf certificate")
    return match.group(0)+"\n"

def get_public_conateco_html(url):
    if url not in URLS.values():raise ValueError("URL not allowed")
    headers={"User-Agent":"ContainerBookingWeb-PublicSchedule/1.0","Accept":"text/html"}
    try:
        response=requests.get(url,timeout=25,headers=headers)
        response.raise_for_status()
        if urlparse(response.url).hostname!=HOST:raise RuntimeError("Redirected off CONATECO")
        return response.text
    except requests.exceptions.SSLError:
        pass

    with TemporaryDirectory(prefix="conateco-verified-") as td:
        p=Path(td)
        chain="\n".join(_intermediate(file) for file in CA_FILES)+"\n"
        (p/"chain.pem").write_text(chain,encoding="ascii")
        (p/"leaf.pem").write_text(_leaf(),encoding="ascii")
        roots=_bundle()
        verify=subprocess.run([
          "openssl","verify","-purpose","sslserver","-verify_hostname",HOST,
          "-CAfile",str(roots),"-untrusted",str(p/"chain.pem"),str(p/"leaf.pem")
        ],capture_output=True,text=True,timeout=15)
        if verify.returncode:raise RuntimeError("CONATECO chain untrusted: "+verify.stderr[:300])
        bundle=p/"ca-bundle.pem"
        bundle.write_bytes(roots.read_bytes()+b"\n"+chain.encode("ascii"))
        response=requests.get(url,timeout=25,headers=headers,verify=str(bundle))
        response.raise_for_status()
        if urlparse(response.url).hostname!=HOST:raise RuntimeError("Redirected off CONATECO")
        return response.text
