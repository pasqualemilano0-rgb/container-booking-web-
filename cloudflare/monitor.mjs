/** Cloudflare scheduled public terminal monitor (no bookings, cookies or credentials).
 * All three official sources are checked independently every 15 minutes.
 * A failed/invalid read NEVER overwrites the last valid KV schedule.
 */
export const SPECS=Object.freeze({
  cnt:{source:'https://api.conateco.it/ConatecoServicesApi/BerthForecast',
    snapshot:'conateco.json',maxBytes:300000},
  tfg:{source:'https://tfg.bucci.it/@/TFGW_TP_ETA',
    snapshot:'tfg_schedule.json',maxBytes:1000000},
  sct:{source:'https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php',
    snapshot:'sct.json',maxBytes:900000}
});
export const CRON='*/15 * * * *';
const RAW_SNAPSHOTS='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/';
const CATEGORIES=['PRESENTI','PREVISTE','ORMEGGIATE','PARTITE'];
const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const safe=(v,max)=>clean(v).slice(0,max);
const alphaName=/^[\p{L}\p{N}\s.'()\/&-]{3,120}$/u;
const voyagePattern=/^[A-Z0-9./_-]{1,35}$/i;
const toMs=x=>typeof x==='string'?Date.parse(x):NaN;
const recent=(stamp,now,maxMinutes)=>Number.isFinite(toMs(stamp))
  &&toMs(stamp)<=now.getTime()+300000&&now.getTime()-toMs(stamp)<=maxMinutes*60000;
function wallDate(d,t){
  let date=safe(d,24);
  if(/^\d{8}$/.test(date))date=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6);
  const time=clean(t).replace('.',':');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,2}:\d{2}$/.test(time))return '';
  const [year,month,day]=date.split('-').map(Number);
  const [hours,minutes]=time.split(':').map(Number);
  const check=new Date(Date.UTC(year,month-1,day,hours,minutes));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1
    ||check.getUTCDate()!==day||hours>23||minutes>59)return '';
  return date+' '+String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');
}
function cntRow(item,category){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  const vessel=clean(item.nome_nave),voyage=clean(item.viaggioimbarco);
  const eta=wallDate(item.data_previ,item.ora_previs);
  if(!alphaName.test(vessel)||!voyagePattern.test(voyage)||!eta)return null;
  const flag=clean(item.accettaCarico),icon=clean(item.iconaStatoNave).toUpperCase();
  return {
    vessel,voyage,eta,
    vessel_status:safe(item.cod_stato,20).toUpperCase(),
    category,voyage_id:safe(item.id_viaggio,40),carrier:safe(item.nome_armatore,100),
    acceptance_flag:['0','1',''].includes(flag)?flag:'',
    acceptance_icon:['ACCETTA_CARICO','NO_ACCETTA_CARICO','CHIUSA',''].includes(icon)?icon:'',
    stop_cargo:safe(item.stopcarico,20).toUpperCase(),
    external_depot:safe(item.accettazioneesterni,140),
    opening:wallDate(item.tdtac1,item.torac1),
    closing:wallDate(item.tdtcd1,item.torcd1),
    notes:(safe(item.note,100)+' '+safe(item.note2,100)).trim().slice(0,160)
  };
}
export function parseCntCategories(categories,now=new Date()){
  const seen=new Map(),priority={PREVISTE:0,PRESENTI:1,ORMEGGIATE:2,PARTITE:3};
  for(const category of CATEGORIES){
    const data=categories?.[category];
    if(!Array.isArray(data)||data.length>2000)throw Error('CNT_BAD_CATEGORY');
    for(const item of data){
      const row=cntRow(item,category);
      if(!row)continue;
      const key=[row.voyage_id,row.vessel.toUpperCase(),row.voyage.toUpperCase()].join('|');
      const older=seen.get(key);
      if(!older){seen.set(key,{...row,source_conflict:false});continue;}
      const fields=['acceptance_flag','acceptance_icon','stop_cargo','closing','external_depot'];
      const conflict=fields.some(k=>older[k]!==row[k]);
      row.source_conflict=conflict||older.source_conflict;
      if(priority[category]>=priority[older.category])seen.set(key,row);
      else if(conflict)older.source_conflict=true;
    }
  }
  const rows=[...seen.values()].sort((a,b)=>a.eta.localeCompare(b.eta)||a.vessel.localeCompare(b.vessel));
  if(rows.length<2||rows.length>1200)throw Error('CNT_NO_VALID_ROWS');
  return {source:SPECS.cnt.source,source_updated_at:null,acquired_at:now.toISOString(),rows};
}
const SCT_HEADERS=['DATE','E.T.A.','VESSEL','VOYAGE','CLOSING TIME','STATUS'];
const SCT_STATUS=new Set(['PENDING','FORECAST','SCHEDULED','ARRIVED','BERTHED','IN PORT',
 'WORKING','LOADING','DEPARTED','SAILED','CLOSED','CANCELLED','CANCELED','COMPLETED','TERMINATED']);
