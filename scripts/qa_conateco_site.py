"""Read-only diagnosis of public CONATECO HTML; no booking submitted."""
from urllib.parse import urlparse
import re
from bs4 import BeautifulSoup
from scripts.conateco_verified_https import get_public_conateco_html

urls={
  "berth":"https://www.conateco.it/berth-forecast/",
  "booking-form":"https://www.conateco.it/booking-export/",
  "robots":"https://www.conateco.it/robots.txt"
}
for name,url in urls.items():
  print("\n=== CONATECO "+name+" ===",flush=True)
  try:
    html=get_public_conateco_html(url)
    print("HTTPS verified",url,"bytes",len(html),flush=True)
    if name=="robots":
      print(html[:1800],flush=True)
      continue
    s=BeautifulSoup(html,"html.parser")
    text=s.get_text(" ",strip=True)
    print("TEXT SAMPLE:",text[:3200],flush=True)
    print("TABLES",len(s.select("table")),"TR",len(s.select("tr")),flush=True)
    for i,t in enumerate(s.select("table")[:3]):
      print("TABLE",i, "HEADER",[c.get_text(" ",strip=True)[:75] for c in t.select("th")[:30]],flush=True)
      print("TABLE FIRST ROW",[c.get_text(" ",strip=True)[:75] for c in t.select("tr")[-1].find_all("td",recursive=False)[:22]] if t.select("tr") else [],flush=True)
    script_names=[x.get("src") for x in s.select("script[src]") if x.get("src")]
    print("SCRIPTS:",script_names[:35],flush=True)
    roots=[str(x)[:700] for x in s.select("[ng-app],[ng-controller],[ng-repeat], [data-ng-repeat], [v-for], [x-data], [id]") if re.search(r"booking|forecast|vessel|navi|berth|nave|booking-export",str(x),re.I)]
    print("APP MARKUP:",roots[:8],flush=True)
    print("ANGULAR TEMPLATE SNIPPETS:",[str(x)[:400] for x in s.find_all(string=re.compile(r"{{.*?(nave|eta|berth|accettazione).*?}}",re.I))[:5]],flush=True)
  except Exception as e:
    print("ERROR:",type(e).__name__,str(e)[:450],flush=True)
