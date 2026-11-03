import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../cloudflare/index.mjs';
import {BOOKING_SOURCE,readBoundedBytes,parseBookingDocument,parseBookingHtml,
 lookupTfgBooking} from '../cloudflare/tfg_booking.mjs';

const WEB='https://pasqualemilano0-rgb.github.io',CODE='QA123456';
const TEXT='Booking: QA123456 M/V SAGARMALA 01/11/26 Voy. 645W';
const document=(text=TEXT,extra={})=>({title:'EXPORT BOOKING',text,...extra});
const parseText=(html,booking)=>parseBookingDocument(document(html),booking);
const post=(body={booking:CODE},extra={})=>new Request('https://worker.example/api/tfg_booking',{
 method:'POST',headers:{Origin:WEB,'Content-Type':'application/json'},
 body:JSON.stringify(body),...extra
});
const upstream=text=>new Response(text,{headers:{'Content-Type':'text/html; charset=iso-8859-1'}});

test('TFG booking parser: one vessel/voyage is found without authorizing or inventing destination',()=>{
 const result=parseBookingDocument(document(),CODE);
 assert.equal(result.status,'found');
 assert.equal(result.vessel,'SAGARMALA');
 assert.equal(result.voyage,'645W');
 assert.equal(result.booking_authorized,false);
 assert.equal('booking' in result,false);
 assert.equal('destination' in result,false);
 assert.equal('acceptance' in result,false);
 const duplicate=parseBookingDocument(document(TEXT+' '+TEXT),CODE);
 assert.equal(duplicate.status,'found','Repeated identical record is unambiguous');
});
test('TFG booking parser: negatives, HTML entities and echoed codes are checked conservatively',()=>{
 for(const text of ["IL BOOKING E' INESISTENTE!!",'IL BOOKING È INESISTENTE',
  'IL BOOKING E&#39; INESISTENTE','BOOKING NON TROVATO']){
  const out=parseBookingDocument(document(text),CODE);
  assert.equal(out.status,'not_found',text);
  assert.equal(out.booking_authorized,false);
 }
 for(const text of [TEXT.replace(CODE,'OTHER123'),TEXT+' Booking: OTHER123',
  TEXT+' M/V ANOTHER SHIP 01/11/26 Voy. 222E',TEXT+" IL BOOKING E' INESISTENTE"])
  assert.equal(parseBookingDocument(document(text),CODE).status,'unverified');
 assert.equal(parseBookingDocument(document(TEXT.replace('Booking: '+CODE+' ','')),CODE).status,'found');
 for(const voyage of ['12345678901234567890-EXTRA','1234567890123456789/EXTRA'])
  assert.equal(parseBookingDocument(document(TEXT.replace('645W',voyage)),CODE).status,'unverified');
 const longBooking='A'.repeat(50);
 assert.equal(parseBookingDocument(document(TEXT.replace(CODE,longBooking+'-OTHER')),longBooking).status,'unverified');
});
test('TFG booking parser: login, CAPTCHA, missing/changed title and partial records never become found',()=>{
 for(const text of ['CAPTCHA '+TEXT,'Accesso negato '+TEXT,'LOGIN '+TEXT,
  'Password '+TEXT,'Sign in '+TEXT,'Autenticazione '+TEXT,'Accedi '+TEXT,'M/V SAGARMALA 01/11/26',
  'M/V SCARICARE PRESSO 01/11/26 Voy. 123'])
  assert.equal(parseBookingDocument(document(text),CODE).status,'unverified');
 for(const extra of [{title:'Login'},{titleCount:0},{titleCount:2},{blocked:true}])
  assert.equal(parseBookingDocument(document(TEXT,extra),CODE).status,'unverified');
});

test('HTMLRewriter extraction joins chunks within a node and separates table cells, ignoring scripts',async()=>{
 const handlers=new Map();
 let afterScript='';
 const factory=()=>({
  on(selector,handler){handlers.set(selector,handler);return this;},
  transform(response){
   assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');
   const title=handlers.get('title'),body=handlers.get('body'),nodes=handlers.get('*');
   title.element();
   title.text({text:'EXPORT BO',lastInTextNode:false});
   title.text({text:'OKING',lastInTextNode:true});
   for(const text of ['Booking: QA123456','M/V','SAGARMALA','01/11/26','Voy.','645W']){
    let end;
    nodes.element({tagName:'td',hasAttribute(){return false;},getAttribute(){return null;},onEndTag(fn){end=fn;}});
    const middle=Math.floor(text.length/2);
    body.text({text:text.slice(0,middle),lastInTextNode:false});
    body.text({text:text.slice(middle),lastInTextNode:true});
    end();
   }
   let scriptEnd;
   nodes.element({tagName:'script',hasAttribute(){return false;},getAttribute(){return null;},onEndTag(fn){scriptEnd=fn;}});
   body.text({text:'CAPTCHA M/V EVIL SHIP 01/11/26 Voy. 222E',lastInTextNode:true});
   scriptEnd();
   body.text({text:afterScript,lastInTextNode:true});
   return new Response('');
  }
 });
 assert.equal((await parseBookingHtml('<html>bounded fixture</html>',CODE,factory)).status,'found');
 afterScript='M/V ANOTHER SHIP 01/11/26 Voy. 222E';
 assert.equal((await parseBookingHtml('<html>bounded fixture</html>',CODE,factory)).status,'unverified');
});

