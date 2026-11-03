import test from 'node:test';
import assert from 'node:assert/strict';
import {matchTfgVoyage,isTfgFeedFresh,evaluateTfgSchedule,tfgDateTime} from '../tfg_schedule.mjs';

const booking={usable:true,vessel:'SAGARMALA',voyage:'645W'};
const row={vessel:'X PRESS SAGARMALA',arrival_voyage:'644E',departure_voyage:'645W',
  acceptance:'CARICO DAL 30/10/26 08:00:00',cut_off:'',destination:'INTERNO PORTO'};
const now=new Date('2026-10-31T09:00:00Z');
const feed={acquired_at:'2026-10-31T08:45:00Z',source_updated_at:'2026-10-31T08:40:00Z',rows:[row]};
test('TFG associa il viaggio di partenza 645W',()=>{
  const r=matchTfgVoyage(booking,feed);
  assert.equal(r.kind,'match');
  assert.equal(r.row.departure_voyage,'645W');
  assert.equal(r.row.arrival_voyage,'644E');
});
test('TFG non confonde viaggio di arrivo e partenza',()=>{
  assert.equal(matchTfgVoyage({...booking,voyage:'644E'},feed).kind,'not-found');
});
test('TFG non collega navi diverse solo per viaggio',()=>{
  assert.equal(matchTfgVoyage({...booking,vessel:'OTHER SHIP'},feed).kind,'not-found');
});
test('TFG segnala duplicati ambigui',()=>{
  assert.equal(matchTfgVoyage(booking,{...feed,rows:[row,row]}).kind,'ambiguous');
});
test('TFG non usa dati del booking non verificati',()=>{
  assert.equal(matchTfgVoyage({...booking,usable:false},feed).kind,'unavailable');
});
test('TFG distingue pubblicazione vecchia e acquisizione vecchia',()=>{
  assert.equal(isTfgFeedFresh(feed,now),true);
  assert.equal(isTfgFeedFresh({...feed,source_updated_at:'2026-10-30T11:21:14+01:00'},now),true);
 assert.equal(isTfgFeedFresh({...feed,acquired_at:'2026-10-30T08:00:00Z'},now),false);
  assert.equal(evaluateTfgSchedule(row,{...feed,acquired_at:null},now).kind,'unknown');
});
test('TFG CARICO DAL senza cut-off non diventa verde',()=>{
  const r=evaluateTfgSchedule(row,feed,now);
  assert.equal(r.kind,'warn');
  assert.match(r.label,/CARICO DAL/);
});
test('TFG NON ACCETTA CARICO ha precedenza',()=>{
  assert.equal(evaluateTfgSchedule({...row,acceptance:'NON ACCETTA CARICO'},feed,now).kind,'bad');
});
test('TFG NAVE CHIUSA ha precedenza',()=>{
  assert.equal(evaluateTfgSchedule({...row,acceptance:'NAVE CHIUSA'},feed,now).kind,'bad');
});
test('TFG cut-off scaduto prevale su ACCETTA CARICO',()=>{
  const r=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'30/10/26 15:00:00'},feed,now);
  assert.equal(r.label,'CUT-OFF SCADUTO');
});
test('TFG con cut-off futuro e lettura diretta verificabile',()=>{
  const r=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'01/11/26 15:00:00'},{...feed,live:true},now);
  assert.equal(r.kind,'good');
});
test('TFG apertura futura non è operativa',()=>{
  const r=evaluateTfgSchedule({...row,acceptance:'CARICO DAL 01/11/26 08:00:00'},feed,now);
  assert.equal(r.kind,'bad');
});
test('TFG date e ore validate',()=>{
  assert.equal(tfgDateTime('30/10/26 08:00:00'),'2026-10-30T08:00');
  assert.equal(tfgDateTime('31/02/26 08:00'),null);
});


test('TFG lettura diretta: ACCETTA CARICO conferma lo stato nave anche dopo 90 minuti',()=>{
  const stale={
    ...feed, live:true,
    acquired_at:'2026-10-31T08:59:00Z',
    source_updated_at:'2026-10-31T05:40:00Z'
  };
  assert.equal(isTfgFeedFresh(stale,now),true);
  const result=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'01/11/26 15:00:00'},stale,now);
  assert.equal(result.kind,'good');
  assert.equal(result.label,'ACCETTA CARICO');
  assert.match(result.reason,/letto ora/i);
});
test('TFG copia vecchia resta segnalata PROGRAMMA NON AGGIORNATO',()=>{
  const stale={...feed,acquired_at:'2026-10-30T08:00:00Z',source_updated_at:'2026-10-30T08:00:00Z',live:false};
  const result=evaluateTfgSchedule(row,stale,now);
  assert.equal(result.kind,'unknown');
  assert.equal(result.label,'PROGRAMMA NON AGGIORNATO');
});
test('TFG live senza data acquisizione non è affidabile',()=>{
  const broken={...feed,acquired_at:null,live:true};
  assert.equal(evaluateTfgSchedule(row,broken,now).label,'PROGRAMMA NON AGGIORNATO');
});

