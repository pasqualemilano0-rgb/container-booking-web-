const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const root='http://127.0.0.1:8765/index.html';
const stamp=new Date().toISOString();
function rome(date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
const tomorrow=rome(new Date(Date.now()+48*3600000));
const yesterday=rome(new Date(Date.now()-48*3600000));
const example=[
 {vessel:'MSC QA OPEN',voyage:'QA001',eta:tomorrow,category:'PREVISTE',
  vessel_status:'PRE',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
  stop_cargo:'',opening:yesterday,closing:tomorrow,source_conflict:false,external_depot:''},
 {vessel:'MSC QA STOP',voyage:'QA002',eta:tomorrow,category:'ORMEGGIATE',
  vessel_status:'ARR',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
  stop_cargo:'S',opening:yesterday,closing:tomorrow,source_conflict:false,external_depot:''},
 {vessel:'MSC QA CUTOFF',voyage:'QA003',eta:tomorrow,category:'PREVISTE',
  vessel_status:'PRE',acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',
  stop_cargo:'',opening:yesterday,closing:yesterday,source_conflict:false,external_depot:''},
 {vessel:'MSC QA DEPARTED',voyage:'QA004',eta:yesterday,category:'PARTITE',
  vessel_status:'CHI',acceptance_flag:'0',acceptance_icon:'CHIUSA',
  stop_cargo:'S',opening:yesterday,closing:yesterday,source_conflict:false,external_depot:''},
];
const feed={source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',source_updated_at:null,acquired_at:stamp,rows:example};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:820}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/conateco.json*',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(feed)
    }));
    await page.route('**/tfg_schedule.json*',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({rows:[],acquired_at:null,source_updated_at:null})
    }));
    await page.goto(root,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelectorAll('#cnt-vessel-list button[data-cnt-row]').length===4);
    assert.equal(await page.locator('#cnt-fleet').isVisible(),true);
    assert.equal(await page.locator('#tfg-fleet').isVisible(),false);
    const labels=await page.locator('#cnt-vessel-list button').allTextContents();
    assert.ok(labels.some(x=>/MSC QA OPEN.*NAVE IN ACCETTAZIONE/s.test(x)));
    assert.ok(labels.some(x=>/MSC QA STOP.*CARICO BLOCCATO/s.test(x)));
    assert.ok(labels.some(x=>/MSC QA CUTOFF.*CUT-OFF SCADUTO/s.test(x)));
    assert.ok(labels.some(x=>/MSC QA DEPARTED.*NAVE CHIUSA O PARTITA/s.test(x)));
    await page.locator('#cnt-ship-filter').fill('QA002');
    assert.equal(await page.locator('#cnt-vessel-list button').count(),1);
    await page.locator('#cnt-vessel-list button').click();
    assert.match(await page.locator('#results').innerText(),/CARICO BLOCCATO/);
    assert.match(await page.locator('#results').innerText(),/Booking Export/);
    const dims=await page.evaluate(()=>({view:document.documentElement.clientWidth,width:document.documentElement.scrollWidth}));
    assert.ok(dims.width<=dims.view+2,'Horizontal overflow at '+width+' '+JSON.stringify(dims));
    await page.locator('input[name="napoli-terminal"][value="tfg"]').check();
    assert.equal(await page.locator('#cnt-fleet').isVisible(),false);
    assert.equal(await page.locator('#tfg-fleet').isVisible(),true);
    await page.locator('input[name="port"][value="salerno"]').check();
    assert.equal(await page.locator('#cnt-fleet').isVisible(),false);
    assert.equal(await page.locator('#tfg-fleet').isVisible(),false);
    assert.equal(await page.locator('#sct-picker').isVisible(),true);
    assert.deepEqual(errors,[],'Browser JS exceptions');
    await page.close();
  }
  const page=await browser.newPage();
  await page.route('**/conateco.json*',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({...feed,acquired_at:yesterday})
  }));
  await page.route('**/tfg_schedule.json*',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({rows:[],acquired_at:null,source_updated_at:null})
  }));
  await page.goto(root,{waitUntil:'load'});
  await page.waitForFunction(()=>/DATI NON AGGIORNATI/.test(document.querySelector('#cnt-feed-alert')?.textContent||''));
  assert.equal(await page.locator('#cnt-vessel-list .result-label.good').count(),0,'Stale feed cannot show green');
  await page.close();
  console.log('CNT Chromium QA: mobile 320px, 390px, desktop 1280px, closed/stopped/cutoff/stale, terminal switch — PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
