import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBooking,validateBooking,bookingTerminal} from '../booking_search.mjs';

test('booking: rimuove spazi e maiuscolizza senza cambiare codice',()=>{
 assert.equal(normalizeBooking('  ebkg  19223970  '),'EBKG19223970');
 assert.equal(normalizeBooking('ｍｓｃ-123/4'),'MSC-123/4');
 assert.equal(normalizeBooking(' AB-23/4 '),'AB-23/4');
});
test('booking: formati alfanumerici non inventano prefissi o numeri',()=>{
 for(const input of ['280252450','EBKG19223970','AB-2345','ABC/2026','ABCD']){
  const result=validateBooking(input);
  assert.equal(result.valid,true,input);
  assert.equal(result.booking,input);
 }
});
test('booking: input incompleto, HTML, simboli eccessivi e codici lunghi rifiutati',()=>{
 for(const input of ['', '  ', 'A1', '<SCRIPT>','ABC?123','AB@123','_ABC123',
   'E'.repeat(51), 'ABC\nDEF']){
  const result=validateBooking(input);
  assert.equal(result.valid,false,input);
  assert.ok(result.reason.length>0);
 }
});
test('booking: terminal non viene dedotto dal formato del codice',()=>{
 assert.equal(bookingTerminal('tfg'),'tfg');
 assert.equal(bookingTerminal('cnt'),'cnt');
 assert.equal(bookingTerminal('unknown'),'cnt');
});
