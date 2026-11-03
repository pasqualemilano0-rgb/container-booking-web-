/* QA regressione: una nuova lettura TFG verifica anche una pubblicazione
 * invariata; un vecchio 'N' CNT NON prova deposito assente.
 * Tutti i dati sono simulati, nessuna ricerca booking reale. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const now=new Date();
const acquired=now.toISOString();
const old=new Date(now.getTime()-12*3600e3).toISOString();
const cntOld=new Date(now.getTime()-3*3600e3).toISOString();
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',live:true,
 booking_verified:false,acquired_at:acquired,source_updated_at:old,rows:[{
  vessel:'QA OLD TFG',departure_voyage:'Q001',arrival_voyage:'Q000',
  eta:'03/11/26 09:00',acceptance:'ACCETTA CARICO',
  custom_close_time:'',fast_corridor_cut_off:'',gate_cut_off:'',
  destination:'INTERNO PORTO'
 }]};
const cnt={source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:cntOld,rows:[{
  vessel:'QA OLD CNT',voyage:'Q001',eta:'2026-11-04 09:00',
  vessel_status:'PRE',category:'PREVISTE',acceptance_flag:'1',
  acceptance_icon:'ACCETTA_CARICO',stop_cargo:'',external_depot:'N',
  opening:'2026-11-01 08:00',closing:'2026-11-03 08:00',
  source_conflict:false
 }]};
const sct={source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
 acquired_at:acquired,rows:[{vessel:'QA SCT',voyage:'Q001',eta:'04/11/26 08:00'}]};
async function one(browser,width){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  const p=u.pathname;
  let payload;
  if(p.endsWith('/conateco.json'))payload=cnt;
  if(p.endsWith('/tfg_schedule.json')||p.endsWith('/api/tfg'))payload=tfg;
  if(p.endsWith('/sct.json'))payload=sct;
  if(payload)return route.fulfill({status:200,contentType:'application/json',
    headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload)});
  if(u.hostname==='127.0.0.1')return route.continue();
  return route.abort();
 });
 try{
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
  await page.locator('button[data-open-terminal="cnt"]').click();
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list button[data-cnt-row]'));
  await page.locator('#cnt-vessel-list button[data-cnt-row]').first().click();
  assert.match(await page.locator('#results .depot-acceptance-value').innerText(),/RICONFERMARE/);
  assert.match(await page.locator('#results .delivery-spot-value').innerText(),/LUOGO DA VERIFICARE/);
  assert.equal(await page.locator('#results .delivery-choice').count(),0,'A stale CNT signal cannot offer vessel delivery alternatives');
  await page.locator('button[data-open-terminal="tfg"]').click();
  await page.waitForFunction(()=>document.querySelector('#tfg-vessel-list button[data-tfg-row]'));
  assert.equal(await page.locator('#tfg-vessel-list .delivery-chip-value').first().innerText(),'INTERNO PORTO');
  await page.locator('#tfg-vessel-list button[data-tfg-row]').first().click();
  assert.equal(await page.locator('#results .delivery-spot-value').innerText(),'INTERNO PORTO');
  const sourceDetails=page.locator('#results .delivery-spot-tfg .delivery-source-details');
  assert.equal(await sourceDetails.getAttribute('open'),null);
  assert.equal(await sourceDetails.locator('summary').innerText(),'Fonte e aggiornamento');
  assert.match(await sourceDetails.locator('.delivery-spot-note').textContent(),/Non verifica il singolo booking/);
  assert.equal(await sourceDetails.locator('.delivery-spot-note').isVisible(),false);
  const dates=await page.evaluate(stamps=>stamps.map(stamp=>new Intl.DateTimeFormat('it-IT',{
   dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'
  }).format(new Date(stamp))),[acquired,old]);
  for(const date of dates)assert.ok((await sourceDetails.textContent()).includes(date),'Source/acquisition dates remain in the DOM');
  await sourceDetails.locator('summary').click();
  assert.equal(await sourceDetails.locator('.delivery-spot-note').isVisible(),true);
  assert.match(await sourceDetails.innerText(),/TERMINAL DI CONSEGNA/);
  assert.equal(await page.locator('#results .delivery-spot-tfg').getAttribute('data-freshness'),'published');
  assert.match(await page.locator('#results .delivery-verification-warning').innerText(),/VERIFICA ATTUALE NON DISPONIBILE/);
  assert.deepEqual(errors,[]);
  const dim=await page.evaluate(()=>({
   scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth
  }));
  assert.ok(dim.scroll<=dim.view+3,'Overflow su '+width+'px '+JSON.stringify(dim));
  console.log('PASS: CNT vecchio non conferma luogo, TFG letto ora con pubblicazione invariata '+width+'px');
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch();
 try{for(const w of [320,390,432])await one(browser,w);}
 finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
