/* One synthetic public booking query in a real Chromium browser.
 * No real booking numbers and no circumvention of TLS, CORS or site controls.
 */
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:false});
 const page=await context.newPage();
 const events=[];
 page.on('console',m=>{if(m.type()==='error')events.push(m.text().slice(0,180));});
 page.on('pageerror',e=>events.push(e.message.slice(0,180)));
 try{
   await page.route('https://pasqualemilano0-rgb.github.io/qa-booking-origin-only',route=>route.fulfill({
     status:200,contentType:'text/html',
     body:'<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src https://api.conateco.it"><title>Origin-only diagnostic</title>'
   }));
   await page.goto('https://pasqualemilano0-rgb.github.io/qa-booking-origin-only',{waitUntil:'load'});
   const result=await page.evaluate(async()=>{
     try{
       const url=new URL('https://api.conateco.it/ConatecoServicesApi/Booking');
       url.searchParams.set('id_booking','QA_NOT_A_REAL_BOOKING_999999999');
       const response=await fetch(url.toString(),{
         cache:'no-store',credentials:'omit',redirect:'error',
         signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}
       });
       if(!response.ok)return {status:response.status,ok:false};
       const data=await response.json();
       return {status:response.status,ok:true,jsonType:typeof data,
         hasReturnCode:Object.prototype.hasOwnProperty.call(data,'ReturnCode'),
         hasVessel:Object.prototype.hasOwnProperty.call(data,'B_NOMNAVE'),
         hasEta:Object.prototype.hasOwnProperty.call(data,'B_ETA'),
         fields:Object.keys(data).length};
     }catch(err){return {error:err.name,message:String(err.message).slice(0,160)};}
   });
   console.log('Browser origin/CORS/TLS result:',JSON.stringify(result));
   console.log('Console errors (truncated):',JSON.stringify(events.slice(0,5)));
   if(result.status!==200||!result.ok||!result.hasReturnCode)process.exitCode=1;
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
