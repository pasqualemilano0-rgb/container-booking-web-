"""SCT public vessel schedule diagnostic. No login, no booking, no mutations."""
import re
from datetime import datetime,timezone
import requests
from bs4 import BeautifulSoup
from scripts.fetch_sct import URL,extract_rows

for page in ("https://www.salernocontainerterminal.com/vessel-schedule/",URL):
    print("=== SCT PUBLIC ===",page,flush=True)
    try:
        response=requests.get(page,timeout=25,headers={
            "User-Agent":"ContainerBookingWeb-SCT-QA/1.0 (public vessel schedule)",
            "Accept":"text/html",
        })
        print("HTTP:",response.status_code,"URL:",response.url,"bytes:",len(response.content),flush=True)
        print("Headers:",{k:response.headers.get(k) for k in ("Content-Type","Date","Last-Modified","Cache-Control","ETag","Age")},flush=True)
        response.raise_for_status()
        soup=BeautifulSoup(response.text,"html.parser")
        print("Title:",soup.title.get_text(" ",strip=True)[:100] if soup.title else "(none)",flush=True)
        print("Embeds:",[x.get("src") for x in soup.select("iframe")][:8],flush=True)
        print("Tables:",len(soup.select("table")),flush=True)
        for table in soup.select("table")[:4]:
            headers=[c.get_text(" ",strip=True)[:50] for c in table.select("th")]
            print("Header:",headers[:25],flush=True)
            samples=[]
            for tr in table.select("tr")[:5]:
                cs=tr.find_all("td",recursive=False)
                if cs:samples.append([td.get_text(" ",strip=True)[:50] for td in cs])
            print("Sample rows:",samples[:2],flush=True)
        print("Date/update text:",re.findall(r"(?:Last updated|Aggiornat[oa]|Update(?:d)?\s*(?:on|at)?)[:\s\w]{0,80}",soup.get_text(" ",strip=True),re.I)[:8],flush=True)
        rows=extract_rows(response.text)
        print("Parsed voyages:",len(rows),flush=True)
        print("First 4 parsed:",[{k:v for k,v in row.items() if k in ('vessel','voyage','eta','closing','status','acceptance_dry','acceptance_reef')} for row in rows[:4]],flush=True)
        print("Sample statuses:",sorted(set(r["status"] for r in rows)),flush=True)
        print("Sample dry:",sorted(set(r["acceptance_dry"] for r in rows)),flush=True)
        print("Sample reefer:",sorted(set(r["acceptance_reef"] for r in rows)),flush=True)
    except (requests.RequestException,ValueError) as e:
        print("Fetch unavailable:",type(e).__name__,str(e)[:250],flush=True)
