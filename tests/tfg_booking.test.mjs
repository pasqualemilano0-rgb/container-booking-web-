import test from 'node:test';
import assert from 'node:assert/strict';
import {TFG_BOOKING_API,TFG_BOOKING_SOURCE,parseTfgBookingApi,lookupTfgBooking} from '../tfg_booking.mjs';

const base={source:TFG_BOOKING_SOURCE,booking_authorized:false,checked_at:new Date().toISOString()};
test('TFG parse: nave e viaggio sono separati dall autorizzazione',()=>{
 const r=parseTfgBookingApi({...base,status:'found',vessel:'SAGARMALA',voyage:'645W',message:'Risultato TFG'});
 assert.equal(r.status,'found');
 assert.equal(r.vessel,'SAGARMALA');
 assert.equal(r.voyage,'645W');
 assert.equal('booking_authorized' in r,false);
 assert.equal('destination' in r,false);
});
test('TFG booking inesistente non contiene nave e non autorizza',()=>{
 const r=parseTfgBookingApi({...base,status:'not_found',message:'Il booking e inesistente'});
 assert.equal(r.status,'not_found');
 assert.equal('vessel' in r,false);
});
test('TFG fail-closed: manca origine, stato, flag, timestamp o dati',()=>{
 for(const input of [
  {...base,status:'found',vessel:'',voyage:'645W'},
  {...base,status:'found',vessel:'<SCRIPT>',voyage:'645W'},
  {...base,status:'found',vessel:'SAGARMALA',voyage:'bad<script>'},
  {...base,status:'found',vessel:'SAGARMALA',voyage:'645W',booking_authorized:true},
  {...base,status:'found',vessel:'SAGARMALA',voyage:'645W',source:'https://wrong'},
  {...base,status:'found',vessel:'SAGARMALA',voyage:'645W',checked_at:'2022-01-01T00:00:00Z'},
  {},null
 ])assert.notEqual(parseTfgBookingApi(input).status,'found');
});
test('TFG sends user booking only in JSON POST to Cloudflare, not URL',async()=>{
 let seen=null;
 const fetcher=async(url,opts)=>{
  seen={url,opts};
  return new Response(JSON.stringify({...base,status:'not_found',message:'Non trovato'}),{
   status:200,headers:{'Content-Type':'application/json'}});
 };
 const result=await lookupTfgBooking('ebkg 19223970',fetcher);
 assert.equal(result.status,'not_found');
 assert.equal(seen.url,TFG_BOOKING_API);
 assert.equal(new URL(seen.url).origin,'https://container-booking-backend.pasqualemilano0.workers.dev');
 assert.ok(!seen.url.includes('EBKG'));
 assert.equal(seen.opts.method,'POST');
 assert.equal(seen.opts.credentials,'omit');
 assert.deepEqual(JSON.parse(seen.opts.body),{booking:'EBKG19223970'});
});
test('TFG rejects invalid input and bad server responses',async()=>{
 await assert.rejects(()=>lookupTfgBooking('A?',async()=>{}));
 for(const response of [
  new Response('server error',{status:503,headers:{'Content-Type':'text/html'}}),
  new Response('not json',{status:200,headers:{'Content-Type':'application/json'}}),
  new Response('x'.repeat(5001),{status:200,headers:{'Content-Type':'application/json'}})
 ])await assert.rejects(()=>lookupTfgBooking('ABCD1234',async()=>response));
});

test('TFG 429 is reported distinctly so the driver avoids immediate retries',async()=>{
 await assert.rejects(()=>lookupTfgBooking('ABCD1234',async()=>new Response(JSON.stringify({error:'RATE_LIMITED'}),{
  status:429,headers:{'Content-Type':'application/json','Retry-After':'60'}})),/TFG_RATE_LIMITED/);
});
