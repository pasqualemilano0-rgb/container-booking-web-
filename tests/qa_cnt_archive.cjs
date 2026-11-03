/* Historical-voyage and empty-list UI regressions: synthetic CNT berth feeds only. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const acquired=new Date(Date.now()-4*3600000).toISOString();
const feed={
  source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:acquired,source_updated_at:null,
  rows:[
    {vessel:'CATHERINE C',voyage:'FD642E',eta:'2026-10-24 10:15',
      category:'PARTITE',vessel_status:'CHI',acceptance_flag:'0',
      acceptance_icon:'CHIUSA',stop_cargo:'',external_depot:'',source_conflict:false},
    {vessel:'MSC JASPER VIII',voyage:'MG643W',eta:'2026-10-25 00:00',
      category:'PARTITE',vessel_status:'ANN',acceptance_flag:'0',
      acceptance_icon:'',stop_cargo:'',external_depot:'',source_conflict:false},
    {vessel:'AMERICA',voyage:'OLDARR',eta:'2026-10-30 15:40',
      category:'ORMEGGIATE',vessel_status:'ARR',acceptance_flag:'0',
      acceptance_icon:'',stop_cargo:'',external_depot:'',source_conflict:false},
    {vessel:'MSC GRETA III',voyage:'QA051',eta:'2026-11-02 00:00',
      category:'PREVISTE',vessel_status:'PRE',acceptance_flag:'1',
      acceptance_icon:'ACCETTA_CARICO',stop_cargo:'',external_depot:'',source_conflict:false}
  ]
};
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',acquired_at:acquired,
 source_updated_at:acquired,rows:[{vessel:'QA TFG',eta:'03/11/26 10:00',
 departure_voyage:'QA22',acceptance:'NAVE CHIUSA',destination:'INTERNO PORTO'}]};
const sct={source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
 acquired_at:acquired,rows:[{vessel:'QA SCT',eta:'03/11/26 10:00',voyage:'QA1'}]};

async function verify(browser,width){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const errors=[];
 let currentFeed=feed;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   let data=null;
   if(url.pathname.endsWith('/conateco.json'))data=currentFeed;
   if(url.pathname.endsWith('/tfg_schedule.json')||url.pathname.endsWith('/api/tfg'))data=tfg;
   if(url.pathname.endsWith('/sct.json'))data=sct;
   if(data)return route.fulfill({status:200,contentType:'application/json',
     headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
   if(url.hostname==='127.0.0.1')return route.continue();
   return route.abort();
 });
 try{
   await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
   await page.locator('button[data-open-terminal="cnt"]').click();
   await page.waitForFunction(()=>document.querySelectorAll('#cnt-vessel-list button[data-cnt-row]').length===2);
   const names=await page.locator('#cnt-vessel-list .vessel-name').allTextContents();
   assert.deepEqual(names,['MSC GRETA III','AMERICA'],'Expected/future ships precede older arrived vessels if feed is stale');
   assert.match(await page.locator('#cnt-feed-alert').innerText(),/DATI NON AGGIORNATI/);
   assert.match(await page.locator('#cnt-feed-alert').innerText(),/Ultima acquisizione/);
   assert.match(await page.locator('#cnt-archive-toggle').innerText(),/2 NAVI PARTITE/);
   await page.locator('#cnt-archive-toggle').click();
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),4);
   const all=await page.locator('#cnt-vessel-list .vessel-name').allTextContents();
   assert.deepEqual(all.slice(0,2),['MSC GRETA III','AMERICA']);
   assert.deepEqual(all.slice(2),['CATHERINE C','MSC JASPER VIII']);
   await page.locator('#cnt-archive-toggle').click();
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),2);
   await page.locator('#cnt-ship-filter').fill('CATHERINE');
   await page.waitForFunction(()=>document.querySelectorAll('#cnt-vessel-list button[data-cnt-row]').length===1);
   assert.equal(await page.locator('#cnt-vessel-list .vessel-name').innerText(),'CATHERINE C');
   assert.equal(await page.locator('#cnt-archive-toggle').isVisible(),false);
   await page.locator('#cnt-ship-filter').fill('NESSUNA NAVE QA');
   assert.equal(await page.locator('#cnt-vessel-list').innerText(),'Nessuna nave o viaggio corrispondente.');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),0);
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'0 viaggi');
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);
   assert.equal(await page.locator('#cnt-archive-toggle').isVisible(),false);
   assert.deepEqual(errors,[],'An unmatched search must not throw a JavaScript exception');
   await page.locator('#cnt-ship-filter').fill('');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),2);
   assert.deepEqual(await page.locator('#cnt-vessel-list .vessel-name').allTextContents(),names);
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'2 viaggi');
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);
   assert.equal(await page.locator('#cnt-archive-toggle').isVisible(),true);

   // Searching must also reset a previously visible pagination control.
   currentFeed={...feed,rows:Array.from({length:10},(_,index)=>({
     ...feed.rows[3],vessel:'QA SHIP '+(index+1),voyage:'QA'+(index+1)
   }))};
   await page.locator('#cnt-reload').click();
   await page.waitForFunction(()=>document.querySelector('#cnt-vessel-count').textContent==='10 viaggi');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),8);
   assert.equal(await page.locator('#cnt-show-more').isVisible(),true);
   await page.locator('#cnt-ship-filter').fill('NESSUNA NAVE QA');
   assert.equal(await page.locator('#cnt-vessel-list').innerText(),'Nessuna nave o viaggio corrispondente.');
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'0 viaggi');
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);
   await page.locator('#cnt-ship-filter').fill('');
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'10 viaggi');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),8);
   assert.equal(await page.locator('#cnt-show-more').isVisible(),true);
   await page.locator('#cnt-show-more').click();
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),10);
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);

   // A valid feed containing only departed voyages has an empty default list.
   currentFeed={...feed,rows:feed.rows.filter(row=>row.category==='PARTITE')};
   await page.locator('#cnt-reload').click();
   await page.waitForFunction(()=>document.querySelector('#cnt-vessel-count').textContent==='0 viaggi');
   assert.equal(await page.locator('#cnt-vessel-list').innerText(),'Nessun programma navi CO.NA.TE.CO. disponibile.');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),0);
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);
   assert.equal(await page.locator('#cnt-archive-toggle').isVisible(),true);
   await page.locator('#cnt-archive-toggle').click();
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),2);
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'2 viaggi');
   await page.locator('#cnt-archive-toggle').click();

   // Empty upstream snapshots must not erase a previously validated copy.
   // Keep departed voyages accessible only through the archive, and never green.
   currentFeed={...feed,rows:[]};
   await page.locator('#cnt-reload').click();
   await page.waitForFunction(()=>document.querySelector('#cnt-feed-alert')?.textContent.includes('Aggiornamento CNT non riuscito'));
   assert.equal(await page.locator('#cnt-vessel-count').innerText(),'0 viaggi');
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),0);
   assert.equal(await page.locator('#cnt-show-more').isVisible(),false);
   assert.equal(await page.locator('#cnt-archive-toggle').isVisible(),true);
   await page.locator('#cnt-archive-toggle').click();
   assert.equal(await page.locator('#cnt-vessel-list button[data-cnt-row]').count(),2);
   assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),0);
   await page.locator('#cnt-archive-toggle').click();
   currentFeed=feed;
   await page.locator('#cnt-reload').click();
   await page.waitForFunction(()=>document.querySelector('#cnt-vessel-count').textContent==='2 viaggi');
   assert.deepEqual(await page.locator('#cnt-vessel-list .vessel-name').allTextContents(),names);
   assert.deepEqual(errors,[]);
   const dims=await page.evaluate(()=>({
     vw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth
   }));
   assert.ok(dims.sw<=dims.vw+3,'No horizontal overflow: '+JSON.stringify(dims));
   console.log('PASS CNT archive, empty searches, unavailable feeds and acquisition timestamp '+width+'px');
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const w of [320,390,432])await verify(browser,w);}
 finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
