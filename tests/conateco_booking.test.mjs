import test from 'node:test';
import assert from 'node:assert/strict';
import {CONATECO_BOOKING_ENDPOINT,lookupConatecoBooking,parseConatecoBooking,matchConatecoBookingToSchedule,
 matchConatecoVesselToForecast} from '../conateco_booking.mjs';

const empty=()=>({ReturnCode:-1,ReturnMessage:'Si è verificato un errore di conversione.',
 B_NOMNAVE:null,B_ETA:null});
const found=(more={})=>({ReturnCode:0,ReturnMessage:'',
 B_NOMNAVE:'MSC TEST SHIP',B_ETA:'04/11/26 08:00',...more});

test('API ufficiale: un HTTP 200 con ReturnCode negativo non è booking verificato',()=>{
 const x=parseConatecoBooking(empty());
 assert.equal(x.kind,'error');
 assert.equal(x.vessel,'');
 assert.match(x.message,/errore/);
});
test('API ufficiale: dati nave ed ETA estratti, MAI accettazione o destinazione inventata',()=>{
 const x=parseConatecoBooking(found());
 assert.equal(x.kind,'vessel-found');
 assert.equal(x.vessel,'MSC TEST SHIP');
 assert.equal(x.eta,'04/11/26 08:00');
 assert.equal('accepted' in x,false);
 assert.equal('destination' in x,false);
 assert.equal('booking_verified' in x,false);
});
test('API ufficiale: non confermare risposta incompleta o con nome non sicuro',()=>{
 for(const data of [
  {ReturnCode:0,ReturnMessage:'',B_NOMNAVE:null,B_ETA:null},
  {ReturnCode:0,ReturnMessage:'',B_NOMNAVE:'<script>bad</script>',B_ETA:'04/11/26'},
  {ReturnCode:'UNKNOWN',ReturnMessage:'',B_NOMNAVE:'MSC TEST SHIP'},
  {},
  [],
  null
 ]){
  assert.notEqual(parseConatecoBooking(data).kind,'vessel-found');
 }
});
test('API ufficiale: dati ambigui e tipi insicuri non escono nei risultati',()=>{
 const x=parseConatecoBooking(found({B_ETA:'<img onerror=alert(1) />'}));
 assert.equal(x.kind,'vessel-found');
 assert.equal(x.eta,'Non indicata');
});
test('ricerca trasmette il booking soltanto al dominio ufficiale con TLS, senza credenziali',async()=>{
 const seen=[];
 const fetcher=async(url,opts)=>{
  seen.push({url,opts});
  return new Response(JSON.stringify(found()),{status:200,
    headers:{'Content-Type':'application/json'}});
 };
 const value=await lookupConatecoBooking(' ebkg 00000000 ',fetcher);
 assert.equal(value.kind,'vessel-found');
 const url=new URL(seen[0].url);
 assert.equal(url.origin,'https://api.conateco.it');
 assert.equal(url.pathname,'/ConatecoServicesApi/Booking');
 assert.equal(url.searchParams.get('id_booking'),'EBKG00000000');
 assert.equal(seen[0].opts.method,'GET');
 assert.equal(seen[0].opts.credentials,'omit');
 assert.equal(seen[0].opts.redirect,'error');
 assert.equal(seen[0].opts.cache,'no-store');
 assert.equal(seen[0].opts.referrerPolicy,'no-referrer');
 assert.equal(CONATECO_BOOKING_ENDPOINT,url.origin+url.pathname);
});
test('risposta anomala o errore server non viene considerato trovato',async()=>{
 for(const response of [
  new Response('no',{status:503,headers:{'Content-Type':'text/html'}}),
  new Response('bad',{status:200,headers:{'Content-Type':'text/plain'}}),
  new Response('{bad',{status:200,headers:{'Content-Type':'application/json'}})
 ]){
  await assert.rejects(()=>lookupConatecoBooking('QA0001',async()=>response));
 }
});

