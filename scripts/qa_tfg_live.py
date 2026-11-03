"""Print public TFG schedule HTML structure, never any booking data."""
from bs4 import BeautifulSoup
from scripts.tfg_verified_https import fetch_verified_tfg_html
from scripts.fetch_tfg_schedule import parse_tfg_html

html=fetch_verified_tfg_html()
soup=BeautifulSoup(html,"html.parser")
print("TFG public HTML acquired:",len(html),"characters")
print("Page title:",soup.title.get_text(" ",strip=True)[:120] if soup.title else "(not found)")
trs=soup.select("tr")
print("Table rows:",len(trs))
for i,tr in enumerate(trs[:5]):
    cells=tr.find_all(["th","td"],recursive=False)
    print("  row",i,"cells",len(cells),"types", [cell.name for cell in cells[:8]])
    print("  values", [cell.get_text(" ",strip=True)[:70] for cell in cells[:25]])
data=parse_tfg_html(html)
print("Parser SUCCESS:",len(data["rows"]),"navi;",data["source_updated_at"])
