/* One-shot live HTTP QA. Runs from GitHub Actions, NOT from client devices.
 * No real booking is sent. The only POST body is an intentionally invalid
 * booking value; the Worker rejects it before it can contact official TFG.
 * Bounded to 32 paced sequential requests, stops at the FIRST expected 429.
 */
const assert=require('node:assert/strict');
const SITE='https://pasqualemilano0-rgb.github.io/container-booking-web-/';
const ORIGIN='https://pasqualemilano0-rgb.github.io';
const WORKER='https://container-booking-backend.pasqualemilano0.workers.dev';
const MAX_INVALID_POSTS=32;
const fetchSafe=(url,options={})=>fetch(url,{
 redirect:'manual',signal:AbortSignal.timeout(11000),
 headers:{'User-Agent':'ContainerBooking-Live-QA/1.0',
   ...(options.headers||{})},
 ...options,
 headers:{'User-Agent':'ContainerBooking-Live-QA/1.0',...(options.headers||{})}
});
async function jsonResponse(url,opts={}){
 const r=await fetchSafe(url,opts);
 const raw=await r.text();
 let body;
 try{body=JSON.parse(raw)}catch{body=null}
 return {status:r.status,headers:r.headers,body,text:raw.slice(0,160)};
}
(async()=>{
 const site=await fetchSafe(SITE);
 assert.equal(site.status,200,'Public GitHub Pages must return HTTP 200');
 const html=await site.text();
 assert.match(html,/Container Booking Web · v0\.65/,'Online page must be v0.65');
 assert.match(html,/app[.]js\?v=20261102-v65/);
 console.log('PASS Pages: HTTP 200, v0.65, app cache-buster present');

 const health=await jsonResponse(WORKER+'/api/health',{
  headers:{Origin:ORIGIN,Accept:'application/json'}
 });
 assert.equal(health.status,200,'Live Cloudflare health must be HTTP 200');
 assert.equal(health.body?.status,'ok');
 assert.equal(health.body?.backend,'cloudflare-workers');
 assert.equal(health.body?.monitor_configured,true);
 assert.equal(health.headers.get('access-control-allow-origin'),ORIGIN);
 assert.match(health.headers.get('cache-control')||'',/no-store/);
 console.log('PASS Worker: /api/health HTTP 200 + KV configured + CORS');

 const monitor=await jsonResponse(WORKER+'/api/monitor/status',{
  headers:{Origin:ORIGIN,Accept:'application/json'}
 });
 assert.equal(monitor.status,200,'Public monitor must respond HTTP 200');
 const terms=monitor.body?.terminals;
 for(const term of ['cnt','tfg','sct']){
  assert.equal(typeof terms?.[term]?.state,'string','Missing '+term+' state');
  console.log('MONITOR '+term,terms[term].state,'attempt',terms[term].last_attempt_at??'not supplied');
 }
 assert.equal(monitor.headers.get('access-control-allow-origin'),ORIGIN);
 console.log('PASS Worker: monitor endpoint HTTP 200');

 for(const [path,term] of [['/api/cnt','cnt'],['/api/sct','sct'],['/api/tfg/snapshot','tfg']]){
  const got=await jsonResponse(WORKER+path,{
   headers:{Origin:ORIGIN,Accept:'application/json'}
  });
  assert.equal(got.status,200,term+' snapshot must be HTTP 200');
  assert.ok(Array.isArray(got.body?.rows)&&got.body.rows.length>0,term+' rows missing');
  assert.ok(Number.isFinite(Date.parse(got.body.acquired_at)),term+' acquired_at invalid');
  assert.equal(got.headers.get('access-control-allow-origin'),ORIGIN);
  console.log('PASS '+term+' snapshot: HTTP 200, rows '+got.body.rows.length+', acquired '+got.body.acquired_at);
 }
 // This request is a preflight only: no limiter consumption, no official lookup.
 const preflight=await jsonResponse(WORKER+'/api/tfg_booking',{
  method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'POST',
   'Access-Control-Request-Headers':'content-type'}
 });
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);
 console.log('PASS booking preflight: 204 with correct origin');

 // Every request has an EMPTY booking. If the guard permits it, validation
 // responds HTTP 400 INVALID_BOOKING; if it denies, 429 RATE_LIMITED.
 // No request can be proxied to the official TFG booking service.
 let attempts=0,limited=false;
 for(let i=1;i<=MAX_INVALID_POSTS;i++){
  const r=await jsonResponse(WORKER+'/api/tfg_booking',{
   method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
   body:JSON.stringify({booking:''})
  });
  attempts++;
  if(r.status===429){
   assert.equal(r.body?.error,'RATE_LIMITED','429 must be issued by our limiter');
   assert.equal(r.body?.booking_authorized,false);
   assert.equal(r.headers.get('retry-after'),'60');
   assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
   assert.match(r.headers.get('cache-control')||'',/no-store/);
   limited=true;
   break;
  }
  assert.equal(r.status,400,'Unexpected response to an invalid payload, body='+r.text);
  assert.equal(r.body?.error,'INVALID_BOOKING');
  assert.equal(r.body?.booking_authorized,false);
  // Native Cloudflare rate limits are eventually consistent. A tight burst
  // can be accepted before the local counters synchronize (documented).
  await new Promise(resolve=>setTimeout(resolve,550));
 }
 console.log('429 TEST: '+attempts+' intentionally invalid payloads, no real booking and no TFG upstream lookup');
 assert.ok(limited,'Expected native 429 in <=32 paced invalid requests; per-PoP counters remain approximate');

 const postHealth=await jsonResponse(WORKER+'/api/health',{headers:{Origin:ORIGIN}});
 assert.equal(postHealth.status,200,'Throttling booking must not block health endpoint');
 assert.equal(postHealth.body?.status,'ok');
 console.log('PASS rate limit: real 429, Retry-After 60, booking endpoints isolated, health unaffected');
})().catch(e=>{console.error('FAIL live QA:',e.stack||String(e));process.exitCode=1;});
