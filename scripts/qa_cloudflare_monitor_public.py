"""External HTTPS smoke check of the deployed production Cloudflare monitor.
Never posts or sends actual booking IDs; logs only source/age/count/status.
"""
import requests
from datetime import datetime,timezone
BASE="https://container-booking-backend.pasqualemilano0.workers.dev"
ORIGIN="https://pasqualemilano0-rgb.github.io"

def main():
    monitor=None
    for route in ("/api/health","/api/monitor/status","/api/cnt","/api/tfg/snapshot","/api/sct"):
        resp=requests.get(BASE+route,headers={"Origin":ORIGIN,"Accept":"application/json",
                          "User-Agent":"ContainerBookingMonitorQA/1.0"},
                          timeout=25,allow_redirects=False)
        print(route,"HTTP",resp.status_code,"bytes",len(resp.content),
              "CORS",resp.headers.get("Access-Control-Allow-Origin"),flush=True)
        if resp.status_code!=200:raise RuntimeError(route+" unavailable")
        if resp.headers.get("Access-Control-Allow-Origin")!=ORIGIN:
            raise RuntimeError("Unexpected CORS for "+route)
        data=resp.json()
        if route=="/api/health":
            assert data["monitor_configured"] is True,data
        elif route=="/api/monitor/status":
            assert set(data["terminals"])=={"cnt","tfg","sct"}
            assert data["schedule"]=="*/15 * * * *",data
            monitor=data["terminals"]
            now=datetime.now(timezone.utc)
            for terminal,status in monitor.items():
                assert status["state"] in {"ok","fallback","stale"},(terminal,status)
                assert status["rows"]>0 and status.get("last_success_at"),(terminal,status)
                attempt=datetime.fromisoformat(status["last_attempt_at"].replace("Z","+00:00"))
                assert attempt.tzinfo is not None
                age=(now-attempt).total_seconds()
                assert -300<=age<=45*60,(terminal,"cron attempt not recent",status)
            print("Monitor states:",{
                k:{"state":v["state"],"last_attempt_at":v["last_attempt_at"],
                   "rows":v["rows"],"last_error_code":v["last_error_code"]}
                for k,v in data["terminals"].items()
            },flush=True)
        else:
            assert isinstance(data.get("rows"),list) and data["rows"]
            assert data.get("live") is False
            assert data.get("booking_verified") is False
            assert monitor is not None
            assert data.get("mode") in {"cloudflare_scheduled","github_verified_fallback"},data.get("mode")
            print("  mode",data.get("mode"),"rows",len(data["rows"]),
                  "acquired_at",data.get("acquired_at"),
                  "source_updated_at",data.get("source_updated_at"),flush=True)
    for route in ("/api/cnt?booking=SYNTHETIC",):
        r=requests.get(BASE+route,timeout=15)
        assert r.status_code==400,r.status_code
    print("PASS Cloudflare production HTTPS, cron attempts and all 3 archived terminal snapshots",flush=True)

if __name__=="__main__":main()