const SCT_ACCEPTANCE=new Set(['CARGO ACCEPTED','NOT ACCEPTED','CARGO NOT ACCEPTED',
 'NOT ACCEPTING','CARGO REJECTED','REJECTED']);
const cleanStatus=v=>SCT_STATUS.has(clean(v).toUpperCase())?clean(v).toUpperCase():'';
const cleanAcceptance=v=>SCT_ACCEPTANCE.has(clean(v).toUpperCase())?clean(v).toUpperCase():'';
function sctDate(value){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if(!m)return false;
  const d=Number(m[1]),month=Number(m[2]),year=Number(m[3]);
  const chk=new Date(Date.UTC(year,month-1,d));
  return year>=2020&&year<=2100&&chk.getUTCFullYear()===year&&chk.getUTCMonth()===month-1&&chk.getUTCDate()===d;
}
function sctHeader(headers){
  const h=headers.map(x=>clean(x).toUpperCase()),found={};
  for(const field of SCT_HEADERS){
    const at=h.indexOf(field);
    if(at<0)return null;
    found[field]=at;
  }
  // SCT publishes an earlier informational DRY/REEF pair followed by STATUS
  // and the operative DRY/REEF pair. Match the LAST explicit headers, as the
  // GitHub Python importer does, rather than rejecting the valid table.
  found.dry=h.lastIndexOf('ACCEPTANCE DRY');
  found.reef=Math.max(h.lastIndexOf('ACCEPTANCE REEF'),h.lastIndexOf('ACCEPTANCE REEFER'));
  if(found.dry<=found.STATUS||found.reef<=found.STATUS||found.dry===found.reef)return null;
  return found;
}
export function parseSctTableRows(trs,now=new Date(),sourceUpdated=null){
  if(!Array.isArray(trs)||trs.length>2000)throw Error('SCT_TOO_MANY_ROWS');
  let columns=null;
  const rows=[],seen=new Set();
  for(const tr of trs){
    if(!tr||typeof tr!=='object')continue;
    if(tr.headers?.length){const next=sctHeader(tr.headers);if(next)columns=next;continue;}
    if(!columns||!Array.isArray(tr.cells))continue;
    const c=tr.cells.map(clean);
    if(c.length<=Math.max(...Object.values(columns)))continue;
    const date=c[columns.DATE],tm=c[columns['E.T.A.']];
    if(!sctDate(date))continue;
    const vessel=safe(c[columns.VESSEL],160),voyage=safe(c[columns.VOYAGE],60);
    if(vessel.length<3||voyage.length<1||vessel!==c[columns.VESSEL]||voyage!==c[columns.VOYAGE])continue;
    const eta=date+(/^\d{2}:\d{2}$/.test(tm)?' '+tm:'');
    const row={vessel,voyage,eta,
      closing:safe(c[columns['CLOSING TIME']],100),
      acceptance_dry:cleanAcceptance(c[columns.dry]),
      acceptance_reef:cleanAcceptance(c[columns.reef]),
      status:cleanStatus(c[columns.STATUS])};
    const key=[vessel.toUpperCase(),voyage.toUpperCase(),eta].join('|');
    if(!seen.has(key)){seen.add(key);rows.push(row);}
  }
  if(rows.length<2||rows.length>800)throw Error('SCT_NO_VALID_ROWS');
  return {source:SPECS.sct.source,acquired_at:now.toISOString(),updated_at:now.toISOString(),
   source_updated_at:sourceUpdated,rows};
}
/** Parses only table headers and cells, not arbitrary body text or guessed columns. */
export async function parseSctHtml(html,now=new Date(),factory){
  if(typeof html!=='string'||html.length<100||html.length>SPECS.sct.maxBytes)
    throw Error('SCT_HTML_SIZE');
  const rows=[];let tr=null,cell=null;
  const rw=(factory?factory():new HTMLRewriter())
    .on('tr',{element(el){
      const r={headers:[],cells:[]};tr=r;
      el.onEndTag(()=>{rows.push(r);if(tr===r)tr=null;});
    }})
    .on('tr > th',{element(el){
      if(!tr)return;
      const value={text:''};tr.headers.push(value);cell=value;
      el.onEndTag(()=>{if(cell===value)cell=null;});
    },text(chunk){if(cell&&cell.text.length<160)cell.text+=chunk.text.slice(0,160-cell.text.length);}})
    .on('tr > td',{element(el){
      if(!tr)return;
      const value={text:''};tr.cells.push(value);cell=value;
      el.onEndTag(()=>{if(cell===value)cell=null;});
    },text(chunk){if(cell&&cell.text.length<250)cell.text+=chunk.text.slice(0,250-cell.text.length);}});
  await rw.transform(new Response(html,{headers:{'Content-Type':'text/html'}})).text();
  return parseSctTableRows(rows.map(r=>({
    headers:r.headers.map(x=>x.text),cells:r.cells.map(x=>x.text)
  })),now);
}
async function official(url,fetcher,accept,maxBytes,timeout=18000){
  // Workers fetch does not implement RequestInit.cache; using that browser-only
  // field throws synchronously before any upstream request is attempted.
  const response=await fetcher(url,{method:'GET',redirect:'manual',
    credentials:'omit',headers:{Accept:accept,'Cache-Control':'no-cache',
      'User-Agent':'ContainerBooking-Monitor/1.0'},
    signal:typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'
      ?AbortSignal.timeout(timeout):undefined});
  if(!response.ok||response.redirected||response.status>=300)throw Error('SOURCE_HTTP');
  const contentType=(response.headers.get('content-type')||'').toLowerCase();
  if(!contentType.includes(accept==='application/json'?'json':'html'))throw Error('SOURCE_CONTENT_TYPE');
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('SOURCE_TOO_LARGE');
  const body=await response.text();
  if(body.length>maxBytes)throw Error('SOURCE_TOO_LARGE');
  return body;
}
export async function fetchOfficial(terminal,deps={},now=new Date()){
  const fetcher=deps.fetcher??fetch,config=SPECS[terminal];
  if(!config)throw Error('INVALID_TERMINAL');
  if(terminal==='cnt'){
    const categories={};
    await Promise.all(CATEGORIES.map(async category=>{
      const url=config.source+'?stato='+encodeURIComponent(category);
      const raw=await official(url,fetcher,'application/json',config.maxBytes);
      categories[category]=JSON.parse(raw);
    }));
    return parseCntCategories(categories,now);
  }
  const html=await official(config.source,fetcher,'text/html',config.maxBytes,20000);
  if(terminal==='tfg'){
    if(typeof deps.parseTfg!=='function')throw Error('TFG_NO_PARSER');
    const parsed=await deps.parseTfg(html,now);
    if(parsed?.source!==config.source||!Array.isArray(parsed.rows)||parsed.rows.length<2
       ||!Number.isFinite(toMs(parsed.source_updated_at))
       ||toMs(parsed.source_updated_at)>now.getTime()+300000
       ||parsed.live!==true||parsed.booking_verified!==false)
      throw Error('TFG_SOURCE_INVALID');
    return {...parsed,acquired_at:now.toISOString()};
  }
  return (deps.parseSct??parseSctHtml)(html,now);
}
function checkSnapshot(terminal,doc,now=new Date()){
  if(!doc||doc.source!==SPECS[terminal].source||!Array.isArray(doc.rows)
    ||doc.rows.length<2||doc.rows.length>1500)return false;
  const ms=toMs(doc.acquired_at);
  if(!Number.isFinite(ms)||ms>now.getTime()+300000)return false;
  if(terminal==='tfg'&&(!Number.isFinite(toMs(doc.source_updated_at))
    ||toMs(doc.source_updated_at)>now.getTime()+300000))return false;
  return true;
}
/** Independent fallback, already acquired by the read-only GitHub Actions
 * official parser. The acquired_at is preserved; no timestamp is rewritten. */
