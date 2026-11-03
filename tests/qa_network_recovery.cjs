/* Recovery QA: a failed refresh keeps the last vessels visible, but never
 * keeps an affirmative acceptance signal. Entirely synthetic, no booking. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const ORIGIN='http://127.0.0.1:8765/index.html';
const stamp=new Date().toISOString();
const rome=(date,iso=false)=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return iso?`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
   :`${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};
const eta=rome(new Date(Date.now()+24*3600000));
const cutoff=rome(new Date(Date.now()+48*3600000));
const cnt={
 source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:stamp,
 rows:[{vessel:'QA SAFE CNT',voyage:'QA10',eta:rome(new Date(Date.now()+24*3600000),true),
  opening:rome(new Date(Date.now()-3600000),true),closing:rome(new Date(Date.now()+48*3600000),true),
  vessel_status:'PRE',category:'PREVISTE',acceptance_flag:'1',
  acceptance_icon:'ACCETTA_CARICO',source_conflict:false,external_depot:'',stop_cargo:''}]
};
const sct={
 source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
 acquired_at:stamp,rows:[{vessel:'QA SAFE SCT',voyage:'QA20',eta,closing:cutoff,
   status:'PENDING',acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'CARGO ACCEPTED'}]
};
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',acquired_at:stamp,
 source_updated_at:new Date(Date.now()-3*86400000).toISOString(),
 live:true,booking_verified:false,rows:[{vessel:'QA SAFE TFG',departure_voyage:'QA30',
 arrival_voyage:'QA29',eta,acceptance:'ACCETTA CARICO',destination:'INTERNO PORTO'}]};
async function main(){
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 let fail=false,requestCount=0;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  let body=null;
  if(p.endsWith('/conateco.json')||p==='/api/cnt')body=cnt;
  if(p.endsWith('/sct.json')||p==='/api/sct')body=sct;
  if(p.endsWith('/tfg_schedule.json')||p==='/api/tfg')body=tfg;
  if(body){
   requestCount++;
   return route.fulfill({status:fail?503:200,contentType:'application/json',
    headers:{'access-control-allow-origin':'*'},
    body:fail?JSON.stringify({error:'SOURCE_UNAVAILABLE'}):JSON.stringify(body)});
  }
  if(u.hostname==='127.0.0.1')return route.continue();
  return route.abort();
 });
 try{
  await page.goto(ORIGIN,{waitUntil:'load'});
  await page.locator('button[data-open-terminal="cnt"]').click();
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list')?.textContent.includes('QA SAFE CNT'));
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),1);
  fail=true;
  await page.locator('#cnt-reload').click();
  await page.waitForFunction(()=>document.querySelector('#cnt-feed-alert')?.textContent.includes('Aggiornamento CNT non riuscito'));
  assert.match(await page.locator('#cnt-vessel-list').innerText(),/QA SAFE CNT/);
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),0);
  assert.match(await page.locator('#cnt-vessel-list .result-label').innerText(),/DATI DA AGGIORNARE/);
  // Retrying successfully is required to reinstate green. No forged acquired_at.
  fail=false;
  await page.locator('#cnt-reload').click();
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list .result-label.good'));
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),1);
  await page.locator('input[name="port"][value="salerno"]').check();
  await page.waitForFunction(()=>document.querySelector('#sct-vessel-list')?.textContent.includes('QA SAFE SCT'));
  assert.equal(await page.locator('#sct-vessel-list .result-label.good').count(),1);
  await page.locator('#sct-picker details.driver-extra > summary').click();
  fail=true;
  await page.locator('#reload-sct').click();
  await page.waitForFunction(()=>document.querySelector('#sct-alert')?.textContent.includes('Aggiornamento SCT non riuscito'));
  assert.match(await page.locator('#sct-vessel-list').innerText(),/QA SAFE SCT/);
  assert.equal(await page.locator('#sct-vessel-list .result-label.good').count(),0);
  assert.match(await page.locator('#sct-vessel-list .result-label').innerText(),/DATI DA AGGIORNARE/);
  fail=false;
  await page.locator('#reload-sct').click();
  await page.waitForFunction(()=>document.querySelector('#sct-vessel-list .result-label.good'));
  assert.equal(await page.locator('#sct-vessel-list .result-label.good').count(),1);
  // Offline must not leave an eternal spinner or issue hidden fetches.
  await context.setOffline(true);
  const before=requestCount;
  await page.locator('#reload-sct').click();
  await page.waitForFunction(()=>document.querySelector('#sct-alert')?.textContent.includes('Nessuna connessione'));
  assert.equal(requestCount,before,'Offline refresh must not contact any upstream');
  assert.match(await page.locator('#sct-vessel-list').innerText(),/QA SAFE SCT/);
  assert.equal(await page.locator('#sct-vessel-list .result-label.good').count(),0);
  await page.locator('input[name="port"][value="napoli"]').check();
  assert.match(await page.locator('#cnt-feed-alert').innerText(),/Nessuna connessione/);
  assert.match(await page.locator('#cnt-vessel-list').innerText(),/QA SAFE CNT/);
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),0);
  await page.locator('button[data-open-terminal="tfg"]').click();
  assert.match(await page.locator('#tfg-feed-alert').innerText(),/Nessuna connessione/);
  assert.equal(requestCount,before);
  assert.equal(await page.locator('#tfg-vessel-list .result-label.good').count(),0);
  await context.setOffline(false);
  await page.locator('button[data-open-terminal="cnt"]').click();
  await page.locator('#cnt-reload').click();
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list .result-label.good'));
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS network recovery: CNT/SCT keep old vessels, suppress green, offline no fetch, reconnect restores');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
