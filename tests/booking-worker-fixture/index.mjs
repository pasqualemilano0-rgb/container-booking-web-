import {validateDocument,SOURCE} from './parse_tfg.mjs';
import {readSchedule,getMonitorStatus,refreshAll,parseSctHtml} from './monitor.mjs';
import {readBookingPayload,readBoundedBytes,lookupTfgBooking,BookingRequestError} from './tfg_booking.mjs';
import {protectTfgRequest} from './rate_limit.mjs';
const WEB='https://pasqualemilano0-rgb.github.io';
const LTS_SESSION_ENDPOINT='https://otrqynkscpbeyuvdlgpg.supabase.co/functions/v1/lts-phone-auth';
const LTS_UID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Staged server-side authorization. Enable only after client rollout and QA.
 * Never treat Origin, CORS, iframe messages or a JWT decoded in the browser
 * as proof of LTS access. Supabase validates the live session and account.
 */
export async function authorizeLtsBooking(request,env,authFetcher=fetch,requireSession=false){
 const mode=requireSession?'true':env?.LTS_PORTI_REQUIRE_SESSION;
 if(mode===undefined||mode==='false')return {allowed:true}; // staged default
 if(mode!=='true')return {allowed:false,status:503,error:'LTS_AUTH_MISCONFIGURED'};
 const bearer=/^Bearer ([A-Za-z0-9._-]{50,4096})$/i.exec(
  request.headers.get('Authorization')||'');
 if(!bearer)return {allowed:false,status:401,error:'LTS_LOGIN_REQUIRED'};
 try{
  const response=await authFetcher(LTS_SESSION_ENDPOINT,{
   method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',
   signal:AbortSignal.timeout(7000),
   headers:{Authorization:'Bearer '+bearer[1],Accept:'application/json',
    'Content-Type':'application/json'},
   body:JSON.stringify({action:'session'})
  });
  if(response.status===401)return {allowed:false,status:401,error:'LTS_SESSION_INVALID'};
  if(response.status===403)return {allowed:false,status:403,error:'LTS_ACCESS_DENIED'};
  if(response.status!==200||response.redirected||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
   return {allowed:false,status:503,error:'LTS_AUTH_UNAVAILABLE'};
  const raw=await readBoundedBytes(response.body,2048);
  const verified=JSON.parse(new TextDecoder().decode(raw));
  if(verified?.active!==true||!LTS_UID.test(verified.user_id||'')||
    !['driver','admin'].includes(verified.role)||
    (verified.role==='admin'&&(verified.mfa_enrolled!==true||verified.mfa_verified!==true)))
   return {allowed:false,status:403,error:'LTS_ACCESS_DENIED'};
  return {allowed:true};
 }catch{
  return {allowed:false,status:503,error:'LTS_AUTH_UNAVAILABLE'};
 }
}

const allowedOrigin=origin=>origin===WEB;
const RAW='https://raw.githubusercontent.com/pasqualemilano0-rgb/LTS-Registro-Viaggi/main/porti/data/';
const SNAPSHOTS={
 '/api/cnt':{file:'conateco.json',source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast'},
 '/api/sct':{file:'sct.json',source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php'},
 '/api/tfg/snapshot':{file:'tfg_schedule.json',source:SOURCE}
};
function responseHeaders(origin){
 const h=new Headers({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Vary':'Origin'});
 if(allowedOrigin(origin))h.set('Access-Control-Allow-Origin',origin);
 return h;
}
const json=(status,obj,origin)=>new Response(JSON.stringify(obj),{
 status,headers:responseHeaders(origin)
});
async function remote(url,fetcher,timeout=18000,accept='application/json'){
 const signal=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(timeout):undefined;
 return fetcher(url,{signal,redirect:'manual',headers:{Accept:accept}});
}
/** HTMLRewriter is a Cloudflare runtime API; no Python or TLS bypass. */
export async function parseTfgHtml(html,now=new Date(),factory){
 if(typeof html!=='string'||!html.length||html.length>1_000_000)
  throw Error('TFG_HTML_SIZE');
 const rows=[],fragments=[];
 let chars=0,currentRow=null,currentCell=null;
 const rw=(factory?factory():new HTMLRewriter())
 .on('tr',{element(el){
   const row=[];currentRow=row;
   el.onEndTag(()=>{rows.push(row.map(c=>c.text));if(currentRow===row)currentRow=null;});
 }})
 .on('tr > td',{
   element(el){
    if(!currentRow)return;
    const cell={text:''};currentRow.push(cell);currentCell=cell;
    el.onEndTag(()=>{if(currentCell===cell)currentCell=null;});
   },
   text(chunk){if(currentCell&&currentCell.text.length<400)
    currentCell.text+=chunk.text.slice(0,400-currentCell.text.length);}
 })
 .onDocument({text(chunk){
  if(chars>=150000)return;
  const text=chunk.text.slice(0,150000-chars);chars+=text.length;fragments.push(text);
 }});
 await rw.transform(new Response(html,{headers:{'Content-Type':'text/html'}})).text();
 return validateDocument(fragments.join(' '),rows,now);
}
async function tfg(fetcher,parse){
 const r=await remote(SOURCE,fetcher,20000,'text/html');
 if(!r.ok)throw Error('TFG_HTTP');
 if(Number(r.headers.get('content-length'))>1_000_000)throw Error('TFG_TOO_BIG');
 const html=await r.text();
 const data=await parse(html,new Date());
 if(data.source!==SOURCE||data.live!==true||data.booking_verified!==false||
  !Array.isArray(data.rows)||!data.rows.length)throw Error('TFG_BAD_SCHEMA');
 return data;
}
async function snapshot(spec,fetcher){
 const r=await remote(RAW+spec.file,fetcher,15000);
 if(!r.ok)throw Error('SNAPSHOT_HTTP');
 if(Number(r.headers.get('content-length'))>500000)throw Error('SNAPSHOT_TOO_BIG');
 const body=await r.text();
 if(body.length>500000)throw Error('SNAPSHOT_TOO_BIG');
 const data=JSON.parse(body);
 if(!data||data.source!==spec.source||!Array.isArray(data.rows)||!data.rows.length)
  throw Error('SNAPSHOT_SCHEMA');
 const stamp=Date.parse(data.acquired_at);
 if(!Number.isFinite(stamp)||stamp>Date.now()+300000)throw Error('SNAPSHOT_TIMESTAMP');
 return {...data,live:false,booking_verified:false,mode:'periodic_snapshot',
  stale:Date.now()-stamp>45*60*1000};
}
export async function handleRequest(request,deps={}){
 const fetcher=deps.fetcher??fetch, parse=deps.parseHtml??parseTfgHtml;
 const env=deps.env;
 const url=new URL(request.url),path=url.pathname,origin=request.headers.get('Origin');
 const bookingRoute=path==='/api/tfg_booking'||path==='/api/tfg_booking/';
 if(!bookingRoute&&path!=='/api/health'&&path!=='/api/tfg'&&path!=='/api/monitor/status'&&!Object.hasOwn(SNAPSHOTS,path))
  return json(404,{error:'NOT_FOUND'},origin);
 if(bookingRoute&&url.search)return json(400,{error:'QUERY_STRING_FORBIDDEN',booking_authorized:false},origin);
 if(request.method==='OPTIONS'){
  if(!allowedOrigin(origin))return json(403,bookingRoute
   ?{error:'ORIGIN_NOT_ALLOWED',booking_authorized:false}:{error:'ORIGIN_NOT_ALLOWED'},origin);
  const h=responseHeaders(origin);
  h.set('Access-Control-Allow-Methods',bookingRoute?'POST, OPTIONS':'GET, OPTIONS');
  if(bookingRoute)h.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  h.set('Access-Control-Max-Age','600');
  return new Response(null,{status:204,headers:h});
 }
 if(bookingRoute){
  if(request.method!=='POST')return json(405,{error:'POST_ONLY',booking_authorized:false},origin);
  if(!allowedOrigin(origin))return json(403,{error:'ORIGIN_DENIED',booking_authorized:false},origin);
  const guard=await protectTfgRequest(request,env,'booking');
  if(!guard.allowed){
   const response=json(guard.status,{error:guard.error,booking_authorized:false},origin);
   if(guard.status===429)response.headers.set('Retry-After','60');
   return response;
  }
  const access=await authorizeLtsBooking(request,env,deps.authFetcher,deps.forceSessionGate===true);
  if(!access.allowed)return json(access.status,{error:access.error,booking_authorized:false},origin);
  try{
   const booking=await readBookingPayload(request);
   const data=await lookupTfgBooking(booking,{fetcher,
    parseHtml:deps.parseBookingHtml,signal:request.signal});
   return json(200,data,origin);
  }catch(error){
   if(error instanceof BookingRequestError)return json(error.status,{error:error.message,booking_authorized:false},origin);
   return json(503,{status:'unavailable',booking_authorized:false,
    message:'Il risultato TFG non è disponibile. Verifica sul portale ufficiale.'},origin);
  }
 }
 if(request.method!=='GET')return json(405,{error:'METHOD_NOT_ALLOWED'},origin);
 if(url.search)return json(400,{error:'NO_BOOKING_OR_QUERY_PARAMETERS'},origin);
 if(path==='/api/tfg'){
  const guard=await protectTfgRequest(request,env,'tfg');
  if(!guard.allowed){
   const response=json(guard.status,{error:guard.error,live:false,booking_verified:false},origin);
   if(guard.status===429)response.headers.set('Retry-After','60');
   return response;
  }
 }
 if(path==='/api/health')return json(200,{status:'ok',backend:'cloudflare-workers',
  booking_verified:false,tfg_live_verified:false,monitor_configured:!!env?.SCHEDULES_KV},origin);
 if(path==='/api/monitor/status'){
  try{return json(200,await getMonitorStatus(env),origin);}
  catch{return json(503,{error:'MONITOR_NOT_VERIFIABLE'},origin);}
 }
 try{
  let data;
  if(path==='/api/tfg'){
    data=await tfg(fetcher,parse); // still an on-demand official read
  }else{
    const term=path==='/api/cnt'?'cnt':path==='/api/sct'?'sct':'tfg';
    data=await readSchedule(env,term);
    if(!data)data=await snapshot(SNAPSHOTS[path],fetcher);
  }
  return json(200,data,origin);
 }catch{
  // Public API errors reveal no network internals, booking data or upstream text.
  return json(503,{error:path==='/api/tfg'?'TFG_NOT_VERIFIABLE':'SNAPSHOT_NOT_VERIFIABLE',
   live:false,booking_verified:false},origin);
 }
}
export default {
  // Production entrypoint always enforces JWT regardless of mutable rollout flags.
  // Rollback requires deploying a different reviewed Worker version, not deleting a binding.
  fetch(request,env){return handleRequest(request,{env,forceSessionGate:true});},
  scheduled(controller,env,ctx){
    ctx.waitUntil(refreshAll(env,{parseTfg:parseTfgHtml,parseSct:parseSctHtml}));
  }
};