test('TFG lettura diretta: nave chiusa pubblicata resta riconoscibile, mai verde',()=>{
  const stale={...feed,live:true,acquired_at:'2026-10-31T08:59:00Z',source_updated_at:'2026-10-31T05:40:00Z'};
  const verdict=evaluateTfgSchedule({...row,acceptance:'NAVE CHIUSA'},stale,now);
  assert.equal(verdict.kind,'bad');
  assert.equal(verdict.label,'NON ACCETTA CARICO');
});
test('TFG lettura diretta: cut-off pubblicato scaduto non appare in accettazione',()=>{
  const stale={...feed,live:true,acquired_at:'2026-10-31T08:59:00Z',source_updated_at:'2026-10-31T05:40:00Z'};
  const verdict=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'30/10/26 10:00'},stale,now);
  assert.equal(verdict.kind,'bad');
  assert.equal(verdict.label,'CUT-OFF SCADUTO');
});
test('TFG lettura diretta: apertura futura non ancora operativa con pubblicazione invariata',()=>{
  const stale={...feed,live:true,acquired_at:'2026-10-31T08:59:00Z',source_updated_at:'2026-10-31T05:40:00Z'};
  const verdict=evaluateTfgSchedule({...row,acceptance:'CARICO DAL 03/11/26 08:00:00'},stale,now);
  assert.equal(verdict.kind,'bad');
  assert.equal(verdict.label,'NON ANCORA APERTA');
});
test('TFG richiesta diretta aggiornata: risultato verde solo quando fonte recente e cutoff futuro',()=>{
  const recent={...feed,live:true};
  const verdict=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'01/11/26 15:00:00'},recent,now);
  assert.equal(verdict.kind,'good');
});

test('Fast Corridor scaduto NON equivale a chiusura generale nave',()=>{
  const item={...row,acceptance:'ACCETTA CARICO',
    cut_off:'30/10/26 11:00',fast_corridor_cut_off:'30/10/26 11:00',
    custom_close_time:'02/11/26 15:00',gate_cut_off:''};
  const verdict=evaluateTfgSchedule(item,feed,now);
  assert.equal(verdict.kind,'warn');
  assert.equal(verdict.label,'TFG PUBBLICA ACCETTA CARICO');
});
test('TFG CUSTOM CLOSE TIME non è automaticamente il cut-off gate export',()=>{
  const item={...row,acceptance:'ACCETTA CARICO',
    custom_close_time:'30/10/26 10:00',fast_corridor_cut_off:'30/10/26 09:00',gate_cut_off:''};
  assert.notEqual(evaluateTfgSchedule(item,feed,now).kind,'bad');
  assert.notEqual(evaluateTfgSchedule(item,feed,now).kind,'good');
});

test('TFG: fallback LIVE fallito non diventa mai verde anche con fonte recente',()=>{
 const failed={...feed,live:false,live_failed:true};
 const vessel={...row,acceptance:'ACCETTA CARICO',gate_cut_off:'01/11/26 15:00:00'};
 const verdict=evaluateTfgSchedule(vessel,failed,now);
 assert.equal(verdict.kind,'unknown');
 assert.equal(verdict.label,'VERIFICA NON DISPONIBILE');
});
test('TFG: una nuova lettura riuscita elimina l’avviso errore',()=>{
 const ok={...feed,live:true,live_failed:false};
 assert.equal(evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:''},ok,now).kind,'good');
});