test('explicit hidden/ARIA/inline CSS subtrees never supply booking records, including nested and void tags',async()=>{
 const attributes=[{hidden:''},{hidden:'until-found'},{'aria-hidden':' TRUE '},
  {style:'display:none'},{style:' DISPLAY : NoNe !IMPORTANT ; color:red'},
  {style:'visibility: hidden ! important'},{style:'visibility:COLLAPSE'},
  {style:'display:/**/none!important'}];
 for(const attrs of attributes){
  let visibleAfter=false;
  const factory=()=>{
   const handlers=new Map();
   return {
    on(selector,handler){handlers.set(selector,handler);return this;},
    transform(){
     const title=handlers.get('title'),body=handlers.get('body'),nodes=handlers.get('*');
     const open=(tagName,attrs={})=>{
      let close=()=>{};
      nodes.element({tagName,hasAttribute(name){return Object.hasOwn(attrs,name);},
       getAttribute(name){return attrs[name]??null;},onEndTag(fn){close=fn;}});
      return ()=>close();
     };
     title.element();title.text({text:'EXPORT BOOKING',lastInTextNode:true});
     const outer=open('div',attrs),nested=open('span',{hidden:''});
     body.text({text:TEXT,lastInTextNode:true});nested();
     body.text({text:TEXT.replace('645W','999E'),lastInTextNode:true});outer();
     // Hidden void elements have no closing tag and must not hide later text.
     open('input',{hidden:''});open('br',{style:'display:none'});
     if(visibleAfter)body.text({text:TEXT,lastInTextNode:true});
     return new Response('');
    }
   };
  };
  assert.equal((await parseBookingHtml('<html>fixture</html>',CODE,factory)).status,'unverified',JSON.stringify(attrs));
  visibleAfter=true;
  const found=await parseBookingHtml('<html>fixture</html>',CODE,factory);
  assert.equal(found.status,'found',JSON.stringify(attrs));assert.equal(found.voyage,'645W');
 }
});

