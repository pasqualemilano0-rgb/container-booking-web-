/* Auto-update browser code; user input and displayed results take priority. */
export function newerVersion(a,b){
 const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);
 return Number.isFinite(x[0])&&Number.isFinite(x[1])&&Number.isFinite(y[0])&&Number.isFinite(y[1])
   &&(x[0]>y[0]||(x[0]===y[0]&&x[1]>y[1]));
}
export function safeToInstall(s){
 return Boolean(s.visible&&!s.editing&&!s.resultsOpen&&s.scrollY<160);
}
if(typeof document!=='undefined'&&typeof window!=='undefined'){
 const current=document.querySelector('.app-footer span')?.textContent.match(/v(\d+\.\d+)/)?.[1];
 const status=document.getElementById('auto-update-status');
 let pending=false,checking=false,installing=false;
 function editing(){
  const active=document.activeElement;
  if(active?.matches?.('input:not([type="radio"]):not([type="checkbox"]),textarea,select'))return true;
  return Array.from(document.querySelectorAll('input,textarea')).some(el=>
   el.matches('input:not([type="radio"]):not([type="checkbox"]),textarea')
     &&String(el.value||'').trim().length>0);
 }
 function installIfSafe(){
  if(!pending||installing)return;
  if(!safeToInstall({visible:!document.hidden,editing:editing(),
   resultsOpen:!!document.querySelector('#results:not([hidden])'),scrollY:window.scrollY||0}))return;
  installing=true;
  if(status)status.textContent='Aggiornamento automatico in corso…';
  const button=document.getElementById('refresh-app');
  if(button)button.click();
  else {const url=new URL(window.location.href);url.searchParams.set('auto',String(Date.now()));window.location.replace(url.toString());}
 }
 async function checkVersion(){
  if(checking||installing||document.hidden||navigator.onLine===false||!current)return;
  checking=true;
  try{
   const url=new URL('./index.html',window.location.href);
   url.searchParams.set('check_version',String(Date.now()));
   const response=await fetch(url.toString(),{cache:'no-store',credentials:'omit'});
   if(!response.ok)return;
   const html=await response.text();
   const remote=html.match(/Container Booking Web\s*·\s*v(\d+\.\d+)/)?.[1];
   if(remote && newerVersion(remote,current)){
    pending=true;
    if(status)status.textContent='Nuova versione pronta: installazione automatica alla fine della ricerca.';
    installIfSafe();
   }
  }catch{
   if(status)status.textContent='Aggiornamento automatico in attesa di rete';
  }finally{checking=false;}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){void checkVersion();installIfSafe();}});
 window.addEventListener('focus',()=>{void checkVersion();installIfSafe();});
 window.addEventListener('online',()=>{void checkVersion();installIfSafe();});
 window.addEventListener('scroll',installIfSafe,{passive:true});
 document.addEventListener('input',installIfSafe);
 document.addEventListener('change',installIfSafe);
 window.setInterval(()=>void checkVersion(),4*60*1000);
 window.setInterval(installIfSafe,15000);
 void checkVersion();
}