export async function fetchPublicSnapshot(terminal,fetcher=fetch,now=new Date()){
  if(!Object.hasOwn(SPECS,terminal))throw Error('INVALID_TERMINAL');
  const spec=SPECS[terminal];
  // GitHub Raw serves JSON files with text/plain in some regions; validate
  // the parsed document and exact official source, not this MIME guess.
  const response=await fetcher(RAW_SNAPSHOTS+spec.snapshot,{
    method:'GET',redirect:'manual',credentials:'omit',
    headers:{Accept:'application/json, text/plain;q=0.9'},
    signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(12000):undefined
  });
  if(!response.ok||response.redirected||response.status>=300)throw Error('GITHUB_HTTP');
  if(Number(response.headers.get('content-length'))>500000)throw Error('GITHUB_TOO_LARGE');
  const content=await response.text();
  if(content.length>500000)throw Error('GITHUB_TOO_LARGE');
  const payload=JSON.parse(content);
  if(!checkSnapshot(terminal,payload,now))throw Error('GITHUB_SNAPSHOT_INVALID');
  return {...payload,monitor_origin:'github_verified_fallback',
    live:false,booking_verified:false};
}
const key=t=>'schedule:'+t,stat=t=>'status:'+t;
// Versioned recovery points in the existing Cloudflare KV namespace.
// Separate keys protect against accidental overwrites, not account/KV outages.
// Retention: 7 days. Do not expose these keys through public API routes.
export async function archiveVerifiedSchedule(env,terminal,doc,now=new Date()){
  if(!env?.SCHEDULES_KV||!Object.hasOwn(SPECS,terminal)
     ||!checkSnapshot(terminal,doc,now))throw Error('BACKUP_INVALID');
  const acquired=Date.parse(doc.acquired_at);
  if(!Number.isFinite(acquired)||acquired>now.getTime()+300000)throw Error('BACKUP_TIMESTAMP');
  const archiveKey='backup:v1:'+terminal+':'+new Date(acquired).toISOString();
  await env.SCHEDULES_KV.put(archiveKey,JSON.stringify(doc),{expirationTtl:7*24*60*60});
  return archiveKey;
}