test('stream limits count actual bytes and cancel oversized bodies without trusting Content-Length',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(300));c.enqueue(new Uint8Array(300));},
  cancel(){cancelled=true;}});
 await assert.rejects(readBoundedBytes(stream,512),/BODY_TOO_LARGE/);
 assert.equal(cancelled,true);
 const controller=new AbortController();
 const pending=new ReadableStream({start(){},cancel(){cancelled=true;}});
 const reading=readBoundedBytes(pending,512,controller.signal);
 controller.abort();
 await assert.rejects(reading,/BODY_ABORTED/);
});
test('booking route permits Pages POST and preflight, rejects GET/query/foreign or absent origins',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return upstream(TEXT);};
 const options=await handleRequest(new Request('https://worker.example/api/tfg_booking',{
  method:'OPTIONS',headers:{Origin:WEB,'Access-Control-Request-Method':'POST'}
 }));
 assert.equal(options.status,204);
 assert.equal(options.headers.get('Access-Control-Allow-Methods'),'POST, OPTIONS');
 assert.equal(options.headers.get('Access-Control-Allow-Headers'),'Content-Type');
 for(const [request,status] of [
  [new Request('https://worker.example/api/tfg_booking'),405],
  [post(undefined,{headers:{'Content-Type':'application/json'}}),403],
  [post(undefined,{headers:{Origin:'https://untrusted-backend.example','Content-Type':'application/json'}}),403],
  [post(undefined,{headers:{Origin:'https://evil.example','Content-Type':'application/json'}}),403],
  [new Request('https://worker.example/api/tfg_booking?booking='+CODE,{method:'POST',headers:{Origin:WEB}}),400],
  [new Request('https://worker.example/api/tfg_booking?booking='+CODE,{method:'OPTIONS',headers:{Origin:WEB}}),400]
 ]){
  const response=await handleRequest(request,{fetcher,parseBookingHtml:parseText});
  assert.equal(response.status,status);
  assert.equal((await response.json()).booking_authorized,false);
 }
 assert.equal(calls,0);
});
test('booking route validates JSON schema, format, encoding and streamed 512 byte maximum before upstream',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return upstream(TEXT);};
 const cases=[post({booking:CODE,url:'https://other.example'}),post([]),post(null),post({}),
  post({booking:'abc'}),post({booking:'<script>'}),post({booking:123456}),
  post({booking:CODE},{headers:{Origin:WEB,'Content-Type':'text/plain'}}),
  post({booking:CODE},{headers:{Origin:WEB,'Content-Type':'application/json','Content-Length':'900'}}),
  post({booking:CODE},{body:'{"booking":"'+CODE+'"}'+''.padEnd(600,' ')}),
  post({booking:CODE},{body:new Uint8Array([0xff,0xfe])})];
 for(const request of cases){
  const response=await handleRequest(request,{fetcher});
  assert.ok(response.status>=400&&response.status<500,response.status);
 }
 assert.equal(calls,0);
 const streamed=new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(JSON.stringify({booking:CODE})));
  controller.enqueue(new Uint8Array(600).fill(32));controller.close();
 }});
 assert.equal((await handleRequest(post(undefined,{body:streamed,duplex:'half'}),{fetcher})).status,413);
 assert.equal(calls,0);
});
test('booking lookup sends only fixed official HTTPS form POST, never touches KV or schedule APIs',async()=>{
 const seen=[];
 const response=await handleRequest(post(),{
  env:{SCHEDULES_KV:{get(){throw Error('Booking must not access KV');},put(){throw Error('Booking must not access KV');}},
   BOOKING_CLIENT_LIMIT:{async limit(){return {success:true};}},
   BOOKING_GLOBAL_LIMIT:{async limit(){return {success:true};}}},
  fetcher:async(url,options)=>{seen.push({url,options});return upstream(TEXT);},parseBookingHtml:parseText
 });
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),WEB);
 assert.match(response.headers.get('Cache-Control'),/no-store/);
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 const data=await response.json();
 assert.equal(data.status,'found');assert.equal(data.booking_authorized,false);
 assert.equal(data.source,BOOKING_SOURCE);assert.ok(Number.isFinite(Date.parse(data.checked_at)));
 assert.equal(JSON.stringify(data).includes(CODE),false);
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,BOOKING_SOURCE);
 const options=seen[0].options;
 assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
 assert.equal(options.signal instanceof AbortSignal,true);
 assert.deepEqual([...new URLSearchParams(options.body)],[['modo','2'],['bkk',CODE]]);
 assert.equal('cache' in options,false);
});
test('booking lookup decodes official ISO-8859-1 bytes before parsing and returns not_found',async()=>{
 const bytes=Uint8Array.from([..."IL BOOKING È INESISTENTE"].map(char=>char.charCodeAt(0)));
 const result=await lookupTfgBooking(CODE,{
  fetcher:async()=>new Response(bytes,{headers:{'Content-Type':'text/html; charset=iso-8859-1'}}),
  parseHtml:parseText
 });
 assert.equal(result.status,'not_found');assert.equal(result.booking_authorized,false);
});
test('client abort cancels a pending upstream response body',async()=>{
 const controller=new AbortController();let cancelled=false;
 const result=lookupTfgBooking(CODE,{signal:controller.signal,
  fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{
   headers:{'Content-Type':'text/html'}
  }),parseHtml:parseText});
 await new Promise(resolve=>setTimeout(resolve,0));
 controller.abort();
 await assert.rejects(result,/BODY_ABORTED/);
 assert.equal(cancelled,true);
});
test('upstream TLS, redirects, login, wrong MIME, oversized streaming or unrecognized replies fail closed without data leakage',async()=>{
 const cases=[async()=>{throw Error('TLS failure '+CODE);},
  async()=>new Response(null,{status:302,headers:{Location:'https://other.example'}}),
  async()=>new Response('bad',{status:500}),
  async()=>new Response(TEXT,{headers:{'Content-Type':'application/json'}}),
  async()=>upstream(''.padEnd(100001,'X')),
  async()=>new Response(TEXT,{headers:{'Content-Type':'text/html','Content-Length':'100001'}})];
 for(const fetcher of cases){
  const response=await handleRequest(post(),{fetcher,parseBookingHtml:parseText});
  assert.equal(response.status,503);
  const out=await response.text();
  assert.equal(out.includes(CODE),false);assert.equal(out.includes('TLS'),false);
  assert.equal(JSON.parse(out).booking_authorized,false);
 }
 const login=await handleRequest(post(),{fetcher:async()=>upstream('LOGIN '+TEXT),parseBookingHtml:parseText});
 assert.equal((await login.json()).status,'unverified');
 const bad=await handleRequest(post(),{fetcher:async()=>upstream(TEXT),parseBookingHtml:async()=>({status:'unexpected'})});
 assert.equal(bad.status,503);
});
test('booking payloads are never accepted by public schedule/monitor APIs',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;throw Error('Must not forward booking');};
 for(const path of ['/api/cnt','/api/tfg','/api/sct','/api/tfg/snapshot','/api/monitor/status']){
  const response=await handleRequest(new Request('https://worker.example'+path,{
   method:'POST',headers:{Origin:WEB,'Content-Type':'application/json'},body:JSON.stringify({booking:CODE})
  }),{fetcher});
  assert.equal(response.status,405);
  assert.equal((await handleRequest(new Request('https://worker.example'+path+'?booking='+CODE),{fetcher})).status,400);
 }
 assert.equal(calls,0);
});
