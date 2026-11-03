const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const url='http://127.0.0.1:8765/index.html';
const now=new Date();
const iso=now.toISOString();
function rome(dt){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(dt).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return p.day+'/'+p.month+'/'+p.year+' '+p.hour+':'+p.minute;
}
const opening=rome(new Date(now.getTime()-6*3600e3));
const closing=rome(new Date(now.getTime()+48*3600e3));
const cnt={source:'QA only',acquired_at:iso,source_updated_at:null,rows:[{
  vessel:'MSC QA CONATECO',voyage:'QA001',eta:closing,category:'PREVISTE',vessel_status:'PRE',
  acceptance_flag:'1',acceptance_icon:'ACCETTA_CARICO',stop_cargo:'',opening,closing,
  source_conflict:false,external_depot:''
}]};
const tfg={source:'QA only',acquired_at:iso,source_updated_at:iso,rows:[{
  vessel:'X PRESS QA SAGARMALA',arrival_voyage:'644E',departure_voyage:'645W',
  eta:closing,acceptance:'NON ACCETTA CARICO',cut_off:'',destination:'INTERNO PORTO'
}]};
const sct={source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',acquired_at:iso,updated_at:iso,data_changed_at:iso,source_updated_at:null,rows:[{
  vessel:'SCT QA NAVIGATION',voyage:'SALQA1',eta:closing,closing,
  acceptance_dry:'CARGO ACCEPTED',acceptance_reef:'NOT ACCEPTED',status:'PENDING'
}]};
async function mock(page){
  const data={conateco:cnt,tfg_schedule:tfg,sct};
  await page.route(/\/(?:conateco|tfg_schedule|sct)\.json(?:\?.*)?$/,route=>{
    const part=route.request().url().match(/\/(conateco|tfg_schedule|sct)\.json/)[1];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data[part])});
  });
}
async function visibleRect(page,selector){
  return page.locator(selector).first().evaluate(x=>{
    const r=x.getBoundingClientRect();const css=getComputedStyle(x);
    return {height:r.height,width:r.width,font:parseFloat(css.fontSize),visible:r.width>0&&r.height>0};
  });
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,390,768,1280]){
    const page=await browser.newPage({viewport:{width,height:820},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await mock(page);
    await page.goto(url,{waitUntil:'load'});
    const notice=page.locator('.driver-notice');
    assert.equal(await notice.isVisible(),true,'stationary-use notice');
    assert.equal(await page.locator('section.hero').count(),0,'redundant hero removed');
    assert.equal(await page.locator('#cnt-fleet').isVisible(),true);
    assert.equal(await page.locator('#napoli-booking-details').isVisible(),true);
    assert.equal(await page.locator('#napoli-booking-details').evaluate(x=>x.open),false,'booking defaults collapsed');
    assert.equal(await page.locator('#query').isVisible(),false,'booking text not cluttering initial screen');
    assert.ok((await visibleRect(page,'label.port-logo-choice')).height>=80,'port selection touch target');
    assert.ok((await visibleRect(page,'.napoli-terminal-tabs .terminal-tab')).height>=74,'terminal selector touch target');
    assert.ok((await visibleRect(page,'#napoli-booking-details summary')).height>=60,'booking open target');
    assert.equal(await page.locator('img.terminal-logo').count(),8,'original logos still present');
    await page.waitForFunction(()=>document.querySelector('#cnt-vessel-list button')!==null,{timeout:15000});
    assert.ok((await visibleRect(page,'#cnt-vessel-list button')).height>=80,'ship card touch target');
    assert.ok((await visibleRect(page,'#cnt-ship-filter')).height>=54,'search target');
    assert.ok((await visibleRect(page,'#cnt-vessel-list .vessel-name')).font>=14,'readable ship name');
    assert.ok((await visibleRect(page,'#cnt-feed-alert')).font>=13,'readable alert');
    const overflow=await page.evaluate(()=>({
      client:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    assert.ok(overflow.scroll<=overflow.client+2,'no sideways scroll at '+width+': '+JSON.stringify(overflow));
    await page.locator('#napoli-booking-details > summary').click();
    assert.equal(await page.locator('#query').isVisible(),true,'booking input opened on demand');
    await page.locator('#query').fill('280252450');
    await page.locator('#search-btn').click();
    assert.equal(await page.locator('#results').isVisible(),true);
    assert.match(await page.locator('#results').innerText(),/DA VERIFICARE/);
    await page.locator('input[name="napoli-terminal"][value="tfg"]').check();
    assert.equal(await page.locator('#tfg-fleet').isVisible(),true);
    await page.locator('#tfg-ship-filter').fill('645W');
    await page.waitForFunction(()=>document.querySelectorAll('#tfg-vessel-list button').length===1);
    await page.locator('#tfg-vessel-list button').click();
    assert.match(await page.locator('#results').innerText(),/NON ACCETTA CARICO|NON AGGIORNATO/);
    await page.locator('input[name="port"][value="salerno"]').check();
    assert.equal(await page.locator('#cnt-fleet').isVisible(),false);
    assert.equal(await page.locator('#napoli-booking-details').isVisible(),false);
    assert.equal(await page.locator('#sct-picker').isVisible(),true);
    assert.equal(await page.locator('#sct-type').isVisible(),true,'type not hidden');
    assert.equal(await page.locator('#sct-only-open').isVisible(),false,'optional filter hidden');
    await page.waitForFunction(()=>document.querySelectorAll('#sct-vessel-list button').length===1,{timeout:15000});
    assert.ok((await visibleRect(page,'#sct-filter')).height>=54);
    await page.locator('#sct-filter').fill('SALQA1');
    await page.waitForFunction(()=>document.querySelectorAll('#sct-vessel-list button').length===1);
    await page.locator('#sct-extra-filters > summary').click();
    assert.equal(await page.locator('#sct-only-open').isVisible(),true);
    assert.ok((await visibleRect(page,'#sct-extra-filters > summary')).height>=48);
    await page.locator('#sct-type').selectOption('reefer');
    await page.locator('#sct-vessel-list button').click();
    assert.match(await page.locator('#results').innerText(),/NON ACCETTA REFRIGERATI|DATI DA AGGIORNARE/);
    await page.locator('input[name="port"][value="napoli"]').check();
    assert.equal(await page.locator('#napoli-booking-details').isVisible(),true);
    assert.equal(await page.locator('#napoli-booking-details').evaluate(x=>x.open),false,'resets expanded booking on port switch');
    const widths=await page.evaluate(()=>({
      client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
    }));
    assert.ok(widths.scroll<=widths.client+2,'no overflow after port changes at '+width);
    assert.deepEqual(errors,[],'no uncaught JS errors at width '+width);
    await page.close();
  }
  console.log('Driver-first Chromium QA PASS: 320/390/768/1280px; port, terminals, booking, Dry/Reefer, stale safety, large touch targets and no overflow');
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
