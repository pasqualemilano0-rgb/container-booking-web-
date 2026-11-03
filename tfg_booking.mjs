/** TFG Export Booking lookup through the project's POST-only Cloudflare adapter.
 * User submits explicitly. Only the official TFG booking form receives the
 * booking upstream; the adapter returns whitelisted structured fields.
 */
import {validateBooking} from './booking_search.mjs';
export const TFG_BOOKING_API='https://container-booking-backend.pasqualemilano0.workers.dev/api/tfg_booking';
export const TFG_BOOKING_SOURCE='https://tfg.bucci.it/@/TFGW_WW_BKK';

function scalar(x,max){
  return typeof x==='string' && x.length<=max &&
    !/[<>\u0000-\u001f\u007f]/.test(x) ? x.trim() : '';
}
export function parseTfgBookingApi(raw){
  if(!raw || Array.isArray(raw) || typeof raw!=='object' ||
     raw.source!==TFG_BOOKING_SOURCE || raw.booking_authorized!==false)
    return {status:'unverified',message:'Risposta TFG non riconosciuta.'};
  const status=raw.status;
  const message=scalar(raw.message,240) || 'Controlla il booking sul portale ufficiale.';
  if(status==='not_found')
    return {status:'not_found',message};
  if(status==='unverified')
    return {status:'unverified',message};
  if(status!=='found')
    return {status:'unverified',message:'Risposta del servizio TFG non verificabile.'};
  const vessel=scalar(raw.vessel,80).toUpperCase();
  const voyage=scalar(raw.voyage,24).toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9 .,'-]{2,79}$/.test(vessel) ||
     !/^[A-Z0-9./-]{1,24}$/.test(voyage))
    return {status:'unverified',message:'Nave o viaggio non interpretabili.'};
  const age=Date.now()-Date.parse(raw.checked_at);
  if(!Number.isFinite(age)||age< -300000 ||age>300000)
    return {status:'unverified',message:'Verifica TFG non aggiornata.'};
  return {status:'found',vessel,voyage,message,checked_at:raw.checked_at};
}
export async function lookupTfgBooking(booking, fetcher=fetch, signal){
  const checked=validateBooking(booking);
  if(!checked.valid)throw Error('BOOKING_INVALID');
  const response=await fetcher(TFG_BOOKING_API,{
    method:'POST',mode:'cors',cache:'no-store',credentials:'omit',
    referrerPolicy:'no-referrer',redirect:'error',signal,
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({booking:checked.booking})
  });
  if(response.status===429)throw Error('TFG_RATE_LIMITED');
  if(!response.ok)throw Error('TFG_BACKEND_UNAVAILABLE');
  if(!(response.headers?.get('content-type')||'').toLowerCase().includes('application/json'))
    throw Error('TFG_RESPONSE_NOT_JSON');
  const body=await response.text();
  if(body.length>5000)throw Error('TFG_RESPONSE_OVERSIZED');
  let raw;try{raw=JSON.parse(body);}catch{throw Error('TFG_RESPONSE_INVALID');}
  return parseTfgBookingApi(raw);
}
