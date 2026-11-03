const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ORIGIN='https://pasqualemilano0-rgb.github.io';
const BASE=ORIGIN+'/container-booking-web-/';
const CF='container-booking-backend.pasqualemilano0.workers.dev';
const now=new Date();
const official=new Date(now.getTime()-7*24*60*60*1000); // Unchanged publication, verified by a new direct read.
const payload={
 source:'https://tfg.bucci.it/@/TFGW_TP_ETA',
 acquired_at:now.toISOString(),source_updated_at:official.toISOString(),
 live:true,booking_verified:false,
 rows:[
  {vessel:'QA TFG ACCETTA',departure_voyage:'QA10',arrival_voyage:'QA09',
   eta:'02/11/26 07:00',acceptance:'ACCETTA CARICO',gate_cut_off:'',
   custom_close_time:'',fast_corridor_cut_off:'',destination:'INTERNO PORTO'},
  {vessel:'QA TFG CHIUSA',departure_voyage:'QA20',arrival_voyage:'QA19',
   eta:'03/11/26 07:00',acceptance:'NAVE CHIUSA',gate_cut_off:'',
   custom_close_time:'',fast_corridor_cut_off:'',destination:'INTERNO PORTO'}
 ]
};
function mime(p){
 if(p.endsWith('.html'))return 'text/html; charset=utf-8';
 if(p.endsWith('.mjs')||p.endsWith('.js'))return 'text/javascript; charset=utf-8';
 if(p.endsWith('.css'))return 'text/css; charset=utf-8';
 if(p.endsWith('.png'))return 'image/png';
 if(p.endsWith('.svg'))return 'image/svg+xml';
 if(p.endsWith('.json'))return 'application/json; charset=utf-8';
 return 'application/octet-stream';
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],requests=[];
 page.on('pageerror',err=>errors.push(err.message));
 page.on('request',r=>requests.push(r.url()));
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname===CF&&u.pathname==='/api/tfg')
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':ORIGIN},body:JSON.stringify(payload)});
   if(u.hostname==='raw.githubusercontent.com')return route.abort();
   if(u.hostname==='pasqualemilano0-rgb.github.io'&&u.pathname.startsWith('/container-booking-web-/')){
    const p=decodeURIComponent(u.pathname.slice('/container-booking-web-/'.length))||'index.html';
    if(p.includes('..'))return route.abort();
    if(p==='data/conateco.json'||p==='data/sct.json')
      return route.fulfill({status:503,body:'{}'});
    try{return route.fulfill({status:200,contentType:mime(p),body:readFileSync(path.join(process.cwd(),p))});}
    catch{return route.fulfill({status:404,body:'Missing QA local asset'});}
   }
   return route.abort();
  });
  await page.goto(BASE+'index.html',{waitUntil:'load'});
  await page.locator('button[data-open-terminal="tfg"]').click();
  await page.waitForFunction(()=>document.querySelector('#tfg-vessel-count')?.textContent.includes('2 viaggi'),null,{timeout:20000});
  const accepted=page.locator('#tfg-vessel-list button').filter({hasText:'QA TFG ACCETTA'}).first();
  const closed=page.locator('#tfg-vessel-list button').filter({hasText:'QA TFG CHIUSA'}).first();
  assert.equal(await accepted.locator('.result-label.good').innerText(),'ACCETTA CARICO');
  assert.equal(await closed.locator('.result-label.bad').innerText(),'NON ACCETTA CARICO');
  assert.equal(await accepted.locator('.delivery-chip-value').innerText(),'INTERNO PORTO');
  assert.doesNotMatch(await page.locator('#tfg-vessel-list').innerText(),/ACCETTA CARICO · DATO VECCHIO|ACCETTA CARICO \(NAVE\)/);
  const msg=await page.locator('#tfg-feed-alert').innerText();
  assert.match(msg,/Lettura diretta riuscita/);
  assert.match(msg,/Ultimo aggiornamento TFG/);
  assert.match(msg,/booking non verificato/i);
  await accepted.click();
  assert.equal(await page.locator('#results .result-label.good').innerText(),'ACCETTA CARICO');
  assert.equal((await page.locator('#results .delivery-spot-value').innerText()).trim(),'INTERNO PORTO');
  assert.equal(await page.locator('#results .delivery-spot-tfg').getAttribute('data-freshness'),'recent','A successful direct read verifies the unchanged publication');
  const sourceDetails=page.locator('#results .delivery-spot-tfg .delivery-source-details');
  assert.equal(await sourceDetails.getAttribute('open'),null);
  assert.equal(await sourceDetails.locator('summary').innerText(),'Fonte e aggiornamento');
  assert.match(await sourceDetails.locator('.delivery-spot-note').textContent(),/Non verifica il singolo booking/);
  assert.equal(await sourceDetails.locator('.delivery-spot-note').isVisible(),false);
  const dates=await page.evaluate(stamps=>stamps.map(stamp=>new Intl.DateTimeFormat('it-IT',{
   dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'
  }).format(new Date(stamp))),[payload.acquired_at,payload.source_updated_at]);
  for(const date of dates)assert.ok((await sourceDetails.textContent()).includes(date),'Source/acquisition dates remain in the DOM');
  await sourceDetails.locator('summary').click();
  assert.equal(await sourceDetails.locator('.delivery-spot-note').isVisible(),true);
  assert.match(await sourceDetails.innerText(),/TERMINAL DI CONSEGNA/);
  assert.doesNotMatch(await page.locator('#results').innerText(),/ACCETTA CARICO · DATO VECCHIO/);
  assert.match(await page.locator('#results').innerText(),/Conferma dello stato.*ACCETTA CARICO/);
  assert.match(await page.locator('#results').innerText(),/Non costituisce conferma del singolo booking/);
  assert.ok(requests.includes('https://'+CF+'/api/tfg'),'HTTPS Pages reads the Cloudflare backend');
  assert.equal(requests.some(url=>!new Set(['pasqualemilano0-rgb.github.io',CF,'raw.githubusercontent.com','api.conateco.it','www.conateco.it','tfg.bucci.it']).has(new URL(url).hostname)),false,'No undeclared backend requests');
  assert.deepEqual(errors,[]);
  console.log('PASS TFG: lettura diretta, fonte invariata 7 giorni, luogo confermato e nave chiusa negativa');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
