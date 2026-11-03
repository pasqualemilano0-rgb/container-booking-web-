/** User-initiated TFG booking lookup. No storage, logs, schedule lookup or proxy. */
export const BOOKING_SOURCE='https://tfg.bucci.it/@/TFGW_WW_BKK';
export const BOOKING_FORMAT=/^[A-Z0-9][A-Z0-9/-]{3,49}$/;
const MAX_REQUEST_BYTES=512,MAX_HTML_BYTES=100000;
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const unverified=message=>({status:'unverified',message,booking_authorized:false});

/** Bound actual streamed bytes even when Content-Length is absent or incorrect. */
export async function readBoundedBytes(stream,limit,signal){
 if(!stream)return new Uint8Array();
 const reader=stream.getReader(),chunks=[];
 let length=0,done=false;
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   if(signal?.aborted)throw Error('BODY_ABORTED');
   const next=await reader.read();
   if(signal?.aborted)throw Error('BODY_ABORTED');
   if(next.done){done=true;break;}
   length+=next.value.byteLength;
   if(length>limit)throw Error('BODY_TOO_LARGE');
   chunks.push(next.value);
  }
 }finally{
  signal?.removeEventListener('abort',cancel);
  if(!done)await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}
export class BookingRequestError extends Error{
 constructor(status,code){super(code);this.status=status;}
}
export async function readBookingPayload(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))
  throw new BookingRequestError(415,'JSON_REQUIRED');
 const declared=request.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_REQUEST_BYTES))
  throw new BookingRequestError(413,'INVALID_SIZE');
 let body;
 try{
  const bytes=await readBoundedBytes(request.body,MAX_REQUEST_BYTES,AbortSignal.timeout(5000));
  body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch(error){
  throw new BookingRequestError(error.message==='BODY_TOO_LARGE'?413:400,
   error.message==='BODY_TOO_LARGE'?'INVALID_SIZE':'INVALID_JSON');
 }
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==1
   ||!Object.hasOwn(body,'booking'))throw new BookingRequestError(400,'INVALID_PAYLOAD');
 if(typeof body.booking!=='string'||!BOOKING_FORMAT.test(body.booking))
  throw new BookingRequestError(400,'INVALID_BOOKING');
 return body.booking;
}
function entities(value){
 const named={nbsp:' ',amp:'&',apos:"'",quot:'"',lt:'<',gt:'>',egrave:'è',Egrave:'È'};
 return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,name)=>{
  if(name[0]!=='#')return named[name]??whole;
  const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)
   ?String.fromCodePoint(code):'\ufffd';
 });
}
/** Structured visible text only; vessel/ voyage never implies authorization. */
export function parseBookingDocument({title,text,titleCount=1,blocked=false},booking){
 if(!BOOKING_FORMAT.test(booking)||titleCount!==1||clean(entities(title)).toUpperCase()!=='EXPORT BOOKING')
  return unverified('Titolo del risultato TFG non riconosciuto.');
 const visible=clean(entities(text));
 if(blocked||/ACCESSO\s+NEGATO|ERRORE\s+DI\s+SISTEMA|SERVIZIO\s+NON\s+DISPONIBILE|CAPTCHA|\bLOGIN\b|\bLOG\s+IN\b|\bSIGN\s+IN\b|\bPASSWORD\b|\bACCEDI\b|AUTENTICAZIONE/i.test(visible))
  return unverified('Il terminal non ha prodotto una risposta verificabile.');
 const codes=new Set([...visible.matchAll(/\bBOOKING\s*(?:N(?:R|\.)?\.?)?\s*[:#]\s*([A-Z0-9/-]+)/gi)]
  .map(match=>match[1].toUpperCase()));
 if(codes.size&&(codes.size!==1||!codes.has(booking)))
  return unverified('Il booking nella risposta differisce da quello cercato.');
 const row=/\b(?:M\s*\/\s*V|MV|NAVE)\s+([A-Z][A-Z0-9 .,'-]{2,70}?)\s+\d{2}\/\d{2}\/(?:\d{4}|\d{2})\s+Voy(?:age|aggio)?\.?\s*:?\s*([A-Z0-9./-]+)/gi;
 const candidates=new Map();
 for(const match of visible.matchAll(row)){
  const vessel=clean(match[1]).toUpperCase(),voyage=match[2].toUpperCase();
  if(voyage.length>20)return unverified('Viaggio TFG non interpretabile.');
  if(/BOOKING|SCARICARE|CONTAINER|NON\s+TROVAT|INESISTENT|NAVE\s+CHIUSA/i.test(vessel))continue;
  candidates.set(vessel+'|'+voyage,{vessel,voyage});
 }
 if(/\b(?:IL\s+)?BOOKING\s+(?:E['’]?|È)\s+INESISTENTE\b|BOOKING\s+NON\s+TROVAT/i.test(visible))
  return candidates.size?unverified('Risposta TFG contraddittoria.'): {
   status:'not_found',message:'Il terminal TFG indica che il booking è inesistente.',booking_authorized:false
  };
 if(candidates.size!==1)
  return unverified('Impossibile identificare un solo abbinamento nave/viaggio. Verifica sul portale TFG.');
 return {status:'found',...candidates.values().next().value,booking_authorized:false,
  message:"Nave e viaggio rilevati dal risultato TFG. L'accettazione del booking non è confermata."};
}
const VOID_TAGS=new Set(['area','base','br','col','command','embed','hr','img','input','keygen','link','meta','param','source','track','wbr']);
const HIDDEN_TAGS=new Set(['script','style','template','noscript']);
function explicitlyHidden(element){
 if(HIDDEN_TAGS.has(element.tagName)||element.hasAttribute('hidden')
   ||clean(element.getAttribute('aria-hidden')).toLowerCase()==='true')return true;
 // Conservative literal inline declarations only, including !important/comments.
 // No external stylesheet, selector, inheritance or computed-style evaluation.
 const style=entities(element.getAttribute('style')||'').replace(/\/\*[\s\S]*?\*\//g,'');
 return style.split(';').some(declaration=>
  /^\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!\s*important\s*)?$/i.test(declaration));
}
/** Concatenate streaming chunks within a node, separate distinct HTML nodes. */
export async function parseBookingHtml(html,booking,factory){
 if(typeof html!=='string'||!html.length||html.length>MAX_HTML_BYTES)
  return unverified('Risposta TFG non interpretabile.');
 let title='',titleCount=0,hiddenDepth=0,blocked=false;
 const parts=[];
 const rw=(factory?factory():new HTMLRewriter())
  .on('title',{element(){titleCount++;},text(chunk){title+=chunk.text;}})
  .on('input[type="password"], form[action*="login"], form[action*="signin"], [class*="captcha"], [id*="captcha"], [name="cf-turnstile-response"]',{
   element(){blocked=true;}
  })
  .on('*',{element(el){
   const voidTag=VOID_TAGS.has(el.tagName);
   const hidden=!voidTag&&explicitlyHidden(el);
   if(hidden)hiddenDepth++;
   parts.push(' ');
   if(!voidTag)el.onEndTag(()=>{
    if(hidden)hiddenDepth--;
    parts.push(' ');
   });
  }})
  .on('body',{text(chunk){
   if(hiddenDepth)return;
   parts.push(chunk.text);
   if(chunk.lastInTextNode)parts.push(' ');
  }});
 // The input is already byte-bounded; the rewritten HTML is discarded.
 await rw.transform(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}})).text();
 return parseBookingDocument({title,text:parts.join(''),titleCount,blocked},booking);
}
export async function lookupTfgBooking(booking,{fetcher=fetch,parseHtml=parseBookingHtml,signal}={}){
 if(!BOOKING_FORMAT.test(booking))throw Error('INVALID_BOOKING');
 const controller=new AbortController(),abort=()=>controller.abort();
 const timer=setTimeout(abort,20000);
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 try{
  const response=await fetcher(BOOKING_SOURCE,{
   method:'POST',redirect:'manual',credentials:'omit',signal:controller.signal,
   headers:{Accept:'text/html','Content-Type':'application/x-www-form-urlencoded',
    'User-Agent':'ContainerBookingWeb-TFG-Booking/1.0'},
   body:new URLSearchParams({modo:'2',bkk:booking}).toString()
  });
  if(response.status!==200||response.redirected||(response.url&&response.url!==BOOKING_SOURCE)
    ||!/^text\/html(?:\s*;|$)/i.test(response.headers.get('Content-Type')||'')
    ||Number(response.headers.get('Content-Length'))>MAX_HTML_BYTES){
   await response.body?.cancel().catch(()=>{});
   throw Error('TFG_UNAVAILABLE');
  }
  const bytes=await readBoundedBytes(response.body,MAX_HTML_BYTES,controller.signal);
  // The official form advertises ISO-8859-1. Decode before UTF-8 HTMLRewriter input.
  const html=new TextDecoder('iso-8859-1').decode(bytes);
  const result=await parseHtml(html,booking);
  if(!['found','not_found','unverified'].includes(result?.status))throw Error('TFG_UNVERIFIED');
  return {...result,source:BOOKING_SOURCE,checked_at:new Date().toISOString(),booking_authorized:false};
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
 }
}
