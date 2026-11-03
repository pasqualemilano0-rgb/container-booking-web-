"""Read-only TFG booking form inspection.
Do NOT submit booking numbers, bypass authentication or assume API support.
TLS certificate and hostname verification are mandatory.
"""
import re
import requests
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from scripts.tfg_verified_https import (
    TFG_HOST,_get_remote_leaf,_fetch_intermediate,_system_ca_file,
    INTERMEDIATES
)
import subprocess
URL="https://tfg.bucci.it/@/TFGW_WW_BKK"
HEADERS={"User-Agent":"ContainerBooking-FormReadOnly/1.0","Accept":"text/html"}

def read():
    try:
        return requests.get(URL,headers=HEADERS,timeout=22,allow_redirects=False)
    except requests.exceptions.SSLError:
        pass
    with TemporaryDirectory(prefix="tfg-form-verified-") as temp:
        p=Path(temp)
        chain="\n".join(_fetch_intermediate(x) for x in INTERMEDIATES)+"\n"
        (p/"untrusted.pem").write_text(chain)
        (p/"leaf.pem").write_text(_get_remote_leaf())
        root=_system_ca_file()
        proc=subprocess.run(["openssl","verify","-purpose","sslserver",
           "-verify_hostname",TFG_HOST,"-CAfile",str(root),
           "-untrusted",str(p/"untrusted.pem"),str(p/"leaf.pem")],
           capture_output=True,text=True,timeout=15)
        if proc.returncode:raise RuntimeError("TFG TLS validation failed")
        bundle=p/"bundle.pem";bundle.write_bytes(root.read_bytes()+b"\n"+chain.encode())
        return requests.get(URL,headers=HEADERS,timeout=22,verify=str(bundle),allow_redirects=False)

def main():
    r=read()
    print("TFG booking form HTTP",r.status_code,"content-type",r.headers.get("Content-Type",""))
    print("Bytes",len(r.content),"redirect_location",(r.headers.get("Location") or "")[:160])
    if len(r.content)>500000:raise RuntimeError("Unexpectedly large form")
    if r.status_code!=200:return
    soup=BeautifulSoup(r.text,"html.parser")
    print("Title:",soup.title.get_text(" ",strip=True)[:140] if soup.title else "(none)")
    for f in soup.select("form")[:12]:
        print("FORM method",f.get("method","GET"),
              "action",(f.get("action") or "")[:180],
              "input names",[(x.get("name") or x.get("id") or "")[:65] for x in f.select("input")][:25])
    print("Form count",len(soup.select("form")),"script paths",
          [x.get("src") for x in soup.select("script[src]")][:30])
    for s in soup.select("script:not([src])"):
        text=s.get_text()
        for line in text.splitlines():
            if re.search(r"booking|ajax|fetch\(|post\(|xmlhttprequest",line,re.I):
                line=line.strip()[:190]
                if re.search(r"password|token|secret|auth|cookie|credentials",line,re.I):continue
                print("JS form hint",line)
    print("Textarea count",len(soup.select("textarea")))

    for inp in soup.select("form input")[:12]:
        name=inp.get("name") or ""
        typ=inp.get("type") or "text"
        val=inp.get("value") or ""
        print("Input:",name[:50],typ[:25],
              "value",val[:60] if name=="modo" else ("(not printed)" if val else "(empty)"))
    print("Cookie names:",list(r.cookies.keys()))
    # A single fictitious query, no credentials, no brute-force or access bypass.
    forms=soup.select("form")
    if len(forms)!=1:return
    form=forms[0]
    if (form.get("method","get").lower()!="post" or
        (form.get("action") or "").strip()!="/@/TFGW_WW_BKK"):
        print("Synthetic POST skipped: unexpected form schema");return
    fields={i.get("name"):i.get("value","") for i in form.select("input[name]") if i.get("name")}
    if set(fields)!={"modo","bkk"}:
        print("Synthetic POST skipped: unexpected input fields",sorted(fields));return
    fields["bkk"]="EBKG00000000"
    print("Sending ONE fictional TFG booking, only form fields",sorted(fields))
    def do_post(verify=True):
        return requests.post(URL,headers=HEADERS,data=fields,cookies=r.cookies,timeout=22,
                             allow_redirects=False,verify=verify)
    try:
        posted=do_post()
    except requests.exceptions.SSLError:
        with TemporaryDirectory(prefix="tfg-form-post-") as temp:
            p=Path(temp);chain="\n".join(_fetch_intermediate(x) for x in INTERMEDIATES)+"\n"
            (p/"untrusted.pem").write_text(chain)
            (p/"leaf.pem").write_text(_get_remote_leaf())
            root=_system_ca_file()
            proc=subprocess.run(["openssl","verify","-purpose","sslserver",
                "-verify_hostname",TFG_HOST,"-CAfile",str(root),
                "-untrusted",str(p/"untrusted.pem"),str(p/"leaf.pem")],
                capture_output=True,text=True,timeout=15)
            if proc.returncode:raise RuntimeError("POST TLS invalid")
            bundle=p/"bundle.pem";bundle.write_bytes(root.read_bytes()+b"\n"+chain.encode())
            posted=do_post(str(bundle))
    print("Synthetic POST response HTTP",posted.status_code,
          "content-type",posted.headers.get("Content-Type",""),
          "bytes",len(posted.content),
          "location",(posted.headers.get("Location") or "")[:120])
    if posted.status_code==200 and len(posted.content)<100000:
        page=BeautifulSoup(posted.content,"html.parser")
        visible=page.get_text(" ",strip=True)
        print("Synthetic response title",page.title.get_text(" ",strip=True)[:100] if page.title else "")
        print("Contains vessel/voyage markers",bool(re.search(r"Voy(?:age|aggio)?|NAVE|M/V|ARMATORE",visible,re.I)))
        print("Contains no-result/error markers",bool(re.search(r"non trovato|non presente|inesistente|nessun|errore|not found",visible,re.I)))
        print("Tables",len(page.select("table")),"TR",len(page.select("tr")))
        safe_sample=visible[:650].replace("EBKG00000000","[booking sintetico]")
        print("Synthetic negative response text:",safe_sample)
        print("Synthetic response headings:",[x.get_text(" ",strip=True)[:95] for x in page.select("h1,h2,h3,strong")[:15]])


if __name__=="__main__":main()