test('CO.NA.TE.CO. codici nonnegativi sono metadati: la nave valida determina il risultato',()=>{
 for(const code of [0,1,2,200,'0','1','2','200',' 2 ']){
  const response=parseConatecoBooking(found({ReturnCode:code}));
  assert.equal(response.kind,'vessel-found',String(code));
  assert.equal(response.vessel,'MSC TEST SHIP');
  assert.equal('accepted' in response,false);
  assert.equal('booking_verified' in response,false);
  assert.equal('destination' in response,false);
  for(const vessel of [null,undefined,'','NULL','N/A','N/D','—','UNKNOWN','NON DISPONIBILE',
   'Non indicata','DA   VERIFICARE','NOT AVAILABLE','<script>bad</script>',
   'MSC\nTEST SHIP','A'.repeat(91),123,true,{},[]]){
   const invalid=parseConatecoBooking(found({ReturnCode:code,B_NOMNAVE:vessel}));
   assert.equal(invalid.kind,'unverified',String(code)+' / '+String(vessel));
   assert.equal(invalid.vessel,'');
  }
 }
});
test('CO.NA.TE.CO. ReturnCode mancante o nullo non nasconde una nave valida',()=>{
 const withoutCode=found();delete withoutCode.ReturnCode;
 for(const data of [withoutCode,found({ReturnCode:null})]){
  const response=parseConatecoBooking(data);
  assert.equal(response.kind,'vessel-found');
  assert.equal(response.vessel,'MSC TEST SHIP');
  for(const vessel of [null,'UNKNOWN','NON DISPONIBILE','NON INDICATA','DA VERIFICARE'])
   assert.equal(parseConatecoBooking({...data,B_NOMNAVE:vessel}).kind,'unverified');
 }
});
test('CO.NA.TE.CO. metadati ReturnCode presenti ma malformati non sono convertiti in successo',()=>{
 for(const code of [true,false,undefined,'',' ','0.0','1.0','1e0','NaN',NaN,Infinity,
  1.5,Number.MAX_SAFE_INTEGER+1,'9007199254740993',{},[],[1]]){
  const response=parseConatecoBooking({ReturnCode:code,ReturnMessage:'',B_NOMNAVE:'MSC TEST SHIP',B_ETA:'04/11/26 08:00'});
  assert.equal(response.kind,'unverified',String(code));
  assert.equal(response.vessel,'');
 }
});
test('CO.NA.TE.CO. errore negativo resta errore anche con nave e mostra il codice se manca il messaggio',()=>{
 for(const code of [-1,-2,'-1','-2']){
  const response=parseConatecoBooking(found({ReturnCode:code,ReturnMessage:''}));
  assert.equal(response.kind,'error');assert.equal(response.vessel,'');
  assert.match(response.message,new RegExp('codice '+Number(code)+'\\)'));
 }
 assert.equal(parseConatecoBooking(found({ReturnCode:-1,ReturnMessage:'Errore comunicato dal terminal'})).message,
  'Errore comunicato dal terminal');
});
test('CO.NA.TE.CO. nave valida con metadati positivi non dipende da ETA o autorizzazioni',()=>{
 for(const eta of [undefined,null,'20261104250000','20261104080000']){
  const result=parseConatecoBooking(found({ReturnCode:2,B_ETA:eta}));
  assert.equal(result.kind,'vessel-found');assert.equal(result.vessel,'MSC TEST SHIP');
  assert.equal(result.eta,eta==='20261104080000'?'04/11/2026 08:00':'Non indicata');
  for(const key of ['accepted','authorized','booking_authorized','booking_verified','destination'])
   assert.equal(key in result,false);
 }
});

