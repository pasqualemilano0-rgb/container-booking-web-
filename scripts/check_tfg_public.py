"""Controllo diagnostico di sole pagine pubbliche TFG, senza booking reali.

Non invia dati personali, non prova login, non esegue POST e non aggira
alcuna misura di accesso. Mostra solo esito HTTP e metadati dei moduli.
"""
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import re

URLS = {
    "Controllo booking": "https://tfg.bucci.it/@/TFGW_WW_BKK",
    "Programma navi": "https://tfg.bucci.it/@/TFGW_TP_ETA",
}

for label, url in URLS.items():
    print(f"\n=== {label} ===", flush=True)
    request = Request(url, headers={
        "User-Agent": "ContainerBookingWeb-CompatibilityTest/0.9 (public pages, no bookings)",
        "Accept": "text/html",
    })
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read(700_000).decode("utf-8", errors="replace")
            print(f"HTTP {response.status}, bytes {len(body)}, tipo {response.headers.get('content-type')}", flush=True)
            print(f"Form HTML: {len(re.findall(r'<form\\b', body, flags=re.I))}", flush=True)
            print(f"Tabelle HTML: {len(re.findall(r'<table\\b', body, flags=re.I))}", flush=True)
            # Non stampare valori di input o cookie.
            names = sorted(set(re.findall(r'<input[^>]*\\bname\\s*=\\s*[\\x22\\x27]([A-Za-z0-9_-]{1,50})',body,flags=re.I)))
            print(f"Campi input identificati: {names[:30]}", flush=True)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        print(f"Accesso automatico non disponibile: {type(exc).__name__}: {str(exc)[:150]}", flush=True)
