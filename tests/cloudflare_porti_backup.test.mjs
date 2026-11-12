import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveVerifiedSchedule,SPECS} from '../cloudflare/monitor.mjs';
const now=new Date('2026-11-12T08:00:00.000Z');
const doc={source:SPECS.sct.source,acquired_at:now.toISOString(),rows:[{vessel:'ONE'},{vessel:'TWO'}]};
test('archives validated schedules with seven-day expiry and stable version key',async()=>{
 const writes=[];const env={SCHEDULES_KV:{put:async(...args)=>writes.push(args)}};
 const key=await archiveVerifiedSchedule(env,'sct',doc,now);
 assert.equal(key,'backup:v1:sct:2026-11-12T08:00:00.000Z');
 assert.equal(writes.length,1);
 assert.equal(writes[0][2].expirationTtl,604800);
 assert.deepEqual(JSON.parse(writes[0][1]),doc);
});
test('rejects invalid and future snapshots without writes',async()=>{
 let count=0;const env={SCHEDULES_KV:{put:async()=>count++}};
 await assert.rejects(archiveVerifiedSchedule(env,'sct',{...doc,source:'https://evil.example'},now));
 await assert.rejects(archiveVerifiedSchedule(env,'sct',{...doc,acquired_at:'2026-11-13T08:00:00.000Z'},now));
 await assert.rejects(archiveVerifiedSchedule(env,'unknown',doc,now));
 assert.equal(count,0);
});

test('backup KV failure is logged and does not propagate to the schedule refresh',async()=>{
 const env={SCHEDULES_KV:{put:async()=>{throw Error('KV_WRITE_FAILED');}}};
 const original=console.error;const errors=[];
 console.error=(...args)=>errors.push(args);
 try{
  const key=await archiveVerifiedSchedule(env,'sct',doc,now);
  assert.equal(key,null);
  assert.equal(errors.length,1);
  assert.equal(errors[0][0],'PORTI_BACKUP_WRITE_FAILED');
 }finally{console.error=original;}
});
