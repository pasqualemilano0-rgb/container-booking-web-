import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedDeliveryPlace,tfgScheduleDelivery,conatecoForecastDelivery,conatecoDepotAcceptance} from '../delivery_location.mjs';

test('TFG riconosce luoghi dichiarati nel programma senza inventarli',()=>{
 for(const value of ['INTERNO PORTO','DRYPORT','GENERAL CARGO','LUOGO APPROVATO',
   'RETROPORTO','EX SUD CONTAINER']){
  const x=tfgScheduleDelivery({destination:value});
  assert.equal(x.value,value);
  assert.equal(x.known,true);
  assert.equal(x.terminal,'tfg');
  assert.equal(x.published,true);
  assert.equal(x.acquired_at,null);
  assert.equal(x.source_updated_at,null);
  assert.match(x.source,/PROGRAMMA TFG/);
 }
 assert.equal(publishedDeliveryPlace('DRY PORT'),'DRYPORT');
});
test('TFG usa solo row.destination e non deduce da note o booking',()=>{
 assert.equal(tfgScheduleDelivery({destination:'TERMINAL AREA B',notes:'DRYPORT'}).value,'TERMINAL AREA B');
 assert.equal(tfgScheduleDelivery({notes:'INTERNO PORTO',booking_place:'DRYPORT'}).known,false);
});
test('TFG campo vuoto, placeholder o HTML non è una destinazione',()=>{
 for(const p of ['','S','NO','ND','DA VERIFICARE','LUOGO NON PUBBLICATO','<script>bad</script>']){
  const place=tfgScheduleDelivery({destination:p});
  assert.equal(place.value,'LUOGO DA VERIFICARE');
  assert.equal(place.terminal,'tfg');
  assert.equal(place.published,false);
  assert.equal(place.known,false);
 }
});
test('CO.NA.TE.CO. S propone INTERNO PORTO / DRYPORT per la nave, senza autorizzare il booking',()=>{
 const now=new Date('2026-10-31T18:00:00Z');
 const recent={acquired_at:'2026-10-31T17:50:00Z'};
 const ext=conatecoForecastDelivery({external_depot:'S',notes:'ACCETT.RETROPORTO'},recent,now);
 assert.equal(ext.value,'INTERNO PORTO / DRYPORT');
 assert.deepEqual(ext.choices,['INTERNO PORTO','DRYPORT']);
 assert.equal(ext.terminal,'cnt');
 assert.equal(ext.scope,'vessel');
 assert.equal(ext.available,true);
 assert.equal(ext.acquired_at,recent.acquired_at);
 assert.equal(ext.source_updated_at,null);
 assert.equal(ext.known,false);
 assert.equal(ext.inferred,true);
 assert.equal(ext.externalNotice,true);
 assert.match(ext.note,/INDICAZIONE PRESUNTA/);
 assert.match(ext.source,/BERTH FORECAST/);
 assert.match(ext.note,/Berth Forecast segnala depositi esterni/);
 assert.match(ext.note,/non specifica il deposito esatto/);
 assert.match(ext.note,/né conferma l’autorizzazione del singolo booking/);
 const closedCargo=conatecoForecastDelivery({external_depot:'S',acceptance_flag:'0'},recent,now);
 assert.equal(closedCargo.value,'INTERNO PORTO / DRYPORT'); // NON significa carico aperto.
});
test('CO.NA.TE.CO. N o campo vuoto indica INTERNO PORTO solo come presunzione',()=>{
 const now=new Date('2026-10-31T18:00:00Z');
 const recent={acquired_at:'2026-10-31T17:50:00Z'};
 for(const flag of ['', 'N']){
  const place=conatecoForecastDelivery({external_depot:flag},recent,now);
  assert.equal(place.value,'INTERNO PORTO');
  assert.deepEqual(place.choices,['INTERNO PORTO']);
  assert.equal(place.available,true);
  assert.equal(place.scope,'vessel');
  assert.equal(place.inferred,true);
  assert.equal(place.known,false);
  assert.match(place.note,/NON conferma INTERNO PORTO/);
 }
});
test('CO.NA.TE.CO. non indica presunzioni con dati vecchi, errati o discordanti',()=>{
 const now=new Date('2026-10-31T18:00:00Z');
 const recent={acquired_at:'2026-10-31T17:50:00Z'};
 const stale={acquired_at:'2026-10-31T14:50:00Z'};
 const cases=[
  [{external_depot:'S'},stale],
  [{external_depot:''},stale],
  [{external_depot:'S',source_conflict:true},recent],
  [{external_depot:'UNKNOWN'},recent],
  [{external_depot:'S'},{}],
  [null,recent]
 ];
 for(const [row,feed] of cases){
  const place=conatecoForecastDelivery(row,feed,now);
  assert.equal(place.value,'LUOGO DA VERIFICARE');
  assert.equal(place.inferred,false);
 }
 assert.equal(conatecoForecastDelivery({external_depot:'S',destination:'INTERNO PORTO'},recent,now).value,
  'INTERNO PORTO / DRYPORT');
});
test('CO.NA.TE.CO. legge esattamente il campo accettazioneesterni',()=>{
 const now=new Date('2026-10-31T18:00:00Z');
 const recent={acquired_at:'2026-10-31T17:50:00Z'};
 const stale={acquired_at:'2026-10-31T15:00:00Z'};
 const reported=conatecoDepotAcceptance({external_depot:'S'},recent,now);
 assert.equal(reported.kind,'reported');
 assert.equal(reported.value,'OK');
 assert.match(reported.note,/non indica quale deposito/i);
 const old=conatecoDepotAcceptance({external_depot:'S'},stale,now);
 assert.equal(old.kind,'stale');
 assert.match(old.value,/RICONFERMARE/);
 assert.equal(conatecoDepotAcceptance({external_depot:'N'},recent,now).value,'NON SEGNALATA');
 assert.equal(conatecoDepotAcceptance({external_depot:''},recent,now).value,'NON INDICATA');
 assert.equal(conatecoDepotAcceptance({external_depot:'YES'},recent,now).kind,'unknown');
 assert.equal(conatecoDepotAcceptance({external_depot:'S',source_conflict:true},recent,now).kind,'unknown');
 assert.equal(conatecoForecastDelivery({external_depot:'S',destination:'DRYPORT'}).known,false);
});

