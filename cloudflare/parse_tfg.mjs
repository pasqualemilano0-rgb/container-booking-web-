/** Conservative parsing of the public TFG vessel schedule: never a booking check. */
export const SOURCE='https://tfg.bucci.it/@/TFGW_TP_ETA';
const DATE=/^\d{2}\/\d{2}\/(?:\d{2}|\d{4})$/;
const NAME=/^[A-Z0-9][A-Z0-9 .'-]{2,80}$/i;
const VOYAGE=/^[A-Z0-9./-]{1,26}$/i;
const UPDATE=/Ultimo\s+aggiornamento\s*:\s*(\d{2}\/\d{2}\/(?:\d{2}|\d{4}))\s+alle\s+(\d{1,2}:\d{2}:\d{2})/i;
const REQUIRED=['ARR.VOY','DEPT.VOY','ACCETTA CARICO','TERMINAL DI CONSEGNA'];
const INVALID_DEST=new Set(['','S','N','SI','NO','N/D','ND','N.A.','NA','N/A','-','—',
  'NON INDICATO','NON DISPONIBILE','DA VERIFICARE','UNKNOWN','NULL','LUOGO NON PUBBLICATO']);
const norm=x=>String(x??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
function terminalDiConsegna(value){
 const p=norm(value).toUpperCase();
 if(INVALID_DEST.has(p)||p.length<3||p.length>80)return '';
 if(!/^[A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 .,&()'/-]{2,79}$/u.test(p))return '';
 return p==='DRY PORT'?'DRYPORT':p;
}
function partsRome(date){
 const f=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 return Object.fromEntries(f.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
export function parseUpdated(text){
 const m=norm(text).match(UPDATE);
 if(!m)throw Error('TFG_UPDATE_MISSING');
 const [dd,mm,yy]=m[1].split('/').map(Number);
 const [h,min,sec]=m[2].split(':').map(Number);
 const year=yy<100?2000+yy:yy;
 const millis=Date.UTC(year,mm-1,dd,h,min,sec);
 const check=new Date(millis);
 if(year<2020||year>2100||check.getUTCFullYear()!==year||
   check.getUTCMonth()!==mm-1||check.getUTCDate()!==dd||
   h>23||min>59||sec>59)throw Error('TFG_UPDATE_INVALID');
 const options=[1,2].map(offset=>{
   const stamp=new Date(millis-offset*3600e3);
   const x=partsRome(stamp);
   return +x.year===year&&+x.month===mm&&+x.day===dd&&
     +x.hour===h&&+x.minute===min&&+x.second===sec?stamp:null;
 }).filter(Boolean);
 if(options.length!==1)throw Error('TFG_UPDATE_DST_AMBIGUOUS');
 return options[0].toISOString();
}
export function parseRows(trs){
 if(!Array.isArray(trs)||trs.length>1500)throw Error('TFG_ROWS_SIZE');
 const rows=[],seen=new Set();
 for(const tr of trs){
  if(!Array.isArray(tr)||tr.length<14||tr.length>40)continue;
  const c=tr.map(x=>norm(x).slice(0,250));
  if(!DATE.test(c[0])||(c[2]&&!DATE.test(c[2])))continue;
  if(!NAME.test(c[4])||!VOYAGE.test(c[5])||!VOYAGE.test(c[8]))continue;
  // TFG lascia talvolta vuoto l'orario ETA, come fa il parser Python verificato.
  // Non eliminare l'intera nave quando manca soltanto l'ora.
  if(c[1]&&!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(c[1]))continue;
  const eta=(c[0]+' '+c[1]).trim();
  const key=[c[4].toUpperCase(),c[8].toUpperCase(),eta].join('|');
  if(seen.has(key))continue;
  seen.add(key);
  const accepted=['ACCETTA CARICO','NAVE CHIUSA','CARICO DAL','IMBARCO CHIUSO','NON ACCETTA']
    .some(x=>c[10].toUpperCase().includes(x));
  rows.push({
   vessel:c[4],arrival_voyage:c[5],departure_voyage:c[8],eta,
   acceptance:accepted?c[10]:'',
   custom_close_time:c[9],fast_corridor_cut_off:c[11],
   gate_cut_off:'',destination:terminalDiConsegna(c[12])
  });
 }
 if(!rows.length||rows.length>200)throw Error('TFG_ROWS_UNVERIFIED');
 return rows;
}
export function validateDocument(text,trs,now=new Date()){
 const visible=norm(text).toUpperCase();
 if(!REQUIRED.every(x=>visible.includes(x)))throw Error('TFG_HEADERS_CHANGED');
 const source_updated_at=parseUpdated(text);
 if(Date.parse(source_updated_at)>now.getTime()+300000)throw Error('TFG_UPDATE_FUTURE');
 return {source:SOURCE,source_updated_at,acquired_at:now.toISOString(),
  rows:parseRows(trs),live:true,booking_verified:false};
}
