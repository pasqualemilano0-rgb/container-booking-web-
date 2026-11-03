"""Verifica anonima dell'API pubblica TFG e di CORS.
Usa soltanto il backend Cloudflare pubblico, senza sessioni o credenziali.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError

API = "https://container-booking-backend.pasqualemilano0.workers.dev/api/tfg"
ORIGIN = "https://pasqualemilano0-rgb.github.io"
SOURCE = "https://tfg.bucci.it/@/TFGW_TP_ETA"


def request(method="GET", origin=ORIGIN):
    req = Request(
        API, method=method,
        headers={"Origin": origin, "User-Agent": "ContainerBookingQA/1.0"}
    )
    with urlopen(req, timeout=35) as response:
        data = response.read(2_000_000)
        return response.status, response.headers, data


def main():
    status, headers, raw = request()
    assert status == 200, f"Expected HTTP 200, got {status}"
    assert headers.get("Content-Type", "").startswith("application/json"), "JSON Content-Type"
    assert headers.get("Access-Control-Allow-Origin") == ORIGIN, "CORS for GitHub Pages missing"
    assert "no-store" in headers.get("Cache-Control", ""), "Sensitive freshness policy missing"
    assert headers.get("X-Content-Type-Options") == "nosniff", "Content type hardening missing"

    data = json.loads(raw)
    assert data.get("source") == SOURCE, "Unexpected TFG source"
    assert data.get("live") is True, "Public endpoint is not a direct read"
    assert data.get("booking_verified") is False, "Vessel schedule must not certify booking"
    rows = data.get("rows")
    assert isinstance(rows, list) and 0 < len(rows) < 500, "Unexpected/empty fleet"
    for row in rows:
        assert isinstance(row, dict) and isinstance(row.get("vessel"), str), "Invalid vessel"
        assert "fast_corridor_cut_off" in row and "custom_close_time" in row, "Old parser version"
        assert row.get("gate_cut_off") in ("", None), "A general cut-off must not be invented"

    acquired = datetime.fromisoformat(data["acquired_at"])
    source_time = datetime.fromisoformat(data["source_updated_at"])
    now = datetime.now(timezone.utc)
    assert acquired.tzinfo is not None and abs((now - acquired).total_seconds()) < 180, "Not freshly acquired"
    assert source_time.tzinfo is not None and source_time <= now + timedelta(minutes=5), "Invalid terminal update"
    # The terminal may publish an older update time; never infer a booking confirmation from it.

    status, headers, _ = request("OPTIONS")
    assert status == 204, f"CORS preflight failed: {status}"
    assert headers.get("Access-Control-Allow-Origin") == ORIGIN
    assert "GET" in headers.get("Access-Control-Allow-Methods", "")

    # Wrong origins may GET public data, but must never have permission to
    # read the JSON from browser JavaScript.
    status, headers, _ = request("GET", "https://unauthorized.example")
    assert status == 200
    assert not headers.get("Access-Control-Allow-Origin"), "CORS grants unexpected origin"

    print(f"PASS: anonymous Cloudflare TFG API, CORS, timestamps, {len(rows)} vessels")
    print("Latest source update:", source_time.isoformat())


if __name__ == "__main__":
    main()