test('CO.NA.TE.CO.: un vecchio N non significa nessun deposito esterno adesso',()=>{
 const now=new Date('2026-11-01T00:30:00Z');
 const stale={acquired_at:'2026-10-31T21:00:00Z'};
 const recent={acquired_at:'2026-11-01T00:28:00Z'};
 for(const flag of ['N','','S']){
  const status=conatecoDepotAcceptance({external_depot:flag},stale,now);
  assert.equal(status.kind,'stale');
  assert.match(status.value,/RICONFERMARE|DATI VECCHI/);
  assert.match(status.note,/troppo tempo fa/);
 }
 assert.equal(conatecoDepotAcceptance({external_depot:'N'},recent,now).value,'NON SEGNALATA');
 assert.equal(conatecoForecastDelivery({external_depot:'N'},stale,now).value,'LUOGO DA VERIFICARE');
});

test('CO.NA.TE.CO. opzioni per la nave conservano soglia 45 minuti, conflitti e flag sconosciuti',()=>{
 const now=new Date('2026-11-04T12:00:00Z');
 const boundary=new Date(now.getTime()-45*60000).toISOString();
 const fresh={acquired_at:boundary};
 assert.equal(conatecoForecastDelivery({external_depot:'S'},fresh,now).available,true);
 assert.equal(conatecoDepotAcceptance({external_depot:'S'},fresh,now).value,'OK');
 for(const [row,feed] of [
  [{external_depot:'S'},{acquired_at:new Date(now.getTime()-45*60000-1).toISOString()}],
  [{external_depot:'S'},{acquired_at:new Date(now.getTime()+300001).toISOString()}],
  [{external_depot:'S',source_conflict:true},fresh],
  [{external_depot:'UNKNOWN'},fresh],[{external_depot:'OK'},fresh],
  [{external_depot:'S'},{}],[{external_depot:'S'},null],[null,fresh]
 ]){
  const place=conatecoForecastDelivery(row,feed,now);
  assert.equal(place.value,'LUOGO DA VERIFICARE');assert.deepEqual(place.choices,[]);
  assert.equal(place.available,false);assert.equal(place.known,false);assert.equal(place.inferred,false);
  assert.equal(place.terminal,'cnt');assert.equal(place.scope,'vessel');
  assert.equal(place.acquired_at,feed?.acquired_at??null);assert.equal(place.source_updated_at,null);
  assert.notEqual(conatecoDepotAcceptance(row,feed,now).value,'OK');
 }
});
test('CO.NA.TE.CO. depot esterni OK e opzioni non sono accettazione o autorizzazione del carico',()=>{
 const now=new Date('2026-11-04T12:00:00Z');
 const feed={acquired_at:'2026-11-04T11:59:00Z',source_updated_at:'2026-11-04T11:50:00Z'};
 for(const extra of [{acceptance_flag:'0'},{stop_cargo:'S'},{acceptance_icon:'CHIUSA'},
  {vessel_status:'CHI'},{category:'PARTITE'}]){
  const row={external_depot:'S',...extra};
  const signal=conatecoDepotAcceptance(row,feed,now),place=conatecoForecastDelivery(row,feed,now);
  assert.equal(signal.kind,'reported');assert.equal(signal.value,'OK');
  assert.match(signal.note,/se il singolo booking sia abilitato/);
  assert.deepEqual(place.choices,['INTERNO PORTO','DRYPORT']);assert.equal(place.known,false);
  assert.equal(place.source_updated_at,null,'No terminal update time is invented from an unrelated field');
  for(const value of [signal,place])for(const key of ['accepted','authorized','booking_authorized','booking_verified'])
   assert.equal(key in value,false);
 }
});

