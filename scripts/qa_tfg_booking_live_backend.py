"""Production smoke test: one synthetic nonexistent TFG booking, no customer data."""
import json
import requests

URL="https://container-booking-backend.pasqualemilano0.workers.dev/api/tfg_booking"
ORIGIN="https://pasqualemilano0-rgb.github.io"
SOURCE="https://tfg.bucci.it/@/TFGW_WW_BKK"
FAKE="EBKG00000000"

def main():
    headers={"Origin":ORIGIN,"Accept":"application/json","Content-Type":"application/json",
             "User-Agent":"ContainerBookingProductionSmoke/1.0"}
    pre=requests.options(URL,headers={
        "Origin":ORIGIN,"Access-Control-Request-Method":"POST",
        "Access-Control-Request-Headers":"content-type"},timeout=25,allow_redirects=False)
    print("Preflight",pre.status_code,
          "CORS",pre.headers.get("Access-Control-Allow-Origin"),
          "methods",pre.headers.get("Access-Control-Allow-Methods"))
    assert pre.status_code==204
    assert pre.headers.get("Access-Control-Allow-Origin")==ORIGIN
    assert "POST" in pre.headers.get("Access-Control-Allow-Methods","")
    resp=requests.post(URL,headers=headers,json={"booking":FAKE},
                       timeout=60,allow_redirects=False)
    print("Lookup HTTP",resp.status_code,
          "content-type",resp.headers.get("Content-Type",""),
          "CORS",resp.headers.get("Access-Control-Allow-Origin"),
          "cache",resp.headers.get("Cache-Control"),
          "body_bytes",len(resp.content))
    data=resp.json()
    print("Status",data.get("status"),"keys",sorted(data.keys()))
    assert resp.status_code==200, "Production backend did not return a valid response"
    assert resp.headers.get("Access-Control-Allow-Origin")==ORIGIN
    assert "no-store" in resp.headers.get("Cache-Control","")
    assert data.get("status")=="not_found", "Synthetic nonexistent booking must not be confirmed"
    assert data.get("booking_authorized") is False
    assert data.get("source")==SOURCE
    assert "vessel" not in data
    assert FAKE not in resp.text, "Do not echo or expose booking"
    print("PASS: Cloudflare TFG production form POST, validated TLS, no fake acceptance")
if __name__=="__main__":
    main()