test('CO.NA.TE.CO. un booking non deve essere associato a un viaggio solo per nome nave',()=>{
 const feed={rows:[
  {vessel:'MSC TEST SHIP',eta:'2026-11-04 00:00',voyage:'A1',external_depot:'S'},
  {vessel:'MSC TEST SHIP',eta:'2026-11-09 00:00',voyage:'B2',external_depot:'N'}
 ]};
 const booking={vessel:'MSC TEST SHIP',eta:'04/11/26 08:00'};
 const matching=matchConatecoBookingToSchedule(booking,feed);
 assert.equal(matching.kind,'match');
 assert.equal(matching.row.voyage,'A1');
 assert.equal(matchConatecoBookingToSchedule({...booking,eta:'10/11/26 08:00'},feed).kind,'not-found');
 assert.equal(matchConatecoBookingToSchedule({...booking,eta:'Non indicata'},feed).kind,'unverified');
 assert.equal(matchConatecoBookingToSchedule({...booking,eta:'31/02/26 10:00'},feed).kind,'unverified');
 assert.equal(matchConatecoBookingToSchedule(booking,{rows:[...feed.rows,feed.rows[0]]}).kind,'ambiguous');
 assert.equal(matchConatecoBookingToSchedule({...booking,vessel:'ALTRO'},feed).kind,'not-found');
});

