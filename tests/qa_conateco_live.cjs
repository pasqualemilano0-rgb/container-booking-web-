const {chromium}=require('playwright');
const fs=require('node:fs');

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message.slice(0,150)));
  console.log('=== CONATECO browser test: real TLS/CORS ===');
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
  let result;
  try {
   result=await page.evaluate(async ()=>{
     try{
       const ctl=new AbortController();
       const abort=setTimeout(()=>ctl.abort(),15000);
       try{
         const res=await fetch('https://api.conateco.it/ConatecoServicesApi/Booking?id_booking=QA_NONEXISTENT_BOOKING_00000000',{
           method:'GET',mode:'cors',credentials:'omit',signal:ctl.signal
         });
         const data=await res.json().catch(()=>null);
         return {available:true,http:res.status,hasVessel:Boolean(data&&typeof data.B_NOMNAVE==='string'&&data.B_NOMNAVE.trim()),hasEta:Boolean(data&&data.B_ETA)};
       } finally {clearTimeout(abort);}
     }catch(e){return {available:false,error:String(e).slice(0,150)}}
   });
  } catch(e){result={available:false,error:String(e).slice(0,150)}}
  console.log('Public API browser access:',JSON.stringify(result));
  const forecast=await browser.newPage();
  const observed=[];
  forecast.on('response',async resp=>{
    const req=resp.request();
    if(['xhr','fetch','script'].includes(req.resourceType()) && /conateco/i.test(resp.url())){
      observed.push({type:req.resourceType(),status:resp.status(),url:resp.url().slice(0,220)});
    }
  });
  forecast.on('requestfailed',req=>{
    if(/conateco/i.test(req.url()))observed.push({type:'FAILED',url:req.url().slice(0,180),error:req.failure()?.errorText});
  });
  try {
    const res=await forecast.goto('https://www.conateco.it/berth-forecast/',{waitUntil:'domcontentloaded',timeout:15000});
    console.log('Forecast browser status',res?.status());
    await forecast.waitForTimeout(2500);
    console.log('Forecast AG Grid rows',await forecast.locator('.ag-row').count());
    console.log('Forecast visible ship names?',(await forecast.locator('.ag-cell').allTextContents()).slice(0,15).map(x=>x.slice(0,45)));
    console.log('Forecast header labels',(await forecast.locator('.ag-header-cell-text').allTextContents()).slice(0,30));
    console.log('Forecast first rows',(await forecast.locator('.ag-row').allTextContents()).slice(0,5).map(x=>x.slice(0,240)));
    console.log('CONATECO resources',JSON.stringify(observed.slice(0,40)));
    try {
      const apiFromSameOrigin=await forecast.evaluate(async()=>{
        try {
          const res=await fetch('https://api.conateco.it/ConatecoServicesApi/Booking?id_booking=QA_NONEXISTENT_BOOKING_00000000',{
            credentials:'omit',signal:AbortSignal.timeout(10000)
          });
          return {available:true,status:res.status};
        } catch(e){return {available:false,error:String(e).slice(0,90)};}
      });
      console.log('Booking API from official CONATECO origin:',apiFromSameOrigin);
    }catch(e){console.log('Same-origin API test unavailable',String(e).slice(0,150));}
  } catch(e){console.log('Forecast browser unavailable:',String(e).slice(0,160));}
  await forecast.close();
  console.log('Browser uncaught errors:',errors.slice(0,3));
  await page.close();
 }finally{await browser.close();}
})().catch(e=>{console.error('QA runner failure',e);process.exitCode=1});
