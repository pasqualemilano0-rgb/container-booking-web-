/** UI / mobile QA: authentic local terminal logo assets render on 320–1280 px. */
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const url="http://127.0.0.1:8765/index.html";
const noRows={rows:[],acquired_at:null,source_updated_at:null,updated_at:null};
async function setup(page) {
  const json=JSON.stringify(noRows);
  await page.route(/(?:conateco|tfg_schedule|sct)\.json(?:\?.*)?$/,route=>route.fulfill({
    status:200,contentType:"application/json",body:json
  }));
  await page.route("**/raw.githubusercontent.com/**",route=>route.fulfill({
    status:200,contentType:"application/json",body:json
  }));
}
(async ()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [320,390,768,1280]) {
      const page=await browser.newPage({viewport:{width,height:820},deviceScaleFactor:1});
      const errs=[];page.on("pageerror",err=>errs.push(err.message));
      await setup(page);
      await page.goto(url,{waitUntil:"load"});
      await page.waitForFunction(()=>[...document.querySelectorAll("img.terminal-logo")].every(img=>img.complete&&img.naturalWidth>0),{timeout:12000});
      const imgs=await page.locator("img.terminal-logo").evaluateAll(items=>items.map(img=>({
        src:img.getAttribute("src"),loaded:img.complete&&img.naturalWidth>0,
        actualWidth:img.naturalWidth,displayWidth:Math.round(img.getBoundingClientRect().width)
      })));
      assert.ok(imgs.length>=8,"logos present in port selectors, terminal tabs and headings");
      assert.ok(imgs.every(x=>x.loaded&&x.actualWidth>0),"every authentic logo image loaded");
      for(const path of ["conateco.png","tfg-portal.png","sct-compact.png"])
        assert.ok(imgs.some(x=>x.src.endsWith(path)),"missing terminal "+path);
      assert.equal(await page.locator("#cnt-fleet").isVisible(),true);
      assert.equal(await page.locator("#tfg-fleet").isVisible(),false);
      await page.locator('input[name="napoli-terminal"][value="tfg"]').check();
      assert.equal(await page.locator("#cnt-fleet").isVisible(),false);
      assert.equal(await page.locator("#tfg-fleet").isVisible(),true);
      assert.equal(await page.locator("#tfg-fleet .terminal-heading img.terminal-logo").count(),1);
      await page.locator('input[name="port"][value="salerno"]').check();
      assert.equal(await page.locator("#sct-picker").isVisible(),true);
      assert.equal(await page.locator("#sct-picker .terminal-heading img.terminal-logo").count(),1);
      assert.equal(await page.locator("#tfg-fleet").isVisible(),false);
      const g=await page.evaluate(()=>({
        available:document.documentElement.clientWidth,
        document:document.documentElement.scrollWidth,
        element:[...document.querySelectorAll(".port-logo-choice,.terminal-tab,.terminal-heading")].some(x=>{
          const rect=x.getBoundingClientRect();
          return rect.left < -3 || rect.right > document.documentElement.clientWidth+3;
        })
      }));
      assert.ok(g.document<=g.available+2,"no horizontal scrolling: "+width+"px "+JSON.stringify(g));
      assert.equal(g.element,false,"logos must remain within viewport at "+width+"px");
      assert.deepEqual(errs,[],"no JS page exceptions");
      await page.close();
    }
    console.log("Terminal logo Chromium QA PASS: 320, 390, 768, 1280px; files, tabs, labels, no overflow");
  }finally {await browser.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