export async function readSchedule(env,terminal,now=new Date()){
  const saved=await env?.SCHEDULES_KV?.get(key(terminal),'json');
  if(!checkSnapshot(terminal,saved,now))return null;
  const age=now.getTime()-toMs(saved.acquired_at);
  const fromGitHub=saved.monitor_origin==='github_verified_fallback';
  return {...saved,mode:fromGitHub?'github_verified_fallback':'cloudflare_scheduled',
    live:false,booking_verified:false,
    // Publication age does not determine staleness; only acquisition does.
    stale:age>45*60*1000};
}
export async function getMonitorStatus(env,now=new Date()){
  const out={backend:'cloudflare-workers',schedule:CRON,checked_at:now.toISOString(),terminals:{}};
  for(const terminal of Object.keys(SPECS)){
    const status=await env?.SCHEDULES_KV?.get(stat(terminal),'json')??null;
    const schedule=await readSchedule(env,terminal,now);
    out.terminals[terminal]={
      state:!schedule?'no_data':schedule.stale?'stale'
        :status?.state==='error'?'error':status?.state==='fallback'?'fallback':'ok',
      last_attempt_at:status?.last_attempt_at??null,
      last_success_at:status?.last_success_at??null,
      last_error_code:status?.last_error_code??null,
      last_acquired_at:schedule?.acquired_at??null,
      source_updated_at:schedule?.source_updated_at??null,
      rows:schedule?.rows?.length??0
    };
  }
  return out;
}
export async function refreshTerminal(env,terminal,deps={},now=new Date()){
  if(!env?.SCHEDULES_KV)throw Error('KV_NOT_CONFIGURED');
  const old=await env.SCHEDULES_KV.get(key(terminal),'json');
  const before=await env.SCHEDULES_KV.get(stat(terminal),'json');
  try{
    const next=await fetchOfficial(terminal,deps,now);
    if(!checkSnapshot(terminal,next,now))throw Error('BAD_SCHEDULE');
    const prior=Array.isArray(old?.rows)?old.rows:[];
    if(prior.length>=4 && next.rows.length<Math.max(2,Math.floor(prior.length/2)))
      throw Error('UNEXPECTED_ROW_DROP');
    if(terminal==='tfg'&&Number.isFinite(toMs(old?.source_updated_at))
      &&toMs(next.source_updated_at)<toMs(old.source_updated_at))
      throw Error('OLDER_TERMINAL_UPDATE');
    if(terminal==='sct'){
      next.data_changed_at=JSON.stringify(prior)===JSON.stringify(next.rows)
        ?old.data_changed_at||old.acquired_at||now.toISOString():now.toISOString();
    }
    next.monitor_origin='cloudflare_official_read';
    if(!old||!Number.isFinite(toMs(old.acquired_at))||toMs(next.acquired_at)>toMs(old.acquired_at)){
      // Archive only changed schedules: avoid 288 extra writes/day on free KV.
      if(!old||JSON.stringify(old.rows)!==JSON.stringify(next.rows))
        await archiveVerifiedSchedule(env,terminal,next,now);
      await env.SCHEDULES_KV.put(key(terminal),JSON.stringify(next));
    }
    const last_error_code=null;
    // TFG only republishes when the vessel program changes.
    const state='ok';
    const status={state,last_error_code,last_attempt_at:now.toISOString(),
      last_success_at:now.toISOString(),source_updated_at:next.source_updated_at,
      rows:next.rows.length};
    await env.SCHEDULES_KV.put(stat(terminal),JSON.stringify(status));
    return {terminal,...status};
  }catch(e){
    const code=/^[A-Z_]{3,50}$/.test(String(e?.message))?String(e.message):'UPSTREAM_UNAVAILABLE';
    // The official site may block Cloudflare egress (currently SCT). GitHub
    // periodically imports the source with a separate strict parser. The
    // fallback is NEVER presented as a direct Cloudflare terminal read.
    try{
      const candidate=await fetchPublicSnapshot(terminal,deps.fetcher??fetch,now);
      const olderRows=Array.isArray(old?.rows)?old.rows:[];
      if(olderRows.length>=4&&candidate.rows.length<Math.max(2,Math.floor(olderRows.length/2)))
        throw Error('GITHUB_ROW_DROP');
      if(terminal==='tfg'&&Number.isFinite(toMs(old?.source_updated_at))
         &&toMs(candidate.source_updated_at)<toMs(old.source_updated_at))
        throw Error('GITHUB_OLDER_SOURCE');
      const newer=!old||!Number.isFinite(toMs(old.acquired_at))
        ||toMs(candidate.acquired_at)>toMs(old.acquired_at);
      const selected=newer?candidate:old;
      if(newer){
        if(!old||JSON.stringify(old.rows)!==JSON.stringify(candidate.rows))
          await archiveVerifiedSchedule(env,terminal,candidate,now);
        await env.SCHEDULES_KV.put(key(terminal),JSON.stringify(candidate));
      }
      const status={state:'fallback',last_error_code:code,last_attempt_at:now.toISOString(),
        last_success_at:now.toISOString(),source_updated_at:selected?.source_updated_at??null,
        rows:selected?.rows?.length??0};
      await env.SCHEDULES_KV.put(stat(terminal),JSON.stringify(status));
      return {terminal,...status};
    }catch{
      const status={state:'error',last_error_code:code,last_attempt_at:now.toISOString(),
        last_success_at:before?.last_success_at??null,source_updated_at:old?.source_updated_at??null,
        rows:Array.isArray(old?.rows)?old.rows.length:0};
      await env.SCHEDULES_KV.put(stat(terminal),JSON.stringify(status));
      return {terminal,...status};
    }
  }
}
export async function refreshAll(env,deps={},now=new Date()){
  const terminals=Object.keys(SPECS);
  return Promise.all(terminals.map(t=>refreshTerminal(env,t,deps,now)));
}
