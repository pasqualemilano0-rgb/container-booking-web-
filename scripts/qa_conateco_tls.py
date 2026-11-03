"""Read-only TLS diagnosis of public CONATECO. No bypass."""
import subprocess
import re

for host in ("www.conateco.it","conateco.it"):
    print("\n=== TLS "+host+" ===",flush=True)
    p=subprocess.run(
        ["openssl","s_client","-connect",host+":443","-servername",host,"-showcerts"],
        input="",capture_output=True,text=True,timeout=20)
    result=p.stdout+"\n"+p.stderr
    for line in result.splitlines():
        if re.search(r"subject=|issuer=|Verify return code:|verify error|Certificate chain|depth=|CONNECTED",line,re.I):
            print(line[:200],flush=True)
    cert=re.search(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",result,re.S)
    if not cert:
        print("No cert returned",flush=True)
        continue
    import tempfile,pathlib
    with tempfile.TemporaryDirectory() as td:
        path=pathlib.Path(td)/"leaf.pem"
        path.write_text(cert.group(0),encoding="ascii")
        q=subprocess.run(["openssl","x509","-in",str(path),"-noout","-subject","-issuer","-dates","-ext","authorityInfoAccess","-ext","subjectAltName"],capture_output=True,text=True)
        print(q.stdout[:1500],flush=True)
