/* Booking UX: mock official CNT JSON and assisted TFG portal.
   No real booking queried: browser tests verify only synthetic fixtures. */
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ORIGIN='https://pasqualemilano0-rgb.github.io';
const PREFIX='/container-booking-web-/';
const BASE=ORIGIN+PREFIX+'index.html';
const CF='container-booking-backend.pasqualemilano0.workers.dev';
const CNT='https://www.conateco.it/booking-export/';
const TFG='https://tfg.bucci.it/@/TFGW_WW_BKK';
const acquired=new Date().toISOString();
const tfgPublished=new Date(Date.now()-30*60*60*1000).toISOString();
const forecast={source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:acquired,rows:[{
 vessel:'QA CNT VESSEL',voyage:'Q001',eta:'2026-11-04 00:00',
 vessel_status:'PRE',category:'PREVISTE',acceptance_flag:'1',
 acceptance_icon:'ACCETTA_CARICO',closing:'2099-11-04 20:00',
 stop_cargo:'',external_depot:'S',source_conflict:false
}]};
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',
 acquired_at:acquired,source_updated_at:tfgPublished,live:false,booking_verified:false,rows:[{
 vessel:'QA TFG VESSEL',arrival_voyage:'QA000',departure_voyage:'QA001',
 eta:'05/11/26 12:00',acceptance:'ACCETTA CARICO',destination:'INTERNO PORTO'
}]};
const sct={source:'QA SCT',acquired_at:acquired,rows:[]};
function mime(p){
 if(p.endsWith('.html'))return 'text/html';
 if(p.endsWith('.js')||p.endsWith('.mjs'))return 'text/javascript';
 if(p.endsWith('.css'))return 'text/css';
 if(p.endsWith('.png'))return 'image/png';
 if(p.endsWith('.svg'))return 'image/svg+xml';
 if(p.endsWith('.json')||p.endsWith('.webmanifest'))return 'application/json';
 return 'application/octet-stream';
}
async function run(browser,width){
 const context=await browser.newContext({
   viewport:{width,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,
   permissions:['clipboard-read','clipboard-write']
 });
 const page=await context.newPage();
 await page.clock.install({time:new Date(acquired)});
 const errors=[],requests=[],recordedTfgPosts=[],tfgBackendPosts=[];
 let currentForecast=forecast;
 page.on('pageerror',e=>errors.push(e.message));
 context.on('request',r=>requests.push(r.url()));
 try{
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   let data=null;
   if(u.pathname.endsWith('/conateco.json')||(u.hostname===CF&&u.pathname==='/api/cnt')){
    if(!currentForecast)return route.fulfill({status:503,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},body:'{"error":"SCHEDULE_UNAVAILABLE"}'});
    data=currentForecast;
   }
   if(u.pathname.endsWith('/tfg_schedule.json')||(u.hostname===CF&&u.pathname==='/api/tfg/snapshot'))data=tfg;
   if(u.hostname===CF&&u.pathname==='/api/tfg')data={...tfg,live:true};
   if(u.pathname.endsWith('/sct.json'))data=sct;
   if(data)return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
   if(u.hostname===CF&&u.pathname==='/api/tfg_booking'){
      if(route.request().method()==='OPTIONS')return route.fulfill({
        status:204,headers:{
          'Access-Control-Allow-Origin':'*',
          'Access-Control-Allow-Methods':'POST, OPTIONS',
          'Access-Control-Allow-Headers':'content-type'
        }});
      const data=JSON.parse(route.request().postData()||'{}');
      tfgBackendPosts.push({method:route.request().method(),url:route.request().url(),booking:data.booking});
      if(data.booking==='BACKEND503')return route.fulfill({
        status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},
        body:'{"error":"TFG_NOT_VERIFIABLE"}'});
      const result=data.booking==='EBKG19223970'
        ?{status:'found',vessel:'QA TFG VESSEL',voyage:'QA001',
           message:'Nave e viaggio rilevati dal modulo TFG.'}
        :{status:'not_found',message:'Il booking risulta inesistente su TFG.'};
      return route.fulfill({
        status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify({...result,source:'https://tfg.bucci.it/@/TFGW_WW_BKK',
          checked_at:new Date().toISOString(),booking_authorized:false})
      });
   }
   if(u.hostname==='api.conateco.it'&&u.pathname==='/ConatecoServicesApi/Booking'){
     const code=u.searchParams.get('id_booking');
     // A synthetic nonzero integer exercises the official page's field-based result.
     // It does not define a particular ReturnCode as a success contract.
     const data=code==='EBKG19223970'
       ?{ReturnCode:1,ReturnMessage:'',B_NOMNAVE:'QA CNT VESSEL',B_ETA:'20261104080000'}
       :code==='MISMATCH999'
         ?{ReturnCode:1,ReturnMessage:'',B_NOMNAVE:'QA CNT VESSEL',B_ETA:'20261105080000'}
         :code==='MISSINGETA999'
           ?{ReturnCode:1,ReturnMessage:'',B_NOMNAVE:'QA CNT VESSEL',B_ETA:null}
           :code==='POSITIVEEMPTY'
             ?{ReturnCode:1,ReturnMessage:'',B_NOMNAVE:null,B_ETA:null}
             :code==='NEGATIVEEMPTY'
               ?{ReturnCode:-1,ReturnMessage:'',B_NOMNAVE:null,B_ETA:null}
         :{ReturnCode:-1,ReturnMessage:'Booking non disponibile nel test',B_NOMNAVE:null,B_ETA:null};
     return route.fulfill({status:200,contentType:'application/json',
       headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
   }
   if(u.hostname==='www.conateco.it' && u.pathname==='/booking-export/'){
    return route.fulfill({status:200,contentType:'text/html',
      body:'<html><title>Booking Export CO.NA.TE.CO.</title><body>Codice Booking</body></html>'});
   }
   if(u.hostname==='tfg.bucci.it'&&u.pathname==='/@/TFGW_WW_BKK'){
    recordedTfgPosts.push({url:route.request().url(),method:route.request().method(),body:route.request().postData()});
    return route.fulfill({status:200,contentType:'text/html',
      body:'<html><title>Booking TFG</title><body>IL BOOKING E INESISTENTE!</body></html>'});
   }
   if(u.origin===ORIGIN&&u.pathname.startsWith(PREFIX)){
    const rel=decodeURIComponent(u.pathname.slice(PREFIX.length))||'index.html';
    if(rel.includes('..'))return route.abort();
    try{return route.fulfill({status:200,contentType:mime(rel),body:readFileSync(path.join(process.cwd(),rel))});}
    catch{return route.fulfill({status:404,body:'fixture unavailable'});}
   }
   return route.abort();
  });
  await page.goto(BASE,{waitUntil:'load'});
  assert.equal(await page.locator('[data-booking-target="cnt"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#search-btn').innerText(),/CERCA BOOKING CNT/);
  await page.locator('#query').fill('AB?12');
  await page.locator('#search-btn').click();
  assert.equal(await page.locator('#query').getAttribute('aria-invalid'),'true');
  assert.match(await page.locator('#booking-feedback').innerText(),/lettere, numeri/);
  assert.equal(await page.locator('#results').isVisible(),false);

  await page.locator('#query').fill('  ebkg 19223970  ');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('DATI BOOKING RILEVATI'));
  assert.equal(await page.locator('#query').inputValue(),'EBKG19223970');
  assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA CNT VESSEL');
  assert.equal(await page.locator('#results .booking-vessel-name').isVisible(),true,'The vessel is immediately visible');
  const cntDetails=page.locator('#results .booking-terminal-details');
  const etaFact=cntDetails.locator('.fact').filter({hasText:'ETA dal Booking Export'});
  assert.equal(await cntDetails.getAttribute('open'),null,'Terminal details start collapsed');
  assert.equal(await cntDetails.locator('summary').innerText(),'Dettagli del terminal');
  assert.match(await etaFact.textContent(),/04\/11\/2026 08:00/,'ETA remains available in the detail DOM');
  assert.equal(await etaFact.isVisible(),false,'ETA must not compete with the vessel name');
  assert.doesNotMatch(await page.locator('#results').innerText(),/04\/11\/2026 08:00/);
  async function assertCntAcceptance(state,label){
   await page.waitForFunction(({state,pattern})=>{
    const card=document.querySelector('#results .booking-vessel-acceptance');
    return card?.dataset.state===state&&new RegExp(pattern).test(card.querySelector('.booking-acceptance-label')?.textContent||'');
   },{state,pattern:label.source});
   const card=page.locator('#results .booking-vessel-acceptance');
   assert.equal(await card.count(),1,'Exactly one vessel acceptance card');
   assert.equal(await card.isVisible(),true,'Vessel acceptance is visible while details are collapsed');
   assert.equal(await card.getAttribute('role'),'status');
   assert.equal(await card.evaluate(el=>el.closest('details')===null),true,'Acceptance must be outside terminal details');
   assert.equal(await page.locator('#results .booking-vessel-name').isVisible(),true);
   assert.equal(await cntDetails.getAttribute('open'),null);
   assert.match(await card.locator('.booking-acceptance-label').innerText(),label);
   assert.equal(await card.locator('.result-label.good').count(),state==='good'?1:0,'Only a positive vessel state receives a green badge');
   assert.match(await card.locator('.booking-acceptance-source').innerText(),/CO\.NA\.TE\.CO\. · Berth Forecast/);
   assert.equal(await card.locator('.booking-acceptance-source').isVisible(),true);
   if(state!=='good')assert.doesNotMatch(await card.locator('.booking-acceptance-label').innerText(),/^ACCETTA CARICO \(NAVE\)$/);
  }
  async function assertCntOptions(){
   await page.waitForFunction(()=>document.querySelector('#results .booking-cnt-delivery .delivery-spot-value')
    ?.innerText.replace(/\s+/g,' ').trim()==='INTERNO PORTO / DRYPORT');
   const card=page.locator('#results .booking-cnt-delivery .delivery-spot-cnt');
   assert.equal(await card.isVisible(),true,'Vessel delivery options are immediately visible');
   assert.equal(await card.evaluate(el=>el.closest('details')===null),true);
   assert.equal(await card.getAttribute('data-scope'),'vessel','Options never certify the booking voyage');
   assert.match(await card.locator('.delivery-spot-label').innerText(),/NAVE/);
   assert.equal(await card.locator('.delivery-depot-status').innerText(),'DEPOT ESTERNI: OK');
   const source=card.locator('.delivery-source-details');
   assert.equal(await source.getAttribute('open'),null);
   assert.equal(await source.locator('summary').innerText(),'Fonte e aggiornamento');
   assert.match(await source.locator('.delivery-spot-note').textContent(),/INDICAZIONE PRESUNTA/);
   assert.equal(await source.locator('.delivery-spot-note').isVisible(),false);
  }
  await assertCntAcceptance('good',/^ACCETTA CARICO \(NAVE\)$/);
  await assertCntOptions();
  assert.equal(await page.locator('#results .booking-vessel-acceptance').getAttribute('data-voyage-match'),'eta-day');
  assert.equal(await page.locator('#results .booking-voyage-warning').count(),0,
    'A valid name plus day ETA match must not display the name-only warning');
  assert.match(await page.locator('#results .booking-acceptance-source').innerText(),/Acquisito:/);
  const cntSource=page.locator('#results .delivery-spot-cnt .delivery-source-details');
  const cntAcquired=await page.evaluate(stamp=>new Intl.DateTimeFormat('it-IT',{
   dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'
  }).format(new Date(stamp)),acquired);
  assert.ok((await cntSource.textContent()).includes(cntAcquired),'Acquisition date remains available in source details');
  await cntSource.locator('summary').click();
  assert.equal(await cntSource.locator('.delivery-spot-note').isVisible(),true);
  // The periodic age check must not interrupt a user reading the source panel.
  const sourceNode=await cntSource.elementHandle();
  const sourceSummary=await cntSource.locator('summary').elementHandle();
  await cntSource.locator('summary').focus();
  const lookupsBeforeTick=requests.filter(url=>url.includes('/ConatecoServicesApi/Booking')).length;
  await page.clock.fastForward(31000);
  assert.equal(await cntSource.evaluate(el=>el.open),true,'The source panel stays open across the 30-second refresh');
  assert.equal(await sourceNode.evaluate(el=>el===document.querySelector('#results .booking-cnt-delivery .delivery-source-details')),true,
   'Unchanged source data keeps the original details node');
  assert.equal(await sourceSummary.evaluate(el=>el===document.activeElement),true,'Keyboard focus stays on the source summary');
  assert.equal(await cntSource.locator('.delivery-spot-note').isVisible(),true);
  assert.equal(requests.filter(url=>url.includes('/ConatecoServicesApi/Booking')).length,lookupsBeforeTick,
   'The periodic age check must not repeat the booking lookup');
  await sourceNode.dispose();
  await sourceSummary.dispose();
  await cntSource.locator('summary').click();
  await cntDetails.locator('summary').click();
  assert.equal(await etaFact.isVisible(),true);
  assert.match(await page.locator('#results').innerText(),/04\/11\/2026 08:00/);
  assert.match(await page.locator('#results').innerText(),/STATO NAVE|PROGRAMMA NAVE/);
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).replace(/\s+/g,' ').trim(),'INTERNO PORTO / DRYPORT');
  assert.match(await page.locator('#results').innerText(),/NON VERIFICATO/);
  assert.doesNotMatch(await page.locator('#results').innerText(),/BOOKING AUTORIZZATO/);
  assert.equal(await page.locator('#results .booking-api-actions a').getAttribute('href'),CNT);
  assert.equal(await page.locator('#results .booking-method').count(),0,'Old fake workflow removed');

  // A different ETA may show vessel-level options, without assigning the booking voyage.
  await page.locator('#query').fill('MISMATCH999');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('DATI BOOKING RILEVATI'));
  assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA CNT VESSEL');
  assert.equal(await page.locator('#results .booking-vessel-name').isVisible(),true,'A forecast mismatch must not hide the booking vessel');
  assert.equal(await cntDetails.getAttribute('open'),null,'A new booking resets expanded details');
  assert.equal(await cntDetails.locator('.fact').filter({hasText:'ETA dal Booking Export'}).isVisible(),false);
  await assertCntAcceptance('good',/^ACCETTA CARICO \(NAVE\)$/);
  await assertCntOptions();
  assert.equal(await page.locator('#results .booking-vessel-acceptance').getAttribute('data-voyage-match'),'vessel-only');
  assert.match(await page.locator('#results .booking-voyage-warning').innerText(),/VIAGGIO DEL BOOKING NON CONFERMATO/);
  assert.equal(await page.locator('#results .booking-voyage-warning').isVisible(),true,
    'Visible outside collapsed terminal details');
  await cntDetails.locator('summary').click();
  await page.waitForFunction(()=>document.querySelector('#results .booking-terminal-details')?.textContent.includes('Nave ed ETA del booking non coincidono'));
  assert.equal(await page.locator('#results .delivery-spot').count(),1);
  assert.match(await cntDetails.innerText(),/Il viaggio del booking non è verificato/);
  assert.match(await page.locator('#results').innerText(),/Nave ed ETA del booking non coincidono/);

  // A missing ETA does not suppress a valid vessel returned for the booking.
  await page.locator('#query').fill('MISSINGETA999');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('DATI BOOKING RILEVATI'));
  assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA CNT VESSEL');
  assert.equal(await page.locator('#results .booking-vessel-name').isVisible(),true);
  assert.equal(await cntDetails.getAttribute('open'),null);
  assert.equal(await cntDetails.locator('.fact').filter({hasText:'ETA dal Booking Export'}).isVisible(),false);
  await assertCntAcceptance('good',/^ACCETTA CARICO \(NAVE\)$/);
  await assertCntOptions();
  assert.equal(await page.locator('#results .booking-vessel-acceptance').getAttribute('data-voyage-match'),'vessel-only');
  assert.match(await page.locator('#results .booking-voyage-warning').innerText(),/VIAGGIO DEL BOOKING NON CONFERMATO/);
  assert.equal(await page.locator('#results .booking-voyage-warning').isVisible(),true,
    'Visible outside collapsed terminal details');
  await cntDetails.locator('summary').click();
  await page.waitForFunction(()=>document.querySelector('#results .booking-terminal-details')?.textContent.includes('ETA non interpretabile'));
  assert.match(await cntDetails.locator('.fact').filter({hasText:'ETA dal Booking Export'}).innerText(),/Non indicata/);
  assert.equal(await page.locator('#results .delivery-spot').count(),1,'Missing ETA retains only vessel-scoped options');
  assert.match(await cntDetails.innerText(),/Il viaggio del booking non è verificato/);

  // Refresh only public schedules: the visible vessel state must follow the new
  // forecast without transmitting the private booking again or duplicating detail rows.
  const lookupCountBeforeRefresh=requests.filter(x=>x.includes('/ConatecoServicesApi/Booking')).length;
  await cntDetails.locator('summary').click();
  await page.locator('#napoli-advanced>summary').click();
  currentForecast={...forecast,acquired_at:new Date(Date.now()+1000).toISOString(),
   rows:[{...forecast.rows[0],acceptance_flag:'0',acceptance_icon:'NO_ACCETTA_CARICO'}]};
  await page.locator('#cnt-reload').click();
  await assertCntAcceptance('bad',/^NON ACCETTA CARICO$/);
  assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA CNT VESSEL');
  assert.equal(await page.locator('#results .booking-forecast-details .facts').count(),1);
  currentForecast={...forecast,acquired_at:new Date(Date.now()+2000).toISOString()};
  await page.locator('#cnt-reload').click();
  await assertCntAcceptance('good',/^ACCETTA CARICO \(NAVE\)$/);
  assert.equal(requests.filter(x=>x.includes('/ConatecoServicesApi/Booking')).length,lookupCountBeforeRefresh,
    'Schedule refresh never repeats the booking lookup');

  const acceptanceCases=[
   {name:'negative',feed:{...forecast,rows:[{...forecast.rows[0],acceptance_flag:'0',acceptance_icon:'NO_ACCETTA_CARICO'}]},
    state:'bad',label:/^NON ACCETTA CARICO$/},
   {name:'closed voyage',feed:{...forecast,rows:[{...forecast.rows[0],vessel_status:'CHI',category:'PARTITE',acceptance_icon:'CHIUSA'}]},
    state:'bad',label:/^NAVE CHIUSA O PARTITA$/},
   {name:'vessel absent',feed:{...forecast,rows:[{...forecast.rows[0],vessel:'QA ANOTHER VESSEL'}]},
    state:'unknown',label:/^ACCETTAZIONE DA VERIFICARE$/},
   {name:'ambiguous voyages',feed:{...forecast,rows:[forecast.rows[0],{...forecast.rows[0],voyage:'Q002'}]},
    state:'unknown',label:/^ACCETTAZIONE DA VERIFICARE$/},
   {name:'stale acquisition',feed:{...forecast,acquired_at:new Date(Date.now()-2*3600000).toISOString()},
    state:'unknown',label:/^DATI DA AGGIORNARE$/},
   {name:'unavailable feed',feed:null,state:'unknown',label:/^ACCETTAZIONE DA VERIFICARE$/}
  ];
  for(const scenario of acceptanceCases){
   currentForecast=scenario.feed;
   // The negative update must replace the previous positive state in the same tab.
   if(scenario.name!=='negative')await page.reload({waitUntil:'load'});
   await page.locator('#query').fill('EBKG19223970');
   await page.locator('#search-btn').click();
   await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('DATI BOOKING RILEVATI'));
   assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA CNT VESSEL',scenario.name);
   await assertCntAcceptance(scenario.state,scenario.label);
   if(scenario.name==='negative')await assertCntOptions();
   else{
    assert.equal(await page.locator('#results .delivery-spot-value').innerText(),'LUOGO DA VERIFICARE',scenario.name);
    assert.equal(await page.locator('#results .delivery-choice').count(),0,'Uncertain or closed voyages must not show delivery alternatives');
   }
   if(scenario.name!=='unavailable feed')assert.match(await page.locator('#results .booking-acceptance-source').innerText(),/Acquisito:/);
  }

  await page.locator('#query').fill('MISSING999');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('BOOKING NON CONFERMATO'));
  assert.doesNotMatch(await page.locator('#results').innerText(),/QA CNT VESSEL/);
  assert.match(await page.locator('#results').innerText(),/Booking non disponibile nel test/);

  // A positive code alone never supplies a vessel or a forecast acceptance state.
  await page.locator('#query').fill('POSITIVEEMPTY');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('BOOKING NON CONFERMATO'));
  assert.equal(await page.locator('#results .booking-vessel-name').count(),0);
  assert.equal(await page.locator('#results .booking-vessel-acceptance').count(),0);
  assert.doesNotMatch(await page.locator('#results').innerText(),/QA CNT VESSEL|ACCETTA CARICO \(NAVE\)/);

  // With no terminal message, retain the actual negative code in the fallback.
  await page.locator('#query').fill('NEGATIVEEMPTY');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('BOOKING NON CONFERMATO'));
  assert.match(await page.locator('#results').innerText(),/-1/);
  assert.equal(await page.locator('#results .booking-vessel-name').count(),0);
  assert.equal(await page.locator('#results .booking-vessel-acceptance').count(),0);

  // Automatic TFG booking — no manual copy-paste or popup needed for lookup.
  await page.locator('[data-booking-target="tfg"]').click();
  assert.equal(await page.locator('#results').isVisible(),false);
  assert.equal(await page.locator('[data-booking-target="tfg"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#search-btn').innerText(),/CERCA BOOKING TFG/);
  assert.deepEqual(tfgBackendPosts,[],'Opening the TFG schedule must never search a booking');
  await page.locator('#query').fill('EBKG19223970');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('DATI BOOKING RILEVATI'));
  assert.equal(await page.locator('#results .booking-vessel-name').innerText(),'QA TFG VESSEL');
  assert.equal(await page.locator('#results .booking-vessel-name').isVisible(),true);
  assert.match(await page.locator('#results .booking-voyage').innerText(),/QA001/);
  assert.equal(await page.locator('#results .booking-voyage').isVisible(),true);
  const tfgDetails=page.locator('#results .booking-tfg-details');
  assert.equal(await tfgDetails.getAttribute('open'),null);
  assert.equal(await tfgDetails.locator('summary').innerText(),'Dettagli del booking');
  const tfgBookingState=tfgDetails.locator('.fact').filter({hasText:'Accettazione booking'});
  assert.match(await tfgBookingState.textContent(),/NON CONFERMATA/);
  assert.equal(await tfgBookingState.isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('#results .delivery-spot-value')!==null);
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).trim(),'INTERNO PORTO');
  const tfgAccepted=page.locator('#results .result-label.good').filter({hasText:/^ACCETTA CARICO$/});
  assert.equal(await tfgAccepted.count(),1,'A direct read with a 30-hour publication shows green vessel acceptance');
  assert.equal(await tfgAccepted.isVisible(),true);
  assert.doesNotMatch(await page.locator('#results').innerText(),/ACCETTA CARICO · DATO VECCHIO/);
  const tfgSource=page.locator('#results .delivery-spot-tfg .delivery-source-details');
  assert.equal(await tfgSource.getAttribute('open'),null);
  assert.equal(await tfgSource.locator('summary').innerText(),'Fonte e aggiornamento');
  assert.match(await tfgSource.locator('.delivery-spot-note').textContent(),/Non verifica il singolo booking/);
  assert.equal(await tfgSource.locator('.delivery-spot-note').isVisible(),false);
  const tfgDates=await page.evaluate(stamps=>stamps.map(stamp=>new Intl.DateTimeFormat('it-IT',{
   dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'
  }).format(new Date(stamp))),[acquired,tfgPublished]);
  for(const date of tfgDates)assert.ok((await tfgSource.textContent()).includes(date),'Source/acquisition dates remain in the DOM');
  await tfgSource.locator('summary').click();
  assert.equal(await tfgSource.locator('.delivery-spot-note').isVisible(),true);
  assert.match(await tfgSource.innerText(),/TERMINAL DI CONSEGNA/);
  await tfgDetails.locator('summary').click();
  assert.equal(await tfgBookingState.isVisible(),true);
  assert.match(await tfgDetails.innerText(),/Nave e viaggio rilevati dal modulo TFG/);
  assert.match(await tfgDetails.innerText(),/NON CONFERMATA/);

  // Optional: submit original TFG form with data pre-filled in the POST body.
  const tfgPopupPromise=page.waitForEvent('popup',{timeout:12000});
  await page.locator('#results .booking-api-actions button').click();
  const tfgPopup=await tfgPopupPromise;
  await tfgPopup.waitForLoadState('domcontentloaded');
  assert.equal(tfgPopup.url(),TFG);
  assert.match(await tfgPopup.locator('body').innerText(),/INESISTENTE/);
  await tfgPopup.close();

  await page.locator('#query').fill('NOTFOUND999');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('BOOKING NON CONFERMATO'));
  assert.match(await page.locator('#results').innerText(),/inesistente/i);
  assert.doesNotMatch(await page.locator('#results').innerText(),/QA TFG VESSEL/);

  await page.locator('#query').fill('BACKEND503');
  await page.locator('#search-btn').click();
  await page.waitForFunction(()=>document.querySelector('#results .rheader')?.textContent.includes('SERVIZIO NON DISPONIBILE'));
  assert.match(await page.locator('#results').innerText(),/CERCA SUL SITO TFG/);

  await page.locator('#query').fill('CHANGED123');
  assert.equal(await page.locator('#results').isVisible(),false);
  assert.deepEqual(errors,[],'No browser exceptions');
  const apiCalls=requests.filter(x=>x.includes('/ConatecoServicesApi/Booking'));
  assert.equal(apiCalls.length,12,'Only twelve intentional CNT requests');
  const tfgPosts=recordedTfgPosts;
  assert.equal(tfgPosts.length,1,'TFG direct fallback should submit one deliberate POST');
  assert.equal(tfgBackendPosts.length,3,'Backend should receive exactly three explicit searches');
  for(const item of tfgBackendPosts){
    assert.equal(item.method,'POST');
    assert.equal(item.url,'https://'+CF+'/api/tfg_booking');
  }
  assert.deepEqual(tfgBackendPosts.map(p=>p.booking),['EBKG19223970','NOTFOUND999','BACKEND503']);
  assert.ok(requests.some(url=>url==='https://'+CF+'/api/tfg'),'HTTPS Pages uses the Cloudflare schedule endpoint');
  assert.equal(requests.some(url=>!new Set(['pasqualemilano0-rgb.github.io',CF,'raw.githubusercontent.com','api.conateco.it','www.conateco.it','tfg.bucci.it']).has(new URL(url).hostname)),false,'Only the declared application and official source hosts may be contacted');
  assert.equal(tfgPosts[0].url,TFG,'Correct official TFG route');
  assert.equal(tfgPosts[0].method,'POST','Never a GET booking lookup on TFG');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tfgPosts[0].body)),
    {modo:'2',bkk:'EBKG19223970'});
  for(const url of requests){
   if(!/EBKG19223970|MISMATCH999|MISSINGETA999|MISSING999|POSITIVEEMPTY|NEGATIVEEMPTY|NOTFOUND999|BACKEND503|CHANGED123/i.test(url))continue;
   const u=new URL(url);
   assert.equal(u.hostname,'api.conateco.it','Only CNT booking may appear in the URL');
   assert.equal(u.pathname,'/ConatecoServicesApi/Booking');
  }
  const dims=await page.evaluate(()=>({
    client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
  }));
  assert.ok(dims.scroll<=dims.client+3,'No sideways overflow at '+width+': '+JSON.stringify(dims));
  console.log('PASS booking direct CNT + automatic TFG backend '+width+'px: result, error, vessel forecast, privacy');
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,432,768])await run(browser,width);}
 finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