test('TFG pubblicazione invariata resta valida dopo lettura diretta recente',()=>{
 const now=new Date('2026-11-04T12:00:00Z');
 const recent={acquired_at:'2026-11-04T11:59:00Z',source_updated_at:'2026-10-31T11:40:26Z',live:true};
 for(const destination of ['INTERNO PORTO','DRYPORT']){
  const place=tfgScheduleDelivery({destination},recent,now);
  assert.equal(place.value,destination);
  assert.equal(place.known,true);
  assert.equal(place.published,true);
  assert.equal(place.source_updated_at,recent.source_updated_at);
  assert.equal(place.source,'TERMINAL DI CONSEGNA · PROGRAMMA TFG');
  assert.match(place.note,/Non verifica il singolo booking/);
 }
 const oldRead={...recent,acquired_at:'2026-11-04T09:00:00Z'};
 const failed={...recent,live_failed:true};
 const fallback={...recent,live:false};
 for(const feed of [oldRead,failed,fallback,{...recent,source_updated_at:null},
   {...recent,source_updated_at:'2026-11-05T12:10:00Z'}]){
  const place=tfgScheduleDelivery({destination:'INTERNO PORTO'},feed,now);
  assert.equal(place.value,'INTERNO PORTO');
  assert.equal(place.known,false);
  assert.equal(place.published,true);
  assert.match(place.note,/NON confermato come attuale/);
  assert.match(place.source,/LETTURA DIRETTA NON CONFERMATA/);
 }
});

test('TFG valore pubblicato mantiene nome semplice, luogo da verificare con fallback',()=>{
 const now=new Date('2026-11-04T12:00:00Z');
 const recent={acquired_at:'2026-11-04T11:59:00Z',source_updated_at:'2026-10-30T11:50:00Z',live:true};
 for(const value of ['INTERNO PORTO','DRY PORT','TERMINAL AREA B']){
  const place=tfgScheduleDelivery({destination:value},recent,now);
  assert.equal(place.value,value==='DRY PORT'?'DRYPORT':value);
  assert.equal(place.terminal,'tfg');assert.equal(place.published,true);assert.equal(place.known,true);
  assert.equal(place.acquired_at,recent.acquired_at);assert.equal(place.source_updated_at,recent.source_updated_at);
  assert.equal(place.source,'TERMINAL DI CONSEGNA · PROGRAMMA TFG');
  assert.match(place.note,/Non verifica il singolo booking/);
 }
 for(const feed of [{},{...recent,acquired_at:undefined},{...recent,source_updated_at:undefined},
  {...recent,live_failed:true},{...recent,live:false},null]){
  const place=tfgScheduleDelivery({destination:'INTERNO PORTO'},feed,now);
  assert.equal(place.value,'INTERNO PORTO');assert.equal(place.published,true);
  assert.equal(place.known,false);assert.equal(place.inferred,false);
  assert.equal(place.acquired_at,feed?.acquired_at??null);
  assert.equal(place.source_updated_at,feed?.source_updated_at??null);
  assert.equal(place.source,'TERMINAL DI CONSEGNA · LETTURA DIRETTA NON CONFERMATA');
  assert.match(place.note,/NON confermato come attuale/);
 }
});
test('TFG solo acquisizione recente e data ufficiale valida: no soglia pubblicazione 90 minuti',()=>{
 const now=new Date('2026-11-04T12:00:00Z');
 const boundary=new Date(now.getTime()-90*60000).toISOString();
 const feed={acquired_at:boundary,source_updated_at:new Date(now.getTime()-9*24*3600000).toISOString(),live:true};
 const row={destination:'INTERNO PORTO'};
 assert.equal(tfgScheduleDelivery(row,feed,now).known,true);
 for(const [field,value] of [
  ['acquired_at',new Date(now.getTime()-90*60000-1).toISOString()],
  ['acquired_at',new Date(now.getTime()+300001).toISOString()],
  ['source_updated_at',new Date(now.getTime()+300001).toISOString()],
  ['source_updated_at','invalid']]){
  const place=tfgScheduleDelivery(row,{...feed,[field]:value},now);
  assert.equal(place.value,'INTERNO PORTO');assert.equal(place.known,false);assert.equal(place.published,true);
 }
 const absent=tfgScheduleDelivery({notes:'INTERNO PORTO',booking_place:'DRYPORT'},feed,now);
 assert.equal(absent.value,'LUOGO DA VERIFICARE');assert.equal(absent.known,false);assert.equal(absent.published,false);
 assert.equal(absent.terminal,'tfg');assert.equal(absent.acquired_at,boundary);
});