test('ETA compatta stringa e numero sicuro diventano leggibili senza conversione del fuso',()=>{
 for(const eta of ['20261104080000',20261104080000,' 20261104080000 ']){
  const result=parseConatecoBooking(found({B_ETA:eta}));
  assert.equal(result.kind,'vessel-found');
  assert.equal(result.vessel,'MSC TEST SHIP');
  assert.equal(result.eta,'04/11/2026 08:00');
 }
 assert.equal(parseConatecoBooking(found({B_ETA:'20261104080509'})).eta,'04/11/2026 08:05:09');
 // A wall-clock time is retained even during a local daylight-saving transition.
 assert.equal(parseConatecoBooking(found({B_ETA:'20260329023000'})).eta,'29/03/2026 02:30');
 for(const eta of ['2026-11-04 08:00','04/11/26 08:00','04/11/2026 08:00'])
  assert.equal(parseConatecoBooking(found({B_ETA:eta})).eta,eta);
});
test('ETA compatta: calendario, bisestili e orari invalidi non sono corretti automaticamente',()=>{
 const feed={rows:[{vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1'}]};
 for(const eta of ['20260229080000','20260230080000','20261131080000','20260004080000',
  '20261304080000','20261100080000','00001104080000','20261104240000',
  '20261104086000','20261104080060','2026110408000','202611040800000',
  Number.MAX_SAFE_INTEGER+1,NaN,Infinity,20261104080000.5]){
  const parsed=parseConatecoBooking(found({B_ETA:eta}));
  assert.equal(parsed.kind,'vessel-found','The returned ship remains independent of ETA validity');
  assert.equal(parsed.eta,'Non indicata',String(eta));
  assert.equal(matchConatecoBookingToSchedule({vessel:'MSC TEST SHIP',eta},feed).kind,'unverified',String(eta));
  assert.equal(matchConatecoBookingToSchedule(parsed,feed).kind,'unverified',String(eta));
 }
 for(const [eta,day,valid] of [['20280229080000','2028-02-29',true],
  ['20000229080000','2000-02-29',true],['21000229080000','2100-03-01',false]]){
  const parsed=parseConatecoBooking(found({B_ETA:eta}));
  const matching=matchConatecoBookingToSchedule(parsed,{rows:[{vessel:'MSC TEST SHIP',eta:day,voyage:'QA1'}]});
  assert.equal(matching.kind,valid?'match':'unverified');
 }
});
test('ETA compatta e display normalizzato richiedono stessa nave, stesso giorno e un viaggio univoco',()=>{
 const matching={vessel:'MSC TEST SHIP',eta:'2026-11-04 00:00',voyage:'QA1'};
 const otherDay={vessel:'MSC TEST SHIP',eta:'2026-11-05 08:00',voyage:'QA2'};
 const raw={vessel:'MSC TEST SHIP',eta:'20261104080000'};
 const parsed=parseConatecoBooking(found({B_ETA:raw.eta}));
 for(const booking of [raw,{...raw,vessel:'MSCTESTSHIP'},{...raw,eta:20261104080000},parsed]){
  assert.equal(matchConatecoBookingToSchedule(booking,{rows:[matching,otherDay]}).row,matching);
  assert.equal(matchConatecoBookingToSchedule(booking,{rows:[otherDay]}).kind,'not-found');
  assert.equal(matchConatecoBookingToSchedule(booking,{rows:[matching,{...matching,voyage:'QA3'}]}).kind,'ambiguous');
  assert.equal(matchConatecoBookingToSchedule({...booking,vessel:''},{rows:[matching]}).kind,'unverified');
 }
 assert.equal(matchConatecoBookingToSchedule(raw,{rows:[{...matching,eta:'20261104250000'}]}).kind,'not-found');
});

test('stato nave: nome esatto normalizzato può selezionare una nave corrente senza ETA compatibile',()=>{
 const row={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1',category:'PREVISTE'};
 const feed={rows:[row]};
 for(const vessel of ['MSCTESTSHIP','msc test ship','MSC-TEST.SHIP']){
  for(const eta of [undefined,'Non indicata','05/11/26 08:00','20261105240000']){
   const data={vessel,eta};
   const selected=matchConatecoVesselToForecast(data,feed);
   assert.deepEqual(selected,{kind:'match',row,basis:'vessel-name'});
   assert.notEqual(matchConatecoBookingToSchedule(data,feed).kind,'match',
    'Vessel-state selection must not relax the booking voyage/destination match');
   assert.deepEqual(Object.keys(selected).sort(),['basis','kind','row']);
  }
 }
});
test('stato nave: una riga corrente precede lo storico soltanto quando ETA non risolve',()=>{
 const historical={vessel:'MSC TEST SHIP',eta:'2026-10-04 08:00',voyage:'QA1',category:'PARTITE'};
 const current={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA2',category:'PRESENTI'};
 const feed={rows:[historical,current]};
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSCTESTSHIP'},feed),
  {kind:'match',row:current,basis:'vessel-name'});
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSCTESTSHIP',eta:'04/10/26 08:00'},feed),
  {kind:'match',row:historical,basis:'vessel-and-eta'});
 const duplicateHistory={...historical,voyage:'QA3',acceptance_flag:'1'};
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSC TEST SHIP',eta:'04/10/26 08:00'},
  {rows:[historical,duplicateHistory,current]}),{kind:'ambiguous',row:null});
});
test('stato nave: due viaggi correnti richiedono ETA risolutiva, nessuna scelta arbitraria',()=>{
 const first={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1',category:'PRESENTI'};
 const second={...first,eta:'2026-11-05 08:00',voyage:'QA2',category:'PREVISTE'};
 const feed={rows:[first,second]};
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSC TEST SHIP',eta:'20261105080000'},feed),
  {kind:'match',row:second,basis:'vessel-and-eta'});
 for(const eta of [undefined,'06/11/26 08:00'])
  assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSC TEST SHIP',eta},feed),
   {kind:'ambiguous',row:null});
});
test('stato nave: righe sconosciute, conflitti e duplicati non vengono scartati per creare unicità',()=>{
 const known={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1',
  category:'PRESENTI',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO'};
 const unknown={vessel:'MSC TEST SHIP',eta:'2026-11-05 08:00',voyage:'QA2',source_conflict:true};
 const data={vessel:'MSC TEST SHIP'};
 for(const rows of [[known,unknown],[known,{...known,acceptance_flag:'0'}],[known,known]])
  assert.deepEqual(matchConatecoVesselToForecast(data,{rows}),{kind:'ambiguous',row:null});
 assert.deepEqual(matchConatecoVesselToForecast(data,{rows:[unknown]}),
  {kind:'match',row:unknown,basis:'vessel-name'},'State evaluation must see the original unknown/conflicting row');
 assert.deepEqual(matchConatecoVesselToForecast({...data,eta:'04/11/26 08:00'},
  {rows:[known,{...known,acceptance_flag:'0'}]}),{kind:'ambiguous',row:null});
});
test('stato nave: unica riga partita/chiusa resta selezionabile, più righe storiche sono ambigue',()=>{
 const data={vessel:'MSC TEST SHIP'};
 const base={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1'};
 for(const closed of [{...base,category:'PARTITE'},{...base,vessel_status:'CHI'},
  {...base,acceptance_icon:'CHIUSA'}]){
  assert.deepEqual(matchConatecoVesselToForecast(data,{rows:[closed]}),
   {kind:'match',row:closed,basis:'vessel-name'});
  assert.deepEqual(matchConatecoVesselToForecast(data,{rows:[closed,{...closed,voyage:'QA2'}]}),
   {kind:'ambiguous',row:null});
 }
});
test('stato nave: nessun fuzzy matching, nave mancante o feed invalido restano non verificati',()=>{
 const feed={rows:[{vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1'}]};
 for(const vessel of ['MSC TEST SHIP II','MSC TEST SHI','MSC TEST SHIP EXTRA'])
  assert.deepEqual(matchConatecoVesselToForecast({vessel},feed),{kind:'not-found',row:null});
 assert.deepEqual(matchConatecoVesselToForecast({},feed),{kind:'unverified',row:null});
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSC TEST SHIP'},null),{kind:'unverified',row:null});
 assert.deepEqual(matchConatecoVesselToForecast({vessel:'MSC TEST SHIP'},{rows:[]}),{kind:'not-found',row:null});
});

test('CNT associa il viaggio solo con data e orario ETA realmente interpretabili',()=>{
 const row={vessel:'MSC TEST SHIP',eta:'2026-11-04 08:00',voyage:'QA1',category:'PREVISTE'};
 const data={vessel:'MSC TEST SHIP',eta:'04/11/26 08:00'};
 for(const eta of ['2026-11-04 08:00','2026-11-04 08:00:59','04/11/26 08:00',
   '04/11/2026, 08:00','20261104080000','2026-11-04']){
  assert.equal(matchConatecoBookingToSchedule({...data,eta},{rows:[row]}).kind,'match',eta);
 }
 for(const eta of ['2026-11-04 BAD','2026-11-04 25:00','2026-11-04 08:61',
   '2026-11-04 08:00:61','2026-11-04T08:00garbage','04/11/26 N/A',
   '04/11/26 24:00','04/11/26 08:70','04/11/26 08:00:91',
   '2026-11-04T08:00Z','04/11/26, 09:00 booking verificato']){
  const matching=matchConatecoBookingToSchedule({...data,eta},{rows:[row]});
  assert.equal(matching.kind,'unverified',eta);
 }
 for(const eta of ['2026-11-04 25:00','2026-11-04 08:75','2026-11-04 extra',
   '04/11/26 08:00:99']){
  const matching=matchConatecoBookingToSchedule(data,{rows:[{...row,eta}]});
  assert.equal(matching.kind,'not-found',eta);
 }
});
test('CNT non attribuisce un viaggio se il Berth Forecast non ne pubblica un ID valido',()=>{
 const data={vessel:'MSC TEST SHIP',eta:'04/11/26 08:00'};
 const row={vessel:data.vessel,eta:'2026-11-04 08:00',category:'PREVISTE'};
 for(const voyage of [undefined,null,'','N/D','N/A','UNKNOWN','NON INDICATO','DA VERIFICARE']){
  const feed={rows:[{...row,voyage}]};
  assert.equal(matchConatecoBookingToSchedule(data,feed).kind,'unverified',String(voyage));
  assert.deepEqual(matchConatecoVesselToForecast(data,feed),{
   kind:'match',row:feed.rows[0],basis:'vessel-name'});
 }
 const conflict={...row,voyage:'QA1',source_conflict:true};
 assert.equal(matchConatecoBookingToSchedule(data,{rows:[conflict]}).kind,'unverified');
 assert.deepEqual(matchConatecoVesselToForecast(data,{rows:[conflict]}),{
  kind:'match',row:conflict,basis:'vessel-name'});
 assert.equal(matchConatecoBookingToSchedule(data,{rows:[row,{...row,voyage:'QA1'}]}).kind,'ambiguous',
  'A missing voyage must not be ignored in order to choose another');
});