test('TFG lettura diretta: ACCETTA CARICO senza cut-off è conferma della nave',()=>{
 const current={...feed,live:true,acquired_at:'2026-10-31T08:59:00Z',source_updated_at:'2026-10-31T05:40:00Z'};
 const v=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:''},current,now);
 assert.equal(v.kind,'good');
 assert.equal(v.label,'ACCETTA CARICO');
 assert.match(v.reason,/Non costituisce conferma del singolo booking/);
});
test('TFG ACCETTA CARICO resta verde dopo 48 ore con nuova lettura',()=>{
 const old={...feed,live:true,acquired_at:'2026-10-31T08:59:00Z',source_updated_at:'2026-10-29T05:40:00Z'};
 const v=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO'},old,now);
 assert.equal(v.kind,'good');
 assert.equal(v.label,'ACCETTA CARICO');
});
test('TFG copia periodica senza lettura live non è una conferma verde',()=>{
 const copy={...feed,live:false};
 assert.notEqual(evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO'},copy,now).kind,'good');
});
test('TFG dato di fonte nel futuro non è una conferma',()=>{
 const suspicious={...feed,live:true,source_updated_at:'2026-11-01T08:00:00Z'};
 assert.notEqual(evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO'},suspicious,now).kind,'good');
});
test('TFG cut-off generale scaduto e chiusura prevalgono sempre sullo stato positivo',()=>{
 const direct={...feed,live:true};
 const cutoff=evaluateTfgSchedule({...row,acceptance:'ACCETTA CARICO',gate_cut_off:'30/10/26 12:00:00'},direct,now);
 assert.equal(cutoff.kind,'bad');
 const closed=evaluateTfgSchedule({...row,acceptance:'NAVE CHIUSA'},direct,now);
 assert.equal(closed.kind,'bad');
});

test('TFG lettura diretta: pubblicazioni di 30h, 47h59m e 48h restano ACCETTA CARICO verde',()=>{
 const checkedAt=new Date('2026-11-04T12:00:00Z');
 const vessel={vessel:'TFG TEST SHIP',departure_voyage:'QA01',acceptance:'ACCETTA CARICO'};
 for(const age of [30*3600000,47*3600000+59*60000,48*3600000]){
  const direct={live:true,acquired_at:'2026-11-04T11:59:00Z',
   source_updated_at:new Date(checkedAt.getTime()-age).toISOString(),rows:[vessel]};
  const verdict=evaluateTfgSchedule(vessel,direct,checkedAt);
  assert.equal(verdict.kind,'good',String(age));
  assert.equal(verdict.label,'ACCETTA CARICO');
  assert.equal(isTfgFeedFresh(direct,checkedAt),true,'Old publication is acceptable after direct read');
  assert.match(verdict.reason,/Non costituisce conferma del singolo booking/);
 }
});
test('TFG nuova lettura con pubblicazione vecchia di 7 giorni non è obsoleta',()=>{
 const checkedAt=new Date('2026-11-04T12:00:00Z');
 const vessel={vessel:'TFG TEST SHIP',departure_voyage:'QA01',acceptance:'ACCETTA CARICO'};
 for(const age of [48*3600000+1,72*3600000,7*24*3600000]){
  const direct={live:true,acquired_at:'2026-11-04T11:59:00Z',
   source_updated_at:new Date(checkedAt.getTime()-age).toISOString(),rows:[vessel]};
  assert.equal(evaluateTfgSchedule(vessel,direct,checkedAt).kind,'good',String(age));
 }
 for(const sourceUpdated of [null,undefined,'non interpretabile',new Date(checkedAt.getTime()+300001).toISOString()]){
  const direct={live:true,acquired_at:'2026-11-04T11:59:00Z',
   source_updated_at:sourceUpdated,rows:[vessel]};
  const verdict=evaluateTfgSchedule(vessel,direct,checkedAt);
  assert.equal(verdict.kind,'warn',String(sourceUpdated));
  assert.equal(verdict.label,'ACCETTAZIONE DA RICONFERMARE');
 }
});
test('TFG nuova lettura non allenta verifiche su fallback, chiusure o cut-off',()=>{
 const checkedAt=new Date('2026-11-04T12:00:00Z');
 const vessel={vessel:'TFG TEST SHIP',departure_voyage:'QA01',acceptance:'ACCETTA CARICO'};
 const direct={live:true,acquired_at:'2026-11-04T11:59:00Z',
  source_updated_at:'2026-11-03T06:00:00Z',rows:[vessel]};
 for(const fields of [{live:false},{live:false,live_failed:true},{live:true,live_failed:true},
  {acquired_at:null},{acquired_at:'2026-11-04T10:29:59.999Z'},
  {acquired_at:'2026-11-04T12:05:00.001Z'}]){
  const verdict=evaluateTfgSchedule(vessel,{...direct,...fields},checkedAt);
  assert.notEqual(verdict.kind,'good',JSON.stringify(fields));
  assert.equal(verdict.label.includes('DATO VECCHIO'),false);
 }
 for(const acceptance of ['NON ACCETTA CARICO','NAVE CHIUSA','IMBARCO CHIUSO'])
  assert.equal(evaluateTfgSchedule({...vessel,acceptance},direct,checkedAt).kind,'bad');
 const cutoff=evaluateTfgSchedule({...vessel,gate_cut_off:'04/11/26 12:00'},direct,checkedAt);
 assert.equal(cutoff.kind,'bad');assert.equal(cutoff.label,'CUT-OFF SCADUTO');
});
test('TFG CARICO DAL resta valido con pubblicazione vecchia e conserva i requisiti',()=>{
 const checkedAt=new Date('2026-11-04T12:00:00Z');
 const vessel={vessel:'TFG TEST SHIP',departure_voyage:'QA01',
  acceptance:'CARICO DAL 01/11/26 08:00',gate_cut_off:'05/11/26 18:00'};
 for(const age of [30*3600000,48*3600000,48*3600000+1]){
  const direct={live:true,acquired_at:'2026-11-04T11:59:00Z',
   source_updated_at:new Date(checkedAt.getTime()-age).toISOString(),rows:[vessel]};
  const verdict=evaluateTfgSchedule(vessel,direct,checkedAt);
  assert.equal(verdict.kind,'good');
  assert.equal(verdict.label,'CARICO APERTO (NAVE)');
  assert.notEqual(evaluateTfgSchedule({...vessel,gate_cut_off:''},direct,checkedAt).kind,'good');
  assert.notEqual(evaluateTfgSchedule({...vessel,acceptance:'CARICO DAL 05/11/26 08:00'},direct,checkedAt).kind,'good');
 }
});
