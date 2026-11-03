/* Smoke test automatico su Chromium (viewport Android): nessun collegamento
   ai portali reali, dati QA fittizi. Evita falsi verdi durante il collaudo UI. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE='http://127.0.0.1:8765/index.html';
const acquired=new Date().toISOString();
function rome(date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.day+'/'+p.month+'/'+p.year+' '+p.hour+':'+p.minute;
}
function romeWall(date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
const eta=rome(new Date(Date.now()+48*3600e3));
const opening=romeWall(new Date(Date.now()-3600e3));
const closing=romeWall(new Date(Date.now()+48*3600e3));
const cnt={source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:acquired,source_updated_at:null,rows:[
 {vessel:'QA CNT VESSEL',voyage:'Q001',eta:closing,vessel_status:'PRE',
  category:'PREVISTE',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
  stop_cargo:'',opening,closing,source_conflict:false,external_depot:'S',
  notes:'ACCETT.RETROPORTO 30/10 12:00'},
 {vessel:'QA CNT INTERNAL',voyage:'Q002',eta:closing,vessel_status:'PRE',
  category:'PREVISTE',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
  stop_cargo:'',opening,closing,source_conflict:false,external_depot:'',
  notes:''}
]};
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',acquired_at:acquired,
 source_updated_at:acquired,live:true,booking_verified:false,rows:[
 {vessel:'QA TFG VESSEL',departure_voyage:'QA001',arrival_voyage:'QA000',
  eta,acceptance:'NAVE CHIUSA',gate_cut_off:'',fast_corridor_cut_off:'',
  custom_close_time:'',destination:'INTERNO PORTO'}]};
const sct={source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',acquired_at:acquired,updated_at:acquired,source_updated_at:null,
 data_changed_at:acquired,rows:[
 {vessel:'QA SALERNO VESSEL',voyage:'QA01',eta,closing:eta,
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'NOT ACCEPTED',status:'PENDING'}
]};
async function mockRoutes(page){
 await page.route('**/*', async route=>{
   const url=new URL(route.request().url());
   const path=url.pathname;
   let result=null;
   if(path.endsWith('/conateco.json'))result=cnt;
   if(path.endsWith('/tfg_schedule.json')||path.endsWith('/api/tfg'))result=tfg;
   if(path.endsWith('/sct.json'))result=sct;
   if(result){
     await route.fulfill({status:200,contentType:'application/json',
       headers:{'access-control-allow-origin':'*'},body:JSON.stringify(result)});
   }else if(url.hostname!=='127.0.0.1'){
     await route.abort();
   }else await route.continue();
 });
}
async function runOne(browser,width){
 const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 try{
  await mockRoutes(page);
  await page.goto(BASE,{waitUntil:'load'});
  // Il pannello avanzato è chiuso inizialmente: aprilo con la scorciatoia CNT.
  await page.locator('button[data-open-terminal="cnt"]').click();
  await page.locator('#cnt-fleet').waitFor({state:'visible'});
  assert.equal(await page.locator('#napoli-terminal-switch').isVisible(),false,'Duplicate terminal selector must be hidden');
  assert.equal(await page.locator('button[data-open-terminal="cnt"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#tfg-fleet').isVisible(),false,'TFG hidden initially');
  await page.waitForFunction(()=>document.querySelectorAll('#cnt-vessel-list button[data-cnt-row]').length>0);
  assert.match(await page.locator('#cnt-vessel-count').innerText(),/2 viaggi/);
  const externalBtn=page.locator('#cnt-vessel-list button[data-cnt-row]').filter({hasText:'QA CNT VESSEL'});
  const internalBtn=page.locator('#cnt-vessel-list button[data-cnt-row]').filter({hasText:'QA CNT INTERNAL'});
  assert.equal((await externalBtn.locator('.delivery-chip-value').innerText()).replace(/\s+/g,' ').trim(),'INTERNO PORTO / DRYPORT');
  assert.match(await internalBtn.locator('.delivery-chip-value').innerText(),/^INTERNO PORTO$/);
  assert.match(await externalBtn.locator('.delivery-chip-label').innerText(),/NAVE/);
  await externalBtn.click();
  assert.equal(await page.locator('#results .depot-acceptance-panel .depot-acceptance-value').innerText(),'OK');
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).replace(/\s+/g,' ').trim(),'INTERNO PORTO / DRYPORT');
  const cntSource=page.locator('#results .delivery-spot-cnt .delivery-source-details');
  assert.equal(await cntSource.getAttribute('open'),null);
  assert.equal(await cntSource.locator('summary').innerText(),'Fonte e aggiornamento');
  assert.match(await cntSource.locator('.delivery-spot-note').textContent(),/INDICAZIONE PRESUNTA/);
  assert.equal(await cntSource.locator('.delivery-spot-note').isVisible(),false);
  await cntSource.locator('summary').click();
  assert.equal(await cntSource.locator('.delivery-spot-note').isVisible(),true);
  await internalBtn.click();
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).trim(),'INTERNO PORTO');
  assert.equal(await cntSource.getAttribute('open'),null,'A new ship resets source details');
  assert.match(await cntSource.locator('.delivery-spot-note').textContent(),/NON conferma INTERNO PORTO/);
  assert.equal(await cntSource.locator('.delivery-spot-note').isVisible(),false);
  // Le dimensioni devono restare compatte e leggibili su smartphone.
  const sizes=await page.evaluate(()=>{
    const px=selector=>{
      const element=document.querySelector(selector);
      return element?parseFloat(getComputedStyle(element).fontSize):null;
    };
    return {
      title:px('.search-panel .panel-head h2'),
      ship:px('#cnt-vessel-list .vessel-name'),
      destination:px('#cnt-vessel-list .delivery-chip-value'),
      state:px('#cnt-vessel-list .result-label'),
      input:px('#sct-filter'),
      detail:px('#results .delivery-spot-value')
    };
  });
  assert.ok(sizes.title>=17&&sizes.title<=19,'Heading too large/small '+JSON.stringify(sizes));
  assert.ok(sizes.ship>=14&&sizes.ship<=15,'Ship name readability '+JSON.stringify(sizes));
  assert.ok(sizes.destination>=15&&sizes.destination<=17,'Destination text too large '+JSON.stringify(sizes));
  assert.ok(sizes.state>=10&&sizes.state<=12,'Acceptance badge disproportionate '+JSON.stringify(sizes));
  assert.ok(sizes.input>=16,'Mobile input should avoid browser autozoom');
  assert.ok(sizes.detail>=24&&sizes.detail<=29,'Details destination readability '+JSON.stringify(sizes));

  const quickTfg=page.locator('button[data-open-terminal="tfg"]');
  await quickTfg.click();
  await page.locator('#tfg-fleet').waitFor({state:'visible'});
  assert.equal(await page.locator('button[data-open-terminal="tfg"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('button[data-open-terminal="cnt"]').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#cnt-fleet').isVisible(),false,'CNT hidden under TFG');
  await page.waitForFunction(()=>document.querySelectorAll('#tfg-vessel-list button[data-tfg-row]').length>0);
  assert.match(await page.locator('#tfg-vessel-count').innerText(),/1 viaggi|1 viaggio/);
  assert.equal(await page.locator('#tfg-vessel-list button').first().isVisible(),true);
  assert.equal(await page.locator('#tfg-vessel-list .delivery-chip-value').first().innerText(),'INTERNO PORTO');
  await page.locator('#tfg-vessel-list button[data-tfg-row]').first().click();
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).trim(),'INTERNO PORTO');
  const sourceDetails=page.locator('#results .delivery-spot-tfg .delivery-source-details');
  const sourceNote=sourceDetails.locator('.delivery-spot-note');
  assert.equal(await sourceDetails.getAttribute('open'),null,'Source details start collapsed');
  assert.equal(await sourceDetails.locator('summary').innerText(),'Fonte e aggiornamento');
  assert.match(await sourceNote.textContent(),/Non verifica il singolo booking/i);
  assert.equal(await sourceNote.isVisible(),false,'Source note remains in the DOM without crowding the main result');
  await sourceDetails.locator('summary').click();
  assert.equal(await sourceNote.isVisible(),true);
  assert.match(await sourceNote.innerText(),/Non verifica il singolo booking/i);
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).trim(),'INTERNO PORTO');
  await sourceDetails.locator('summary').click();
  assert.equal(await sourceNote.isVisible(),false);
  await page.locator('button[data-open-terminal="cnt"]').click();
  await page.locator('#cnt-fleet').waitFor({state:'visible'});
  assert.equal(await page.locator('#tfg-fleet').isVisible(),false);
  await page.locator('input[name="port"][value="salerno"]').check();
  await page.locator('#sct-picker').waitFor({state:'visible'});
  assert.equal(await page.locator('#cnt-fleet').isVisible(),false);
  assert.equal(await page.locator('#tfg-fleet').isVisible(),false);
  await page.waitForFunction(()=>document.querySelectorAll('#sct-vessel-list button').length>0);
  assert.match(await page.locator('#sct-vessel-count').innerText(),/1 viaggi|1 viaggio/);
  await page.locator('input[name="port"][value="napoli"]').check();
  await page.locator('#cnt-fleet').waitFor({state:'visible'});
  const overflow=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    content:document.documentElement.scrollWidth
  }));
  assert.ok(overflow.content<=overflow.viewport+3,'Horizontal overflow '+JSON.stringify(overflow));
  assert.deepEqual(errors,[],'Uncaught client exceptions and missing assets');
  console.log('PASS browser '+width+'px: CNT -> TFG -> CNT -> SCT -> Napoli; delivery location prominence');
 }catch(err){
  const fs=require('node:fs');fs.mkdirSync('qa-results',{recursive:true});
  await page.screenshot({path:'qa-results/error-'+width+'.png',fullPage:true}).catch(()=>{});
  console.error('FAIL browser '+width+'px '+errors.join('; '));throw err;
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,432,768,1280])await runOne(browser,width);}
 finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
