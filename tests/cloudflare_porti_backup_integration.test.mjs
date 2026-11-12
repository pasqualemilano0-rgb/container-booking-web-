import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshTerminal,SPECS} from '../cloudflare/monitor.mjs';

const now=new Date('2026-11-12T08:00:00.000Z');
const snapshot=(rows,at=now.toISOString())=>({
 source:SPECS.sct.source,acquired_at:at,rows:rows.map(vessel=>({vessel}))
});
function fixture(initial=null){
 const map=new Map(initial?[['schedule:sct',initial]]:[]);
 const writes=[];
 return {map,writes,env:{SCHEDULES_KV:{
  get:async(k)=>map.get(k)??null,
  put:async(k,v,opts)=>{writes.push({key:k,options:opts});map.set(k,JSON.parse(v));}
 }}};
}
const fetcherFor=doc=>async url=>{
 if(!url.includes('raw.githubusercontent.com'))throw Error('OFFICIAL_UNAVAILABLE');
 return {ok:true,status:200,redirected:false,
 headers:{get:()=>null},text:async()=>JSON.stringify(doc)};
};
const backupWrites=f=>f.writes.filter(x=>x.key.startsWith('backup:v1:'));

test('first valid fallback creates recoverable seven-day backup and current schedule',async()=>{
 const f=fixture(),doc=snapshot(['ONE','TWO']);
 const result=await refreshTerminal(f.env,'sct',{fetcher:fetcherFor(doc)},now);
 assert.equal(result.state,'fallback');
 assert.equal(backupWrites(f).length,1);
 assert.equal(backupWrites(f)[0].options.expirationTtl,604800);
 assert.deepEqual(f.map.get(backupWrites(f)[0].key).rows,doc.rows);
 assert.equal(f.map.get('schedule:sct').monitor_origin,'github_verified_fallback');
});
test('same vessel rows at newer acquisition time do not create redundant backups',async()=>{
 const f=fixture(snapshot(['ONE','TWO'],'2026-11-12T07:30:00.000Z'));
 const doc=snapshot(['ONE','TWO']);
 await refreshTerminal(f.env,'sct',{fetcher:fetcherFor(doc)},now);
 assert.equal(backupWrites(f).length,0);
 assert.equal(f.map.get('schedule:sct').acquired_at,now.toISOString());
});
test('changed rows create backup without overwriting previous backup',async()=>{
 const old=snapshot(['ONE','TWO'],'2026-11-12T07:30:00.000Z'),f=fixture(old);
 const doc=snapshot(['ONE','THREE']);
 await refreshTerminal(f.env,'sct',{fetcher:fetcherFor(doc)},now);
 assert.equal(backupWrites(f).length,1);
 assert.deepEqual(f.map.get(backupWrites(f)[0].key).rows,doc.rows);
 assert.deepEqual(f.map.get('schedule:sct').rows,doc.rows);
});
test('invalid fallback preserves last valid schedule and does not create backup',async()=>{
 const old=snapshot(['ONE','TWO'],'2026-11-12T07:30:00.000Z'),f=fixture(old);
 await refreshTerminal(f.env,'sct',{fetcher:fetcherFor({...snapshot(['ONE','THREE']),source:'https://invalid.example'})},now);
 assert.equal(backupWrites(f).length,0);
 assert.deepEqual(f.map.get('schedule:sct'),old);
 assert.equal(f.map.get('status:sct').state,'error');
});
