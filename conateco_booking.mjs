/** Public CO.NA.TE.CO. Booking Export query, as used by the official page.
 * The booking goes ONLY to api.conateco.it when the driver presses Search.
 * Never persist booking, send it to our own server or treat HTTP 200 as success.
 */
import {validateBooking} from './booking_search.mjs';
import {isDepartedConateco} from './conateco_fleet.mjs';
export const CONATECO_BOOKING_ENDPOINT='https://api.conateco.it/ConatecoServicesApi/Booking';
const VESSEL_PLACEHOLDERS=new Set(['UNKNOWN','NOT AVAILABLE','NOT FOUND','NO DATA',
  'NON DISPONIBILE','NON INDICATA','NON INDICATO','NON TROVATA','NAVE NON TROVATA',
  'DA VERIFICARE','N.A.','N.D.']);

function safeField(value,max=160){
  if(value===null||value===undefined)return '';
  if(typeof value!=='string'&&typeof value!=='number')return '';
  const text=String(value).replace(/\u00a0/g,' ').trim();
  if(text.length>max||/[<>\u0000-\u001f\u007f]/u.test(text))return '';
  if(['NULL','UNDEFINED','N/A','N/D','-','—'].includes(text.toUpperCase()))return '';
  return text;
}
/** Terminal wall-clock timestamp YYYYMMDDHHmmss: never convert its timezone. */
function compactEta(value){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  if(typeof value==='number'&&!Number.isSafeInteger(value))return null;
  const parts=String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if(!parts)return null;
  const [,year,month,day,hour,minute,second]=parts;
  const y=Number(year),m=Number(month),d=Number(day);
  const leap=y%400===0||(y%4===0&&y%100!==0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(y<1||m<1||m>12||d<1||d>days[m-1]
    ||Number(hour)>23||Number(minute)>59||Number(second)>59)return null;
  return {day:year+'-'+month+'-'+day,
    display:day+'/'+month+'/'+year+' '+hour+':'+minute+(second==='00'?'':':'+second)};
}
function bookingEta(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))return '';
  const text=safeField(value,80);
  return /^\d+$/.test(text)?compactEta(value)?.display||'':text;
}
export function parseConatecoBooking(raw){
  if(!raw||Array.isArray(raw)||typeof raw!=='object')
    return {kind:'unverified',vessel:'',eta:'',message:'Risposta Booking Export non riconoscibile.'};
  const message=safeField(raw.ReturnMessage,220);
  // The official form reads B_NOMNAVE/B_ETA without checking ReturnCode.
  // Nonnegative codes are metadata, not documented success codes. Keep malformed
  // metadata and explicit negative errors fail-closed; a valid vessel is required.
  if(Object.hasOwn(raw,'ReturnCode')&&raw.ReturnCode!==null){
    const rawCode=raw.ReturnCode;
    if(!(typeof rawCode==='number'&&Number.isInteger(rawCode)) &&
       !(typeof rawCode==='string'&&/^-?\d+$/.test(rawCode.trim())))
      return {kind:'unverified',vessel:'',eta:'',message:'Codice di risposta non interpretabile.'};
    const code=Number(rawCode);
    if(!Number.isSafeInteger(code))
      return {kind:'unverified',vessel:'',eta:'',message:'Codice di risposta non interpretabile.'};
    if(code<0)return {kind:'error',vessel:'',eta:'',
      message:message||'Il terminal segnala un errore (codice '+code+').'};
  }
  const vessel=typeof raw.B_NOMNAVE==='string'?safeField(raw.B_NOMNAVE,90):'';
  const eta=bookingEta(raw.B_ETA);
  if(VESSEL_PLACEHOLDERS.has(vessel.toUpperCase().replace(/\s+/g,' '))
     ||!/^[\p{L}\p{N}][\p{L}\p{N} .,'()&/-]{2,89}$/u.test(vessel))
    return {kind:'unverified',vessel:'',eta:'',message:message||'Il terminal non ha restituito una nave verificabile per il booking.'};
  // Neither these fields nor ReturnCode prove that the booking is open for delivery.
  return {
    kind:'vessel-found',
    vessel,eta:eta||'Non indicata',
    message,
    source:'CO.NA.TE.CO. · Booking Export',
    checked_at:new Date().toISOString()
  };
}

/** Cross-reference a CNT booking with the Berth Forecast conservatively.
 * Vessel names alone are not enough: the same ship can make more voyages.
 * Require one vessel AND the same calendar ETA day, never infer a voyage.
 */
export function matchConatecoBookingToSchedule(data,feed){
  const name=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  function etaDay(value){
    const compact=compactEta(value);
    if(compact)return compact.day;
    const s=String(value??'').trim();
    let y,m,d;
    // Reject arbitrary suffixes and impossible times, even if the day prefix
    // looks valid. The terminal publishes local wall-clock dates, not offsets.
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    const local=s.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    let hour,minute,second;
    if(iso){[,y,m,d,hour,minute,second]=iso;}
    else if(local){d=local[1];m=local[2];y=local[3].length===2?'20'+local[3]:local[3];
      [,hour,minute,second]=local.slice(3);}
    else return '';
    if(hour!==undefined&&(Number(hour)>23||Number(minute)>59
      ||(second!==undefined&&Number(second)>59)))return '';
    const dt=new Date(Date.UTC(+y,+m-1,+d));
    if(dt.getUTCFullYear()!==+y||dt.getUTCMonth()!==+m-1||dt.getUTCDate()!==+d)
      return '';
    return y+'-'+m+'-'+d;
  }
  const bookingVessel=name(data?.vessel),bookingEta=etaDay(data?.eta);
  if(!bookingVessel||!bookingEta||!Array.isArray(feed?.rows))
    return {kind:'unverified',row:null};
  const matches=feed.rows.filter(row=>
    name(row?.vessel)===bookingVessel&&etaDay(row?.eta)===bookingEta);
  if(matches.length!==1)return {kind:matches.length>1?'ambiguous':'not-found',row:null};
  // A published voyage identifier is needed to speak about a particular
  // voyage. The booking response itself provides only vessel and ETA.
  const voyage=String(matches[0]?.voyage??'').trim();
  if(matches[0]?.source_conflict===true||!voyage
     ||/^(?:N\/?D|N\/?A|UNKNOWN|NON INDICATO|DA VERIFICARE|-|—)$/i.test(voyage))
    return {kind:'unverified',row:null};
  return {kind:'match',row:matches[0]};
}

/** Select a vessel's forecast state, never the booking's voyage or destination.
 * An exact ETA match (including historical/closed rows) keeps priority. Only
 * otherwise may an exact vessel name select one current, or one historical, row.
 */
export function matchConatecoVesselToForecast(data,feed){
  const exact=matchConatecoBookingToSchedule(data,feed);
  if(exact.kind==='match')return {...exact,basis:'vessel-and-eta'};
  if(exact.kind==='ambiguous')return exact;
  const name=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const vessel=name(data?.vessel);
  if(!vessel||!Array.isArray(feed?.rows))return {kind:'unverified',row:null};
  const named=feed.rows.filter(row=>name(row?.vessel)===vessel);
  const current=named.filter(row=>!isDepartedConateco(row));
  const candidates=current.length?current:named;
  if(candidates.length!==1)return {kind:candidates.length?'ambiguous':'not-found',row:null};
  return {kind:'match',row:candidates[0],basis:'vessel-name'};
}

export async function lookupConatecoBooking(booking,fetcher=fetch,signal){
  const checked=validateBooking(booking);
  if(!checked.valid)throw Error('BOOKING_INVALID');
  const u=new URL(CONATECO_BOOKING_ENDPOINT);
  u.searchParams.set('id_booking',checked.booking);
  const r=await fetcher(u.href,{
    method:'GET',mode:'cors',cache:'no-store',credentials:'omit',
    referrerPolicy:'no-referrer',redirect:'error',signal,
    headers:{Accept:'application/json'}
  });
  if(!r.ok)throw Error('BOOKING_HTTP_UNAVAILABLE');
  const mime=(r.headers?.get('content-type')||'').toLowerCase();
  if(!mime.includes('application/json'))throw Error('BOOKING_RESPONSE_NOT_JSON');
  const size=Number(r.headers?.get('content-length'));
  if(size>24000)throw Error('BOOKING_RESPONSE_TOO_LARGE');
  const text=await r.text();
  if(text.length>24000)throw Error('BOOKING_RESPONSE_TOO_LARGE');
  let data;
  try{data=JSON.parse(text);}catch{throw Error('BOOKING_RESPONSE_INVALID');}
  return parseConatecoBooking(data);
}
