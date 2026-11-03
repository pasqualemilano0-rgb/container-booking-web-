/* Browser regression: latest refresh must win, even when previous
 * network request finishes later. No real terminal or booking requests. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now=new Date().toISOString();
const cntRow=name=>({vessel:name,voyage:'Q001',eta:'2026-11-04 08:00',
 vessel_status:'PRE',category:'PREVISTE',acceptance_flag:'0',
 acceptance_icon:'NO_ACCETTA_CARICO',stop_cargo:'',external_depot:'N',
 source_conflict:false});
const tfgRow=name=>({vessel:name,departure_voyage:'QA001',arrival_voyage:'QA000',
 eta:'04/11/26 08:00',acceptance:'NAVE CHIUSA',destination:'INTERNO PORTO',
 custom_close_time:'',fast_corridor_cut_off:'',gate_cut_off:''});
const sct={source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
 acquired_at:now,rows:[{vessel:'QA SCT VESSEL',voyage:'QA1',eta:'04/11/26 08:00'}]};
async function main(){
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:840},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let cntCalls=0,tfgCalls=0;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  let body=null,delay=0;
  if(path.endsWith('/conateco.json')){
    const n=++cntCalls;
    delay=n===2?450:0;
    body={source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',acquired_at:now,rows:[cntRow(n===2?'QA OLD CNT':n>=3?'QA NEW CNT':'QA FIRST CNT')]};
  }else if(path.endsWith('/api/tfg')||path.endsWith('/tfg_schedule.json')){
    const n=++tfgCalls;
    delay=n===2?450:0;
    body={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',
      acquired_at:now,source_updated_at:now,live:true,booking_verified:false,
      rows:[tfgRow(n===2?'QA OLD TFG':n>=3?'QA NEW TFG':'QA FIRST TFG')]};
  }else if(path.endsWith('/sct.json'))body=sct;
  if(body){
    if(delay)await wait(delay);
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  }
  if(u.hostname==='127.0.0.1')return route.continue();
  return route.abort();
 });
 try{
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
  // The driver-first UI hides fleet inputs inside this collapsed details.
  // Open it without triggering an additional CNT refresh.
  await page.locator('#napoli-advanced > summary').click();
  assert.equal(await page.locator('#cnt-ship-filter').isVisible(),true);
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list')?.textContent.includes('QA FIRST CNT'));
  await page.evaluate(()=>{
    document.getElementById('cnt-reload').click();
    document.getElementById('cnt-reload').click();
  });
  await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list')?.textContent.includes('QA NEW CNT'));
  await wait(550);
  await page.locator('#cnt-ship-filter').fill('QA');
  const cntText=await page.locator('#cnt-vessel-list').innerText();
  assert.match(cntText,/QA NEW CNT/,'Fresh CNT data must win after out-of-order responses');
  assert.doesNotMatch(cntText,/QA OLD CNT/);

  await page.locator('button[data-open-terminal="tfg"]').click();
  await page.waitForFunction(()=>document.querySelector('#tfg-vessel-list')?.textContent.includes('QA FIRST TFG'));
  await page.evaluate(()=>{
    document.getElementById('tfg-reload').click();
    document.getElementById('tfg-reload').click();
  });
  await page.waitForFunction(()=>document.querySelector('#tfg-vessel-list')?.textContent.includes('QA NEW TFG'));
  await wait(550);
  await page.locator('#tfg-ship-filter').fill('QA');
  const tfgText=await page.locator('#tfg-vessel-list').innerText();
  assert.match(tfgText,/QA NEW TFG/,'Fresh TFG data must win after out-of-order responses');
  assert.doesNotMatch(tfgText,/QA OLD TFG/);
  assert.deepEqual(errors,[]);
  console.log('PASS overlapping refreshes: CNT + TFG newer data retained');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
