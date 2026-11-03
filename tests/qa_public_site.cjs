/* Live production smoke test: no booking identifiers are sent.
 * Opens GitHub Pages on an Android-sized Chromium browser.
 * Fails if JS does not initialize, terminal switcher breaks or first-party
 * JS module requests return errors. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');

const SITES=[
  'https://pasqualemilano0-rgb.github.io/container-booking-web-/'
];
async function inspect(browser,url){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errors=[],missing=[],forbidden=[];
  await page.route('**/*',route=>{
    const host=new URL(route.request().url()).hostname;
    if(!new Set([new URL(url).hostname,'container-booking-backend.pasqualemilano0.workers.dev','raw.githubusercontent.com']).has(host)){
      forbidden.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror',e=>errors.push(String(e.message).slice(0,300)));
  page.on('response',r=>{
    try{
      const address=new URL(r.url());
      const origin=new URL(url).origin;
      if(address.origin===origin&&/\.(?:js|mjs)(?:\?|$)/.test(address.pathname)&&r.status()>=400)
        missing.push({url:address.pathname,status:r.status()});
    }catch{}
  });
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(response?.status(),200,'Site must serve HTTP 200');
    await page.locator('button[data-booking-target="tfg"]').waitFor({state:'visible',timeout:20000});
    await page.locator('button[data-booking-target="tfg"]').click();
    await page.waitForFunction(()=>document.querySelector('#search-btn')?.textContent?.includes('TFG'),
      {timeout:10000});
    assert.match(await page.locator('#search-btn').innerText(),/TFG/);
    await page.locator('button[data-booking-target="cnt"]').click();
    await page.waitForFunction(()=>document.querySelector('#search-btn')?.textContent?.includes('CNT'),
      {timeout:10000});
    assert.match(await page.locator('#search-btn').innerText(),/CNT/);
    await page.locator('input[name="port"][value="salerno"]').check();
    await page.locator('#sct-picker').waitFor({state:'visible',timeout:10000});
    await page.locator('input[name="port"][value="napoli"]').check();
    await page.locator('#query').waitFor({state:'visible',timeout:10000});
    await page.waitForTimeout(900);
    assert.deepEqual(missing,[],'First-party JS files must load');
    assert.deepEqual(errors,[],'No unhandled browser JS exceptions');
    assert.deepEqual(forbidden,[],'GitHub Pages must use only the declared backend and snapshot sources');
    const data=await page.evaluate(()=>({
      title:document.title,
      version:document.querySelector('.app-footer')?.textContent.match(/v\d+\.\d+/)?.[0],
      width:document.documentElement.clientWidth,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    }));
    assert.ok(data.overflow<=3,'No mobile horizontal overflow');
    console.log('PASS production browser',url,JSON.stringify(data));
  }finally{await page.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{for(const url of SITES)await inspect(browser,url);}
  finally{await browser.close();}
})().catch(e=>{console.error('FAIL production browser:',e.stack||e);process.exitCode=1;});
