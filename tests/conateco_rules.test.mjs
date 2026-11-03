import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateConateco,isConatecoRecent} from '../conateco_rules.mjs';

const now=new Date('2026-10-31T10:00:00Z'); // 11:00 Europe/Rome
const feed={acquired_at:'2026-10-31T09:50:00Z',rows:[]};
const row={
 vessel:'MSC GRETA III',voyage:'AC643A',vessel_status:'PRE',category:'PREVISTE',
 acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
 stop_cargo:'',opening:'2026-10-27 12:00',closing:'2026-11-02 17:00',
 eta:'2026-11-02 00:00',source_conflict:false,external_depot:''
};
test('positive signal with valid future closing only',()=>{
 assert.equal(evaluateConateco(row,feed,now).kind,'good');
});
test('stale data never green',()=>{
 assert.equal(evaluateConateco(row,{...feed,acquired_at:'2026-10-31T08:00:00Z'},now).kind,'unknown');
 assert.equal(isConatecoRecent({...feed,acquired_at:null},now),false);
});
test('blocked cargo overrides otherwise positive signals',()=>{
 assert.equal(evaluateConateco({...row,stop_cargo:'S'},feed,now).label,'CARICO BLOCCATO');
});
test('explicit negative overrides otherwise positive',()=>{
 assert.equal(evaluateConateco({...row,acceptance_icon:'NO_ACCETTA_CARICO'},feed,now).kind,'bad');
 assert.equal(evaluateConateco({...row,acceptance_flag:'0'},feed,now).kind,'bad');
});
test('departed or closed category cannot turn green',()=>{
 assert.equal(evaluateConateco({...row,category:'PARTITE'},feed,now).kind,'bad');
 assert.equal(evaluateConateco({...row,vessel_status:'CHI'},feed,now).kind,'bad');
});
test('missing or expired closing prevents green',()=>{
 assert.equal(evaluateConateco({...row,closing:''},feed,now).kind,'warn');
 assert.equal(evaluateConateco({...row,closing:'2026-10-30 17:00'},feed,now).kind,'bad');
});
test('future opening prevents green',()=>{
 assert.equal(evaluateConateco({...row,opening:'2026-11-01 12:00'},feed,now).kind,'bad');
});
test('unknown stop flag and contradictory categories fail closed',()=>{
 assert.equal(evaluateConateco({...row,stop_cargo:'?'},feed,now).kind,'unknown');
 assert.equal(evaluateConateco({...row,source_conflict:true},feed,now).kind,'unknown');
});
test('external depot text never independently authorizes port entry',()=>{
 const x=evaluateConateco({...row,external_depot:'ACCETTA DEPOSITO ESTERNO'},feed,now);
 assert.equal(x.kind,'good');
 assert.match(x.reason,/booking e l’ingresso non sono autorizzati/);
});
test('invalid opening, ETA and state cannot yield positive',()=>{
 assert.notEqual(evaluateConateco({...row,eta:'november 2'},feed,now).kind,'good');
 assert.notEqual(evaluateConateco({...row,vessel_status:'UNKNOWN'},feed,now).kind,'good');
});

test('CNT: errore di refresh conserva le righe, non il verde',()=>{
 const checked={...feed,rows:[row]};
 assert.equal(evaluateConateco(row,checked,now).kind,'good');
 const failed={...checked,refresh_failed:true};
 assert.equal(isConatecoRecent(failed,now),false);
 assert.equal(evaluateConateco(row,failed,now).kind,'unknown');
 assert.equal(evaluateConateco(row,{...failed,refresh_failed:false},now).kind,'good');
});
