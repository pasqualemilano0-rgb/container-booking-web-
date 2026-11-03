import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,parseUpdated,validateDocument,SOURCE} from '../cloudflare/parse_tfg.mjs';
import {handleRequest} from '../cloudflare/index.mjs';

const WEB='https://pasqualemilano0-rgb.github.io';
const tr=['31/10/26','14:00','','','ARGENTINIAN','0HWL8E1MA','','',
 '0HWL8E1MA','02/11/26 15:00:00','ACCETTA CARICO','30/10/26 11:00:00','INTERNO PORTO',''];
const header='ARR.VOY DEPT.VOY ACCETTA CARICO TERMINAL DI CONSEGNA Ultimo aggiornamento: 31/10/26 alle 12:40:26';
const req=(p,init={})=>new Request('https://worker.example'+p,init);

test('TFG normalizza orario Roma e controlla DST, date e intestazioni',()=>{
 assert.equal(parseUpdated(header),'2026-10-31T11:40:26.000Z');
 assert.equal(parseUpdated('Ultimo aggiornamento: 01/07/26 alle 12:40:26'),'2026-07-01T10:40:26.000Z');
 assert.throws(()=>parseUpdated('Ultimo aggiornamento: 31/02/26 alle 12:40:26'));
 assert.throws(()=>parseUpdated('Ultimo aggiornamento: 25/10/26 alle 02:30:00'));
 assert.throws(()=>validateDocument('missing',[tr]));
 const d=validateDocument(header,[tr],new Date('2026-10-31T12:00:00Z'));
 assert.equal(d.booking_verified,false);
 assert.equal(d.live,true);
 assert.equal(d.rows.length,1);
 assert.throws(()=>validateDocument(header,[tr],new Date('2026-10-31T09:00:00Z')));
});
test('TFG conserva Fast Corridor distinto da termine generale e rifiuta righe invalide',()=>{
 const row=parseRows([tr,tr])[0];
 assert.equal(row.vessel,'ARGENTINIAN');
 assert.equal(row.custom_close_time,'02/11/26 15:00:00');
 assert.equal(row.fast_corridor_cut_off,'30/10/26 11:00:00');
 assert.equal(row.gate_cut_off,'');
 assert.equal(parseRows([tr,tr]).length,1);
 assert.equal(parseRows([[...tr.slice(0,10),'STATO SCONOSCIUTO',...tr.slice(11)]])[0].acceptance,'');
 assert.throws(()=>parseRows([['bad']]));
});
test('health e CORS per la sola origine GitHub Pages',async()=>{
 const g=await handleRequest(req('/api/health',{headers:{Origin:WEB}}));
 assert.equal(g.status,200);
 assert.equal(g.headers.get('Access-Control-Allow-Origin'),WEB);
 const body=await g.json();
 assert.equal(body.backend,'cloudflare-workers');
 assert.equal(body.tfg_live_verified,false);
 assert.equal(body.booking_verified,false);
 const untrusted=await handleRequest(req('/api/health',{
  headers:{Origin:'https://untrusted-backend.example'}
 }));
 assert.equal(untrusted.headers.get('Access-Control-Allow-Origin'),null);
 const stranger=await handleRequest(req('/api/health',{headers:{Origin:'https://elsewhere.example'}}));
 assert.equal(stranger.headers.get('Access-Control-Allow-Origin'),null);
 const options=await handleRequest(req('/api/tfg',{method:'OPTIONS',headers:{Origin:WEB}}));
 assert.equal(options.status,204);
 assert.equal((await handleRequest(req('/api/tfg',{method:'OPTIONS',headers:{Origin:'https://bad.example'}}))).status,403);
});
test('non accetta booking nei parametri, POST o route dinamiche',async()=>{
 assert.equal((await handleRequest(req('/api/tfg?booking=PRIVATE'))).status,400);
 assert.equal((await handleRequest(req('/api/tfg',{method:'POST',body:'PRIVATE'}))).status,405);
 assert.equal((await handleRequest(req('/api/other'))).status,404);
});
test('TFG live delega solo a URL ufficiale e fallisce chiuso in caso TLS',async()=>{
 const seen=[];
 const fetcher=async(url,opts)=>{
  seen.push({url,redirect:opts.redirect});
  return new Response('<html>fixture</html>',{status:200});
 };
 const parseHtml=async()=>({
  source:SOURCE,live:true,booking_verified:false,
  acquired_at:new Date().toISOString(),source_updated_at:'2026-10-31T11:40:26Z',
  rows:parseRows([tr])
 });
 const ok=await handleRequest(req('/api/tfg',{headers:{Origin:WEB}}),{fetcher,parseHtml});
 assert.equal(ok.status,200);
 assert.equal((await ok.json()).booking_verified,false);
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,SOURCE);
 assert.equal(seen[0].redirect,'manual');
 const fail=await handleRequest(req('/api/tfg'),{fetcher:async()=>{throw Error('TLS chain invalid');}});
 assert.equal(fail.status,503);
 assert.equal((await fail.json()).live,false);
});
test('CNT SCT e TFG copie sono sempre etichettate come snapshot',async()=>{
 for(const [path,source,file] of [
  ['/api/cnt','https://api.conateco.it/ConatecoServicesApi/BerthForecast','conateco.json'],
  ['/api/sct','https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php','sct.json'],
  ['/api/tfg/snapshot',SOURCE,'tfg_schedule.json']
 ]){
  let requested='';
  const fetcher=async url=>{
   requested=url;
   return new Response(JSON.stringify({source,acquired_at:new Date().toISOString(),
    rows:[{vessel:'QA TEST'}]}),{status:200});
  };
  const result=await handleRequest(req(path),{fetcher});
  assert.equal(result.status,200);
  const data=await result.json();
  assert.ok(requested.endsWith('/data/'+file));
  assert.equal(data.live,false);
  assert.equal(data.mode,'periodic_snapshot');
  assert.equal(data.booking_verified,false);
 }
 const wrong=await handleRequest(req('/api/cnt'),{
  fetcher:async()=>new Response(JSON.stringify({source:'https://fake',
   acquired_at:new Date().toISOString(),rows:[{vessel:'X'}]}),{status:200})
 });
 assert.equal(wrong.status,503);
});

test('TFG accetta viaggio con ETA data presente ma ora mancante',()=>{
 const withoutTime=[...tr]; withoutTime[1]='';
 const rows=parseRows([withoutTime]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].eta,'31/10/26');
 assert.equal(rows[0].vessel,'ARGENTINIAN');
});

test('Cloudflare preserva DRYPORT e gli altri terminal pubblicati, non presume il deposito per booking',()=>{
 const dry=[...tr];dry[12]='DRYPORT';
 assert.equal(parseRows([dry])[0].destination,'DRYPORT');
 const drySpace=[...tr];drySpace[12]='DRY PORT';
 assert.equal(parseRows([drySpace])[0].destination,'DRYPORT');
 const other=[...tr];other[12]='EX SUD CONTAINER';
 assert.equal(parseRows([other])[0].destination,'EX SUD CONTAINER');
 const named=[...tr];named[12]='TERMINAL AREA B';
 assert.equal(parseRows([named])[0].destination,'TERMINAL AREA B');
 const unknown=[...tr];unknown[12]='LUOGO NON PUBBLICATO';
 assert.equal(parseRows([unknown])[0].destination,'');
 const injected=[...tr];injected[12]='<script>bad</script>';
 assert.equal(parseRows([injected])[0].destination,'');
});
