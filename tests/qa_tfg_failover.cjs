const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ORIGIN='https://pasqualemilano0-rgb.github.io';
const PREFIX='/container-booking-web-/';
const CF='container-booking-backend.pasqualemilano0.workers.dev';
const now=new Date().toISOString();
const tfg={source:'https://tfg.bucci.it/@/TFGW_TP_ETA',live:false,acquired_at:now,source_updated_at:now,
 rows:[{vessel:'QA BACKUP VESSEL',arrival_voyage:'QA0',departure_voyage:'QA1',
 eta:'01/11/29 12:00',acceptance:'ACCETTA CARICO',gate_cut_off:'01/11/29 15:00',
 custom_close_time:'',fast_corridor_cut_off:'',destination:'INTERNO PORTO'}]};
function mime(p){
 if(p.endsWith('.html'))return 'text/html';
 if(p.endsWith('.js')||p.endsWith('.mjs'))return 'text/javascript';
 if(p.endsWith('.css'))return 'text/css';
 if(p.endsWith('.png'))return 'image/png';
 if(p.endsWith('.svg'))return 'image/svg+xml';
 if(p.endsWith('.json'))return 'application/json';
 return 'application/octet-stream';
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>requests.push(r.url()));
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname===CF&&(u.pathname==='/api/tfg'||u.pathname==='/api/tfg/snapshot')){
    return route.fulfill({status:503,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':ORIGIN},body:'{"error":"TFG_NOT_VERIFIABLE"}'});
   }
   if(u.hostname==='raw.githubusercontent.com'&&u.pathname.endsWith('/tfg_schedule.json')){
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(tfg)});
   }
   if(u.hostname==='pasqualemilano0-rgb.github.io'&&u.pathname.startsWith(PREFIX)){
    const rel=decodeURIComponent(u.pathname.slice(PREFIX.length))||'index.html';
    if(rel.includes('..'))return route.abort();
    if(rel==='data/tfg_schedule.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(tfg)});
    if(rel==='data/conateco.json'||rel==='data/sct.json')return route.fulfill({status:503,body:'{}'});
    try{return route.fulfill({status:200,contentType:mime(rel),body:readFileSync(path.join(process.cwd(),rel))});}
    catch{return route.fulfill({status:404,body:'fixture unavailable'});}
   }
   return route.abort();
  });
  await page.goto(ORIGIN+PREFIX+'index.html',{waitUntil:'load'});
  await page.locator('button[data-open-terminal="tfg"]').click();
  await page.waitForFunction(()=>document.querySelector('#tfg-vessel-count')?.textContent.includes('1 viaggi'),null,{timeout:20000});
  const banner=await page.locator('#tfg-feed-alert').innerText();
  const list=await page.locator('#tfg-vessel-list').innerText();
  assert.match(banner,/lettura diretta TFG non riuscita/i);
  assert.match(list,/QA BACKUP VESSEL/);
  assert.match(list,/VERIFICA NON DISPONIBILE/);
  assert.equal(await page.locator('#tfg-vessel-list .result-label.good').count(),0,'A failed direct read never shows a green acceptance badge');
  assert.match(list,/Verifica diretta non disponibile/);
  await page.locator('#tfg-vessel-list button[data-tfg-row]').first().click();
  assert.equal(await page.locator('#results .delivery-spot-value').innerText(),'INTERNO PORTO');
  assert.match(await page.locator('#results .delivery-verification-warning').innerText(),/VERIFICA ATTUALE NON DISPONIBILE/);
  assert.ok(requests.includes('https://'+CF+'/api/tfg'),'The direct Cloudflare read must be attempted');
  assert.ok(requests.includes('https://'+CF+'/api/tfg/snapshot'),'The Cloudflare archive must be attempted before GitHub copies');
  assert.equal(requests.some(url=>!new Set(['pasqualemilano0-rgb.github.io',CF,'raw.githubusercontent.com','api.conateco.it','www.conateco.it','tfg.bucci.it']).has(new URL(url).hostname)),false,'No undeclared backend fallback');
  assert.deepEqual(errors,[]);
  console.log('PASS TFG: 503 da Cloudflare -> copia GitHub senza falsa conferma o altri backend');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
