"""Inspect only public forecast JS and public booking page inline script."""
from bs4 import BeautifulSoup
from scripts.conateco_verified_https import get_public_conateco_html
import re

js=get_public_conateco_html("https://www.conateco.it/scripts/berth.js")
print("=== Public berth.js ===",len(js),"chars")
print(js[:26000])
booking=get_public_conateco_html("https://www.conateco.it/booking-export/")
soup=BeautifulSoup(booking,"html.parser")
for script in soup.select("script:not([src])"):
    code=script.get_text()
    if re.search("getDataContainer|axios|fetch|codicecontainer",code,re.I):
        print("=== Booking page inline JS ===",len(code),"chars")
        print(code[:14000])
