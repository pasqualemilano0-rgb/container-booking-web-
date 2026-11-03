import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../cloudflare/index.mjs';
import {protectTfgRequest,RATE_BINDINGS} from '../cloudflare/rate_limit.mjs';
import {readFileSync} from 'node:fs';

const WEB='https://pasqualemilano0-rgb.github.io';
const CODE='QA123456';
const booking=(headers={})=>new Request('https://worker.example/api/tfg_booking',{
 method:'POST',headers:{Origin:WEB,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.12',...headers},
 body:JSON.stringify({booking:CODE})
});
const direct=(headers={})=>new Request('https://worker.example/api/tfg',{
 headers:{Origin:WEB,'CF-Connecting-IP':'192.0.2.12',...headers}
});
function guardEnv(options={}){
 const calls=[];
 const binding=name=>({async limit({key}){
  calls.push({name,key});
  if(options.fail===name)throw Error('rate-limit runtime unavailable');
  return {success:options.deny!==name};
 }});
 return {env:{
   BOOKING_CLIENT_LIMIT:binding('BOOKING_CLIENT_LIMIT'),
   BOOKING_GLOBAL_LIMIT:binding('BOOKING_GLOBAL_LIMIT'),
   TFG_CLIENT_LIMIT:binding('TFG_CLIENT_LIMIT'),
   TFG_GLOBAL_LIMIT:binding('TFG_GLOBAL_LIMIT')
 },calls};
}

test('Wrangler defines independent 60-second native binding quotas and preserves existing KV/Cron',()=>{
 const config=JSON.parse(readFileSync(new URL('../cloudflare/wrangler.jsonc',import.meta.url),'utf8'));
 assert.deepEqual(Object.fromEntries(config.ratelimits.map(r=>[r.name,r.simple])),{
  BOOKING_CLIENT_LIMIT:{limit:20,period:60},
  BOOKING_GLOBAL_LIMIT:{limit:180,period:60},
  TFG_CLIENT_LIMIT:{limit:45,period:60},
  TFG_GLOBAL_LIMIT:{limit:300,period:60}
 });
 assert.equal(new Set(config.ratelimits.map(r=>r.namespace_id)).size,4);
 assert.ok(config.kv_namespaces.some(x=>x.binding==='SCHEDULES_KV'));
 assert.deepEqual(config.triggers.crons,['*/15 * * * *']);
 assert.equal(RATE_BINDINGS.booking.client,'BOOKING_CLIENT_LIMIT');
});
test('booking limiter blocks before payload parsing and official POST, 429 has safe headers',async()=>{
 const {env,calls}=guardEnv({deny:'BOOKING_CLIENT_LIMIT'});
 let upstream=0;
 const resp=await handleRequest(booking(),{env,fetcher:async()=>{upstream++;throw Error('upstream used')}});
 assert.equal(resp.status,429);
 assert.equal(resp.headers.get('Retry-After'),'60');
 assert.equal(resp.headers.get('Access-Control-Allow-Origin'),WEB);
 assert.match(resp.headers.get('Cache-Control'),/no-store/);
 assert.deepEqual(await resp.json(),{error:'RATE_LIMITED',booking_authorized:false});
 assert.equal(upstream,0);
 assert.deepEqual(calls,[{name:'BOOKING_CLIENT_LIMIT',key:'192.0.2.12'}]);
 assert.equal(JSON.stringify(calls).includes(CODE),false);
});
test('global booking protection stops rotating clients on one Cloudflare PoP',async()=>{
 const {env,calls}=guardEnv({deny:'BOOKING_GLOBAL_LIMIT'});
 let upstream=0;
 const resp=await handleRequest(booking({'CF-Connecting-IP':'198.51.100.1'}),{
  env,fetcher:async()=>{upstream++;return new Response('');}
 });
 assert.equal(resp.status,429);
 assert.equal(upstream,0);
 assert.deepEqual(calls,[
  {name:'BOOKING_CLIENT_LIMIT',key:'198.51.100.1'},
  {name:'BOOKING_GLOBAL_LIMIT',key:'booking'}
 ]);
});
test('on-demand TFG GET uses its separate protection; no abusive fetch reaches terminal',async()=>{
 const {env,calls}=guardEnv({deny:'TFG_GLOBAL_LIMIT'});
 let upstream=0;
 const resp=await handleRequest(direct(),{
  env,fetcher:async()=>{upstream++;throw Error('Must not fetch')}
 });
 assert.equal(resp.status,429);
 assert.equal(upstream,0);
 assert.deepEqual(await resp.json(),{error:'RATE_LIMITED',live:false,booking_verified:false});
 assert.deepEqual(calls,[
  {name:'TFG_CLIENT_LIMIT',key:'192.0.2.12'},
  {name:'TFG_GLOBAL_LIMIT',key:'tfg'}
 ]);
});
test('normal TFG booking still obtains official result without saving user identifiers',async()=>{
 const {env,calls}=guardEnv();
 const upstream=async url=>new Response('export booking fixture',{
  status:200,headers:{'Content-Type':'text/html; charset=iso-8859-1'}
 });
 const resp=await handleRequest(booking(),{env,fetcher:upstream,
  parseBookingHtml:async()=>({status:'found',vessel:'QA SHIP',voyage:'Q1',
   message:'Nave/viaggio rilevati; booking non autorizzato',booking_authorized:false})});
 assert.equal(resp.status,200);
 const body=await resp.json();
 assert.equal(body.status,'found');
 assert.equal(body.booking_authorized,false);
 assert.equal(JSON.stringify(body).includes(CODE),false);
 assert.deepEqual(calls.map(c=>c.name),['BOOKING_CLIENT_LIMIT','BOOKING_GLOBAL_LIMIT']);
});
test('CORS forbidden, query rejection, preflight do not consume native quota',async()=>{
 const {env,calls}=guardEnv();
 const cases=[
  new Request('https://worker.example/api/tfg_booking',{method:'POST',
   headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({booking:CODE})}),
  new Request('https://worker.example/api/tfg_booking?booking=QA',{method:'POST',headers:{Origin:WEB}}),
  new Request('https://worker.example/api/tfg_booking',{method:'OPTIONS',headers:{Origin:WEB}}),
  new Request('https://worker.example/api/tfg?booking=QA'),
  new Request('https://worker.example/api/tfg',{method:'POST'})
 ];
 for(const r of cases)await handleRequest(r,{env});
 assert.deepEqual(calls,[]);
});
test('native binding missing or failing is fail-closed before upstream',async()=>{
 for(const route of ['booking','tfg']){
  const request=route==='booking'?booking():direct();
  for(const {env} of [
   guardEnv({fail:RATE_BINDINGS[route].client}),
   guardEnv({fail:RATE_BINDINGS[route].global}),
   {env:{SCHEDULES_KV:{}}}
  ]){
   let calls=0;
   const response=await handleRequest(request,{env,fetcher:async()=>{calls++;throw Error('unsafe')}});
   assert.equal(response.status,503);
   assert.equal((await response.json()).error,'RATE_LIMIT_UNAVAILABLE');
   assert.equal(calls,0);
  }
 }
});
test('only trusted CF-Connecting-IP is used, never attacker-supplied X-Forwarded-For',async()=>{
 const {env,calls}=guardEnv();
 const a=direct({'X-Forwarded-For':'203.0.113.99','CF-Connecting-IP':'198.51.100.2'});
 const b=direct({'X-Forwarded-For':'203.0.113.100','CF-Connecting-IP':'198.51.100.2'});
 assert.equal((await protectTfgRequest(a,env,'tfg')).allowed,true);
 assert.equal((await protectTfgRequest(b,env,'tfg')).allowed,true);
 assert.deepEqual(calls.filter(x=>x.name==='TFG_CLIENT_LIMIT').map(x=>x.key),
  ['198.51.100.2','198.51.100.2']);
 const missing=direct({'CF-Connecting-IP':''});
 await protectTfgRequest(missing,env,'tfg');
 assert.equal(calls.filter(x=>x.name==='TFG_CLIENT_LIMIT').at(-1).key,'unidentified-client');
});
