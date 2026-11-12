import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CRON,SPECS,parseCntCategories,parseSctTableRows,readSchedule,getMonitorStatus,
 refreshTerminal,refreshAll,fetchPublicSnapshot
} from '../cloudflare/monitor.mjs';
import {handleRequest} from '../cloudflare/index.mjs';

class FakeKV{
 constructor(){this.store=new Map();this.writes=[];}
 async get(k,type){const data=this.store.get(k);return type==='json'&&data?JSON.parse(data):data??null;}
 async put(k,data){this.writes.push(k);this.store.set(k,String(data));}
}
const now=new Date('2026-11-01T09:30:00Z');
const cntItem=(name,category='PREVISTE')=>({
 nome_nave:name,viaggioimbarco:'QA12',data_previ:'2026-11-04',
 ora_previs:'09:30',cod_stato:category==='PARTITE'?'CHI':'PRE',
 accettaCarico:'1',iconaStatoNave:'ACCETTA_CARICO',
 stopcarico:'',accettazioneesterni:'S',tdtac1:'2026-11-01',
 torac1:'08:00',tdtcd1:'2026-11-03',torcd1:'17:00',id_viaggio:name
});
function categories(){
 return {PRESENTI:[cntItem('MSC ARRIVED')],
  PREVISTE:[cntItem('MSC GRETA'),cntItem('MSC SARA')],
  ORMEGGIATE:[],PARTITE:[cntItem('MSC DEPARTED','PARTITE')]};
}
const sctHeaders=['DATE','E.T.A.','VESSEL','VOYAGE','CLOSING TIME','STATUS','ACCEPTANCE DRY','ACCEPTANCE REEF'];
const sctRows=[
 {headers:sctHeaders,cells:[]},
 {headers:[],cells:['05/11/2026','14:00','MSC SCT TEST','QA03','05/11/2026 10:00','PENDING','CARGO ACCEPTED','NOT ACCEPTED']},
 {headers:[],cells:['06/11/2026','15:15','MSC SCT SECOND','QA04','06/11/2026 12:00','PENDING','NOT ACCEPTED','CARGO ACCEPTED']}
];
const tfgParsed={source:SPECS.tfg.source,acquired_at:now.toISOString(),
 source_updated_at:'2026-11-01T09:10:00Z',rows:[
  {vessel:'MSC TFG',departure_voyage:'QA01',eta:'02/11/26 10:00',destination:'DRYPORT'},
  {vessel:'MSC TFG SECOND',departure_voyage:'QA02',eta:'03/11/26 10:00',destination:'INTERNO PORTO'}
 ],live:true,booking_verified:false};
const officialFetcher=async url=>{
 if(url.startsWith(SPECS.cnt.source)){
  const cat=new URL(url).searchParams.get('stato');
  return new Response(JSON.stringify(categories()[cat]),{
   status:200,headers:{'Content-Type':'application/json'}});
 }
 return new Response('<html><table><tr><th>HEADER</th></tr></table></html>',{
  status:200,headers:{'Content-Type':'text/html'}});
};
const deps={fetcher:officialFetcher,parseTfg:async()=>tfgParsed,
 parseSct:async()=>parseSctTableRows(sctRows,now)};

