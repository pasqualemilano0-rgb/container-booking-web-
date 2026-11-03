"""Inspect exactly the four public BerthForecast requests used by the site."""
from scripts.conateco_api_https import verified_conateco_api_session,FORECAST_URL
from urllib.parse import urlparse

def describe(data,kind):
  print(kind,"response type",type(data).__name__,flush=True)
  if isinstance(data,list):
    print(kind,"rows",len(data),flush=True)
    for i,item in enumerate(data[:2]):
      if isinstance(item,dict):
        print(kind,"row",i,"keys",sorted(item.keys())[:100],flush=True)
        print(kind,"sample",i,[(str(k),str(v)[:75]) for k,v in item.items()][:34],flush=True)
      else:print(kind,"item type",type(item).__name__,flush=True)
  elif isinstance(data,dict):
    print(kind,"keys",sorted(data.keys())[:80],flush=True)
    for name,val in data.items():
      if isinstance(val,list):
        print(kind,"list under",name,"count",len(val),flush=True)
        if val and isinstance(val[0],dict):
          print(kind,"row keys",sorted(val[0].keys())[:110],flush=True)
          print(kind,"first row",[(str(k),str(v)[:90]) for k,v in val[0].items()][:36],flush=True)

with verified_conateco_api_session() as session:
  for state in ("PRESENTI","PREVISTE","ORMEGGIATE","PARTITE"):
    resp=session.get(FORECAST_URL,params={"stato":state},timeout=20,allow_redirects=False)
    print("\nSTATE",state,"HTTP",resp.status_code,"type",resp.headers.get("Content-Type"),"bytes",len(resp.content),flush=True)
    if urlparse(resp.url).hostname!="api.conateco.it":raise RuntimeError("API redirect mismatch")
    resp.raise_for_status()
    describe(resp.json(),state)
