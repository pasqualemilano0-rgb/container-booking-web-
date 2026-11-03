import test from 'node:test';
import assert from 'node:assert/strict';
import {isDepartedConateco,selectConatecoFleet} from '../conateco_fleet.mjs';

const rows=[
 {vessel:'CATHERINE C',voyage:'FD642E',category:'PARTITE',vessel_status:'CHI',eta:'2026-10-24 10:15'},
 {vessel:'MSC JASPER VIII',voyage:'MG643W',category:'PARTITE',vessel_status:'ANN',eta:'2026-10-25 00:00'},
 {vessel:'AMERICA',voyage:'ABC001',category:'ORMEGGIATE',vessel_status:'ARR',eta:'2026-10-30 15:40'},
 {vessel:'MSC GRETA III',voyage:'TEST01',category:'PREVISTE',vessel_status:'PRE',eta:'2026-11-02 00:00'}
];

test('Departed voyages cannot occupy default first page, but arrived with past ETA stays',()=>{
 const x=selectConatecoFleet(rows);
 assert.equal(x.archivedCount,2);
 assert.equal(x.activeCount,2);
 assert.deepEqual(x.rows.map(v=>v.row.vessel),['AMERICA','MSC GRETA III']);
 assert.equal(x.searching,false);
});
test('Searching booking vessel or voyage can find departed rows without toggling',()=>{
 assert.equal(selectConatecoFleet(rows,{query:'Catherine'}).rows[0].row.vessel,'CATHERINE C');
 assert.equal(selectConatecoFleet(rows,{query:'MG643W'}).rows[0].row.vessel,'MSC JASPER VIII');
 assert.equal(selectConatecoFleet(rows,{query:'GRETA'}).rows.length,1);
 assert.equal(selectConatecoFleet(rows,{query:'IMPOSSIBILE'}).rows.length,0);
});
test('The driver can explicitly include departed voyages',()=>{
 const x=selectConatecoFleet(rows,{showDeparted:true});
 assert.equal(x.rows.length,4);
 assert.equal(x.archivedCount,2);
});
test('Do not infer departed from ETA alone or missing categories',()=>{
 assert.equal(isDepartedConateco({category:'ORMEGGIATE',eta:'2026-10-01 00:00'}),false);
 assert.equal(isDepartedConateco({category:'PREVISTE',acceptance_icon:'CHIUSA'}),true);
 assert.equal(isDepartedConateco(null),false);
 assert.deepEqual(selectConatecoFleet(null).rows,[]);
});
