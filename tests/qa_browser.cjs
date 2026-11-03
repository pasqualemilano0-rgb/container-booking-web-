/**
 * Browser integration tests for staging only. The mocked TFG schedule is not
 * published to users and is never treated as real terminal availability.
 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const url='http://127.0.0.1:8765/index.html';
const now=new Date();
const fresh=new Date(now.getTime()-4*60000).toISOString();
const stale=new Date(now.getTime()-48*3600000).toISOString();
const example=[{
  vessel:'X PRESS SAGARMALA',arrival_voyage:'644E',departure_voyage:'645W',
  eta:'05/11/26 08:00',acceptance:'CARICO DAL 30/10/26 08:00:00',
  cut_off:'',destination:'INTERNO PORTO'
}];
for(let i=0;i<11;i++){
  example.push({
    vessel:'TEST SHIP '+String(i).padStart(2,'0'),
    arrival_voyage:'R'+i,
    departure_voyage:'D'+i,
    eta:'10/11/26',acceptance:'NON ACCETTA CARICO',
    cut_off:'',destination:'INTERNO PORTO'
  });
}
const feed=(date)=>({source:'TFG TEST FIXTURE',source_updated_at:date,acquired_at:date,rows:example});
async function testScenario(browser,width,height,age) {
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2});
  const exceptions=[];
  page.on('pageerror',err=>exceptions.push(err.message));
  await page.route('**/tfg_schedule.json*',async route=>{
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(feed(age))});
  });
  await page.route('**/conateco.json*',async route=>{
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({source:'QA EMPTY',rows:[],acquired_at:null})});
  });
  await page.goto(url,{waitUntil:'load'});
  await page.locator('input[name="napoli-terminal"][value="tfg"]').check();
  await page.waitForFunction(()=>document.querySelectorAll('#tfg-vessel-list button[data-tfg-row]').length===8,{timeout:20000});
  assert.equal(await page.locator('#tfg-vessel-count').textContent(),'12 viaggi');
  const msg=await page.locator('#tfg-feed-alert').textContent();
  if(age===stale)assert.match(msg,/non aggiornato/i,'Stale TFG feed MUST show warning');
  else assert.match(msg,/acquisita/i);
  // Mobile and desktop: content must not overflow horizontally.
  const geometry=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));
  assert.ok(geometry.content<=geometry.viewport+2,'Horizontal overflow '+JSON.stringify({width,...geometry}));
  await page.locator('#tfg-show-more').click();
  assert.equal(await page.locator('#tfg-vessel-list button').count(),12);
  await page.locator('#tfg-ship-filter').fill('645W');
  assert.equal(await page.locator('#tfg-vessel-list button').count(),1);
  await page.locator('#tfg-vessel-list button').click();
  await page.waitForSelector('#results:not([hidden])');
  assert.match(await page.locator('#results').innerText(),/X PRESS SAGARMALA/);
  assert.match(await page.locator('#results').innerText(),/645W/);
  assert.match(await page.locator('#results').innerText(),/booking/i);
  assert.ok(!(/ACCETTA CARICO \(NAVE\)/.test(await page.locator('#results').innerText())),
    'A schedule with no valid cut-off must not claim acceptance as confirmed');
  // Switching to Salerno hides Napoli fleet and does not show cross-port results.
  await page.locator('input[name="port"][value="salerno"]').check();
  assert.equal(await page.locator('#tfg-fleet').isVisible(),false);
  assert.equal(await page.locator('#sct-picker').isVisible(),true);
  assert.equal(await page.locator('#results').isVisible(),false);
  assert.deepEqual(exceptions,[],'No JavaScript errors');
  await page.close();
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    await testScenario(browser,390,844,fresh);
    await testScenario(browser,320,720,stale);
    await testScenario(browser,1280,800,fresh);
    // Missing data: show warning and official link; never assert a good status.
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/tfg_schedule.json*',async route=>{
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({source:'QA EMPTY',rows:[],acquired_at:null,source_updated_at:null})});
    });
    await page.route('**/conateco.json*',async route=>{
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({source:'QA EMPTY',rows:[],acquired_at:null})});
    });
    await page.goto(url,{waitUntil:'load'});
    await page.locator('input[name="napoli-terminal"][value="tfg"]').check();
    await page.waitForFunction(()=>/non acquisito automaticamente/i.test(document.querySelector('#tfg-feed-alert')?.textContent||''),{timeout:20000});
    assert.equal(await page.locator('#tfg-vessel-list button').count(),0);
    assert.equal(await page.locator('#tfg-fleet a.tfg-direct-link').getAttribute('href'),'https://tfg.bucci.it/@/TFGW_TP_ETA');
    assert.deepEqual(errors,[]);
    await page.close();
    process.stdout.write('Browser QA: mobile 390, small mobile 320, desktop 1280, stale/empty schedule — PASS\n');
  }finally{await browser.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1});