test('cron every 15 min and three exact official URLs',()=>{
 assert.equal(CRON,'*/15 * * * *');
 assert.equal(Object.keys(SPECS).join(','),'cnt,tfg,sct');
 for(const obj of Object.values(SPECS))assert.ok(obj.source.startsWith('https://'));
});
test('CNT parses official 4 categories without guessing booking acceptance',()=>{
 const data=parseCntCategories(categories(),now);
 assert.equal(data.rows.length,4);
 assert.equal(data.rows[0].source_conflict,false);
 assert.equal(data.source,SPECS.cnt.source);
 assert.equal(data.source_updated_at,null);
 assert.equal(data.acquired_at,now.toISOString());
 const r=data.rows.find(x=>x.vessel==='MSC GRETA');
 assert.equal(r.external_depot,'S');
 assert.equal(r.opening,'2026-11-01 08:00');
 assert.equal('booking_verified' in r,false);
 assert.throws(()=>parseCntCategories({...categories(),PARTITE:{ReturnCode:-1}},now));
 assert.throws(()=>parseCntCategories({PRESENTI:[],PREVISTE:[],ORMEGGIATE:[],PARTITE:[]},now));
});
test('SCT strict headers, separate DRY/Reefer, retain missing update timestamp',()=>{
 const data=parseSctTableRows(sctRows,now);
 assert.equal(data.rows.length,2);
 assert.equal(data.rows[0].acceptance_dry,'CARGO ACCEPTED');
 assert.equal(data.rows[0].acceptance_reef,'NOT ACCEPTED');
 assert.equal(data.source_updated_at,null);
 assert.equal(data.rows[1].voyage,'QA04');
 assert.throws(()=>parseSctTableRows([
 {headers:['DATE','VESSEL','VOYAGE'],cells:[]},
 ...sctRows.slice(1)
 ],now));
});
test('SCT real table: use final DRY/REEF headers after STATUS, not earlier pair',()=>{
  // The official iframe can contain two acceptance pairs. The first one,
  // before STATUS, is not the operative pair (same contract as fetch_sct.py).
  const headers=['DATE','E.T.A.','VESSEL','VOYAGE','TRADE','CLOSING TIME',
    '','','ACTIONS','ACCEPTANCE DRY','ACCEPTANCE REEF','STATUS',
    'ACCEPTANCE DRY','ACCEPTANCE REEF'];
  const prefix=['05/11/2026','14:00','MSC SCT TEST','QA03','MSC',
    '05/11/2026 10:00','','',''];
  const rows=[
    {headers,cells:[]},
    {headers:[],cells:[...prefix,'CARGO ACCEPTED','CARGO ACCEPTED',
      'PENDING','NOT ACCEPTED','CARGO ACCEPTED']},
    {headers:[],cells:['06/11/2026','15:15','MSC SCT SECOND','QA04','MSC',
      '06/11/2026 12:00','','','',
      'NOT ACCEPTED','NOT ACCEPTED','PENDING','CARGO ACCEPTED','NOT ACCEPTED']}
  ];
  const parsed=parseSctTableRows(rows,now);
  assert.equal(parsed.rows.length,2);
  assert.equal(parsed.rows[0].acceptance_dry,'NOT ACCEPTED');
  assert.equal(parsed.rows[0].acceptance_reef,'CARGO ACCEPTED');
  assert.equal(parsed.rows[0].status,'PENDING');
  assert.equal(parsed.rows[1].acceptance_dry,'CARGO ACCEPTED');
  assert.equal(parsed.rows[1].acceptance_reef,'NOT ACCEPTED');
  const refeer=rows.map((row,i)=>i?row:{
    ...row,headers:[...headers.slice(0,-1),'ACCEPTANCE REEFER']});
  assert.equal(parseSctTableRows(refeer,now).rows[0].acceptance_reef,'CARGO ACCEPTED');
  const beforeStatusOnly=rows.map((row,i)=>i?row:{
    ...row,headers:headers.slice(0,-2)});
  assert.throws(()=>parseSctTableRows(beforeStatusOnly,now),
    /SCT_NO_VALID_ROWS/,'Never guess an acceptance column before STATUS');
});
test('cron refresh writes three independent verified public schedules to KV',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 const states=await refreshAll(env,deps,now);
 assert.equal(states.length,3);
 assert.ok(states.every(x=>x.last_success_at===now.toISOString()));
 for(const t of Object.keys(SPECS)){
  const value=await readSchedule(env,t,now);
  assert.ok(value?.rows?.length>=2,t);
  assert.equal(value.live,false,'A scheduled copy is not live booking authorization');
  assert.equal(value.mode,'cloudflare_scheduled');
  assert.equal(value.booking_verified,false);
 }
 const status=await getMonitorStatus(env,now);
 assert.equal(status.terminals.cnt.state,'ok');
 assert.equal(status.terminals.sct.state,'ok');
 assert.equal(status.terminals.tfg.state,'ok');
 // Each of CNT/TFG/SCT writes a verified backup, current schedule and status.
 const writes=env.SCHEDULES_KV.writes;
 assert.equal(writes.length,9);
 assert.equal(new Set(writes).size,9,'Do not overwrite distinct KV recovery keys');
 for(const terminal of Object.keys(SPECS)){
  assert.ok(writes.includes('schedule:'+terminal),terminal+' schedule missing');
  assert.ok(writes.includes('status:'+terminal),terminal+' status missing');
  assert.equal(writes.filter(k=>k.startsWith('backup:v1:'+terminal+':')).length,1,
    terminal+' must archive exactly one verified recovery point');
 }
});
test('any source HTTP failure preserves last good snapshot and reports the error',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 await refreshAll(env,deps,now);
 const old=await env.SCHEDULES_KV.get('schedule:cnt','json');
 const failed=await refreshTerminal(env,'cnt',{
  fetcher:async()=>new Response('<html>503</html>',{
    status:503,headers:{'Content-Type':'text/html'}})
 },new Date(now.getTime()+15*60000));
 assert.equal(failed.state,'error');
 assert.equal(failed.last_success_at,now.toISOString());
 assert.deepEqual(await env.SCHEDULES_KV.get('schedule:cnt','json'),old);
 const status=await getMonitorStatus(env,new Date(now.getTime()+15*60000));
 assert.equal(status.terminals.cnt.state,'error');
 assert.equal(status.terminals.tfg.state,'ok');
});
test('TFG fonte invariata da giorni ma acquisita ora: stato OK, date originali intatte',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 const oldSource='2026-10-25T09:10:00Z';
 await refreshAll(env,{...deps,parseTfg:async()=>({
  ...tfgParsed,source_updated_at:oldSource})},now);
 const status=await getMonitorStatus(env,now);
 const saved=await readSchedule(env,'tfg',now);
 assert.equal(status.terminals.tfg.state,'ok');
 assert.equal(saved.stale,false);
 assert.equal(saved.source_updated_at,oldSource);
 assert.equal(saved.acquired_at,now.toISOString());
 assert.equal(saved.live,false,'Scheduled copy remains only a snapshot');
 assert.equal(saved.booking_verified,false);
});
test('monitor routes expose no booking ids, no POST and only declared CORS origin',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 // Endpoint uses the actual clock; do not predate the test fixture into the future.
 await refreshAll(env,{...deps,parseTfg:async()=>({
   ...tfgParsed,source_updated_at:new Date(Date.now()-20*60000).toISOString()
 })},new Date());
 const origin='https://pasqualemilano0-rgb.github.io';
 const endpoint='https://worker.example';
 const r=await handleRequest(new Request(endpoint+'/api/cnt',{headers:{Origin:origin}}),{env});
 assert.equal(r.status,200);
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await r.json()).mode,'cloudflare_scheduled');
 const health=await handleRequest(new Request(endpoint+'/api/monitor/status',{headers:{Origin:origin}}),{env});
 assert.equal(health.status,200);
 const status=await health.json();
 assert.equal(status.schedule,CRON);
 assert.equal(Object.keys(status.terminals).length,3);
 assert.equal((await handleRequest(new Request(endpoint+'/api/monitor/status?booking=ABC'),{env})).status,400);
 assert.equal((await handleRequest(new Request(endpoint+'/api/monitor/status',{method:'POST'}),{env})).status,405);
});

