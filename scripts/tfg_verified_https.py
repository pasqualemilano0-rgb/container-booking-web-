"""Read the public TFG schedule while retaining full TLS certificate checks.

TFG currently sends only its leaf certificate. The Sectigo issuer and
cross-signed root are distributed at the CA's publicly documented endpoints.
We verify the *remote leaf* with OpenSSL against the operating system's
already-trusted roots, using the downloaded certificates only as UNTRUSTED
intermediates. We then supply the same chain to Requests, preserving hostname
checking and all CA validation. No verify=False or insecure request.
"""
from __future__ import annotations

import re
import ssl
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
from urllib.request import urlopen, Request

import requests

TFG_HOST = "tfg.bucci.it"
TFG_SCHEDULE_URL = "https://tfg.bucci.it/@/TFGW_TP_ETA"
SECTIGO_CERT_HOST = "crt.sectigo.com"
INTERMEDIATES = (
    "SectigoPublicServerAuthenticationCADVR36.crt",
    "SectigoPublicServerAuthenticationRootR46_USERTrust.crt",
)


def _system_ca_file() -> Path:
    # GitHub Actions Linux runner: system CA bundle, including USERTrust.
    for path in (
        Path("/etc/ssl/certs/ca-certificates.crt"),
        Path(ssl.get_default_verify_paths().cafile or "/nonexistent"),
    ):
        if path.is_file():
            return path
    raise RuntimeError("No system-trusted CA bundle available")


def _fetch_intermediate(name: str) -> str:
    # HTTP is deliberately used because this is Sectigo's documented
    # distribution channel. The downloaded CA certificates cannot by
    # themselves make an arbitrary leaf trusted: OpenSSL checks their
    # signatures all the way to a *preexisting system trust anchor*.
    address = "http://" + SECTIGO_CERT_HOST + "/" + name
    with urlopen(Request(address, headers={"User-Agent": "ContainerBooking-TLS/1.0"}), timeout=12) as response:
        if urlparse(response.url).hostname != SECTIGO_CERT_HOST:
            raise ValueError("Unexpected CA certificate redirect")
        blob = response.read(20_001)
    if not blob or len(blob)>20_000:
        raise ValueError("Unexpected CA certificate size")
    if blob.startswith(b"-----BEGIN CERTIFICATE-----"):
        return blob.decode("ascii")
    return ssl.DER_cert_to_PEM_cert(blob)


def _get_remote_leaf() -> str:
    proc = subprocess.run(
        ["openssl", "s_client", "-connect", TFG_HOST + ":443",
         "-servername", TFG_HOST, "-showcerts"],
        input="", text=True, capture_output=True, timeout=18,
    )
    match = re.search(
        r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        proc.stdout + "\n" + proc.stderr, flags=re.S,
    )
    if not match:
        raise RuntimeError("TFG did not present a TLS leaf certificate")
    return match.group(0) + "\n"


def fetch_verified_tfg_html() -> str:
    # Try ordinary verified HTTPS first: if TFG fixes its server chain,
    # no workaround is necessary.
    headers={"User-Agent":"ContainerBookingWeb-TFG-Schedule/1.0","Accept":"text/html"}
    try:
        response=requests.get(TFG_SCHEDULE_URL,headers=headers,timeout=25)
        response.raise_for_status()
        if urlparse(response.url).hostname != TFG_HOST:
            raise ValueError("Unexpected TFG redirect")
        return response.text
    except requests.exceptions.SSLError:
        pass

    with TemporaryDirectory(prefix="tfg-verified-") as temp:
        path = Path(temp)
        intermediate_pem = "\n".join(_fetch_intermediate(name) for name in INTERMEDIATES) + "\n"
        (path / "untrusted.pem").write_text(intermediate_pem,encoding="ascii")
        (path / "leaf.pem").write_text(_get_remote_leaf(),encoding="ascii")
        root_ca = _system_ca_file()

        # Do not trust any certificate obtained over HTTP: verify the
        # server certificate using the existing system trust anchors.
        check = subprocess.run(
            ["openssl", "verify", "-purpose", "sslserver",
             "-verify_hostname", TFG_HOST, "-CAfile", str(root_ca),
             "-untrusted", str(path / "untrusted.pem"),
             str(path / "leaf.pem")],
            text=True,capture_output=True,timeout=15,
        )
        if check.returncode != 0:
            raise RuntimeError("TFG TLS chain cannot be verified to system roots: " + check.stderr[:300])

        bundle = path / "ca-bundle.pem"
        bundle.write_bytes(root_ca.read_bytes()+b"\n"+intermediate_pem.encode("ascii"))
        response=requests.get(TFG_SCHEDULE_URL,headers=headers,timeout=25,verify=str(bundle))
        response.raise_for_status()
        if urlparse(response.url).hostname != TFG_HOST:
            raise ValueError("Unexpected TFG redirect")
        return response.text
