import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTfgBookingResult} from '../tfg.mjs';
const EXAMPLE=['BOOKING','280252450',
 'MV SAGARMALA 05/11/26 Voy: 645W Armatore MSK',
 'SCARICARE PRESSO: INTERNO PORTO'].join('\n');
test('TFG usa testo booking solo per nave, viaggio e booking',()=>{
 const x=parseTfgBookingResult(EXAMPLE,'280252450');
 assert.equal(x.usable,true);assert.equal(x.vessel,'SAGARMALA');
 assert.equal(x.voyage,'645W');assert.equal(x.booking,'280252450');
 assert.equal('destination' in x,false);
});
test('SCARICARE PRESSO non alimenta luogo scarico TFG',()=>{
 for(const s of ['DRYPORT','INTERNO PORTO','LUOGO APPROVATO','DEPOSITO ALFA']){
  const x=parseTfgBookingResult(EXAMPLE.replace('INTERNO PORTO',s),'280252450');
  assert.equal(x.usable,true);assert.equal('destination' in x,false);
 }
});
test('booking senza SCARICARE PRESSO può incrociare il programma',()=>{
 assert.equal(parseTfgBookingResult(EXAMPLE.replace('SCARICARE PRESSO: INTERNO PORTO',''),'280252450').usable,true);
});
test('booking diverso, assente, o senza nave e viaggio non è usabile',()=>{
 assert.equal(parseTfgBookingResult(EXAMPLE,'00000000').usable,false);
 assert.equal(parseTfgBookingResult(EXAMPLE.replace('BOOKING\n280252450\n',''),'280252450').usable,false);
 assert.equal(parseTfgBookingResult('BOOKING: 280252450\nSCARICARE PRESSO: DRYPORT','280252450').usable,false);
});
test('TFG ignora accettazione e località dal testo del booking',()=>{
 const x=parseTfgBookingResult(EXAMPLE,'280252450');
 assert.equal('acceptance' in x,false);
 assert.equal('destination' in x,false);
});
test('TFG riconosce variante NAVE',()=>{
 const x=parseTfgBookingResult('BOOKING: ZX3456\nNAVE MERIDIAN STAR 06/11/2026 Voyage: A23B\nSCARICARE PRESSO: DRYPORT','ZX3456');
 assert.equal(x.vessel,'MERIDIAN STAR');assert.equal(x.voyage,'A23B');assert.equal(x.usable,true);
});

test('TFG rifiuta testo con booking diversi in conflitto',()=>{
 const text=['BOOKING: 280252450','BOOKING: 999999999',
  'MV SAGARMALA 05/11/26 Voy: 645W Armatore MSK'].join('\n');
 const data=parseTfgBookingResult(text,'280252450');
 assert.equal(data.bookingState,'ambiguous');
 assert.equal(data.usable,false);
 assert.match(data.reason,/più codici booking/);
});
test('TFG gestisce variante BOOKING N. e normalizza maiuscole',()=>{
 const text='BOOKING N. ebkg19223970\nMV SAGARMALA 05/11/26 Voy: 645W Armatore MSK';
 const data=parseTfgBookingResult(text,'ebkg 19223970');
 assert.equal(data.booking,'EBKG19223970');
 assert.equal(data.usable,true);
});