test('Workers runtime fetch never uses unsupported RequestInit.cache',async()=>{
 const calls=[];
 const strict=async (url,options)=>{
  assert.equal('cache' in options,false,'Cloudflare RequestInit.cache is not implemented');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'manual');
  assert.equal(options.credentials,'omit');
  calls.push(url);
  return officialFetcher(url,options);
 };
 const result=await refreshTerminal({SCHEDULES_KV:new FakeKV()},'cnt',
    {...deps,fetcher:strict},new Date());
 assert.equal(result.state,'ok');
 assert.equal(calls.length,4);
});

test('SCT 403 at source: adopt verified GitHub snapshot with its ORIGINAL acquired timestamp',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 const acquired=new Date(now.getTime()-7*60000).toISOString();
 const officialSnapshot={
   source:SPECS.sct.source,acquired_at:acquired,updated_at:acquired,
   source_updated_at:null,data_changed_at:new Date(now.getTime()-3600000).toISOString(),
   rows:parseSctTableRows(sctRows,now).rows
 };
 const fetcher=async url=>{
   if(url==='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/sct.json')
     return new Response(JSON.stringify(officialSnapshot),{
       status:200,headers:{'Content-Type':'application/json'}});
   return new Response('Access Denied',{status:403,
     headers:{'Content-Type':'text/html'}});
 };
 const state=await refreshTerminal(env,'sct',{fetcher},now);
 assert.equal(state.state,'fallback');
 assert.equal(state.last_error_code,'SOURCE_HTTP');
 const saved=await readSchedule(env,'sct',now);
 assert.equal(saved.mode,'github_verified_fallback');
 assert.equal(saved.monitor_origin,'github_verified_fallback');
 assert.equal(saved.acquired_at,acquired,'Do not replace GitHub timestamp with Cloudflare time');
 assert.equal(saved.live,false);
 assert.equal(saved.booking_verified,false);
 assert.equal(saved.rows.length,2);
 const status=(await getMonitorStatus(env,now)).terminals.sct;
 assert.equal(status.state,'fallback');
 assert.equal(status.last_acquired_at,acquired);
});
test('SCT 403 + GitHub fallback unavailable: preserve last good data, report error',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 await refreshTerminal(env,'sct',deps,now);
 const saved=await env.SCHEDULES_KV.get('schedule:sct','json');
 const blocked=async()=>new Response('blocked',{
  status:403,headers:{'Content-Type':'text/html'}});
 const later=new Date(now.getTime()+15*60000);
 const status=await refreshTerminal(env,'sct',{fetcher:blocked},later);
 assert.equal(status.state,'error');
 assert.equal(status.last_success_at,now.toISOString());
 assert.deepEqual(await env.SCHEDULES_KV.get('schedule:sct','json'),saved);
});
test('Reject invalid or future GitHub fallback timestamp, source, or empty voyages',async()=>{
 const acquired=new Date(now.getTime()-3*60000).toISOString();
 const valid={source:SPECS.sct.source,acquired_at:acquired,
    rows:parseSctTableRows(sctRows,now).rows};
 const uri='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/sct.json';
 for(const invalid of [
  {...valid,source:'https://malicious.example'},
  {...valid,acquired_at:new Date(now.getTime()+900000).toISOString()},
  {...valid,rows:[]}
 ]){
   await assert.rejects(fetchPublicSnapshot('sct',
    async url=>{assert.equal(url,uri);return new Response(JSON.stringify(invalid),
       {status:200,headers:{'Content-Type':'application/json'}});},now));
 }
 const proper=await fetchPublicSnapshot('sct',async()=>new Response(JSON.stringify(valid),
       {status:200,headers:{'Content-Type':'application/json'}}),now);
 assert.equal(proper.acquired_at,acquired);
 assert.equal(proper.monitor_origin,'github_verified_fallback');
});
test('Older verified GitHub snapshot never replaces newer KV data',async()=>{
 const env={SCHEDULES_KV:new FakeKV()};
 await refreshTerminal(env,'sct',deps,now);
 const saved=await env.SCHEDULES_KV.get('schedule:sct','json');
 const old={...saved,acquired_at:new Date(now.getTime()-45*60000).toISOString()};
 const fetcher=async url=>url.includes('raw.githubusercontent.com')
   ?new Response(JSON.stringify(old),{status:200,headers:{'Content-Type':'application/json'}})
   :new Response('Forbidden',{status:403,headers:{'Content-Type':'text/html'}});
 const result=await refreshTerminal(env,'sct',{fetcher},new Date(now.getTime()+15*60000));
 assert.equal(result.state,'fallback');
 assert.deepEqual(await env.SCHEDULES_KV.get('schedule:sct','json'),saved);
});
