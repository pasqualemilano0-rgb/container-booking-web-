const {chromium}=require('playwright');
const assert=require('node:assert/strict');

const URL='http://127.0.0.1:8765/index.html';
const now=new Date();
const stamp=mins=>new Date(now.getTime()+mins*60000).toISOString();
const rome=when=>{
  const v=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(when).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return v.day+'/'+v.month+'/'+v.year+' '+v.hour+':'+v.minute;
};
const OPEN=rome(new Date(Date.now()+48*3600000));
const EXPIRED=rome(new Date(Date.now()-48*3600000));
const rows=[
 {vessel:'QA MSC SALERNO OPEN',voyage:'QA01',eta:OPEN,closing:OPEN,
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'CARGO ACCEPTED',status:'PENDING'},
 {vessel:'QA REEFER BLOCK',voyage:'QA02',eta:OPEN,closing:OPEN,
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'NOT ACCEPTED',status:'PENDING'},
 {vessel:'QA SHIP CLOSED',voyage:'QA03',eta:OPEN,closing:EXPIRED+' CLOSED',
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'CARGO ACCEPTED',status:'PENDING'},
 {vessel:'QA DEPARTED',voyage:'QA04',eta:OPEN,closing:OPEN,
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'CARGO ACCEPTED',status:'DEPARTED'},
];
for(let i=0;i<9;i++)rows.push({...rows[3],vessel:'QA SHIP '+i,voyage:'Q'+i});
const sample=(minutes=3,sourceUpdated=null)=>({
  source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
  acquired_at:stamp(-minutes),updated_at:stamp(-minutes),source_updated_at:sourceUpdated,
  data_changed_at:stamp(-1000),rows
});
const noCnt={source:'QA CONATECO',rows:[],acquired_at:null};
const noTfg={source:'QA TFG',rows:[],acquired_at:null,source_updated_at:null};
async function pageScenario(browser,width,feed,options={}){
  const context=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:2});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/sct.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(feed)}));
  await context.route('**/conateco.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(noCnt)}));
  await context.route('**/tfg_schedule.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(noTfg)}));
  await page.goto(URL,{waitUntil:'domcontentloaded'});
  await page.locator('input[name="port"][value="salerno"]').check();
  await page.waitForFunction(()=>document.querySelectorAll('#sct-vessel-list button').length>=8,{timeout:15000});
  assert.equal(await page.locator('#sct-vessel-count').innerText(),'13 viaggi');
  // In the driver UI, Dry/Reefer filters live inside a collapsed details panel.
  await page.locator('#sct-picker details.driver-extra > summary').click();
  assert.equal(await page.locator('#sct-type').isVisible(),true);
  const dimension=await page.evaluate(()=>({a:document.documentElement.scrollWidth,b:document.documentElement.clientWidth}));
  assert.ok(dimension.a<=dimension.b+2,'Horizontal scrolling width '+width+' '+JSON.stringify(dimension));
  const stale=options.stale||false;
  const msg=await page.locator('#sct-alert').innerText();
  if(stale)assert.match(msg,/non recente|aggiornato/i);
  else assert.match(msg,/letto/i);
  await page.locator('#sct-type').selectOption('reefer');
  await page.locator('#sct-filter').fill('QA REEFER BLOCK');
  await page.waitForFunction(()=>document.querySelectorAll('#sct-vessel-list button').length===1);
  await page.locator('#sct-vessel-list button').click();
  await page.waitForSelector('#results:not([hidden])',{timeout:10000});
  let result=await page.locator('#results').innerText();
  assert.match(result,/QA REEFER BLOCK/);
  assert.match(result,/NON ACCETTA REFRIGERATI|DATI DA AGGIORNARE/);
  await page.locator('#sct-filter').fill('QA MSC SALERNO OPEN');
  assert.equal(await page.locator('#results').isVisible(),false,'Old ship details must vanish after vessel filter changes');
  await page.locator('#sct-vessel-list button').click();
  result=await page.locator('#results').innerText();
  if(stale) assert.doesNotMatch(result,/ACCETTA REFRIGERATI/);
  else assert.match(result,/ACCETTA REFRIGERATI/);
  await page.locator('#sct-only-open').check();
  assert.equal(await page.locator('#results').isVisible(),false,
    'Filtering accepted ships must clear prior ship result');
  await page.locator('#sct-only-open').uncheck();
  assert.equal(await page.locator('#results').isVisible(),false,
    'Disabling accepted filter must not revive stale result');
  await page.locator('#sct-filter').fill('QA SHIP CLOSED');
  await page.locator('#sct-vessel-list button').click();
  result=await page.locator('#results').innerText();
  assert.doesNotMatch(result,/ACCETTA ENTRAMBI I TIPI/);
  await page.locator('#sct-filter').fill('QA DEPARTED');
  await page.locator('#sct-vessel-list button').click();
  assert.match(await page.locator('#results').innerText(),/NAVE NON OPERATIVA|DATI DA AGGIORNARE/);
  // A vessel selection finishing asynchronously must not revive a result
  // after the driver has changed the ship filter.
  await page.evaluate(()=>{
    document.querySelector('#sct-vessel-list button').click();
    const field=document.getElementById('sct-filter');
    field.value='QA MSC SALERNO OPEN';
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#results').isVisible(),false,
    'Superseded SCT selection must not return after changing filter');
  // Navigator must hide SCT completely after switching back to Napoli.
  await page.locator('input[name="port"][value="napoli"]').check();
  assert.equal(await page.locator('#sct-picker').isVisible(),false);
  assert.equal(await page.locator('#results').isVisible(),false);
  assert.deepEqual(errors,[]);
  await context.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  await pageScenario(browser,390,sample());
  await pageScenario(browser,320,sample(180),{stale:true});
  await pageScenario(browser,1280,sample(3,stamp(-180)),{stale:true});
  // Simulated unavailability must show warning instead of old success.
  const context=await browser.newContext({viewport:{width:390,height:850}});
  const page=await context.newPage();
  await context.route('**/sct.json*',route=>route.fulfill({status:503,body:'Unavailable'}));
  await context.route('**/conateco.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(noCnt)}));
  await context.route('**/tfg_schedule.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(noTfg)}));
  await page.goto(URL,{waitUntil:'domcontentloaded'});
  await page.locator('input[name="port"][value="salerno"]').check();
  await page.waitForFunction(()=>/Dati SCT non disponibili/i.test(document.querySelector('#sct-alert')?.innerText||''),{timeout:12000});
  assert.equal(await page.locator('#sct-vessel-list button').count(),0);
  await context.close();
  process.stdout.write('SCT browser QA: 320/390/1280px, dry/reef, stale, closed, departed, network failure PASS\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
