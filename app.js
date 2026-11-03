import {tfgScheduleDelivery,conatecoForecastDelivery,conatecoDepotAcceptance} from './delivery_location.mjs?v=20261102-v62';
import {normalizeName,parseItalianDate,findSctVessels,evaluateSct,evaluateSctType,isSnapshotRecent,isSctFeedRecent,listSctVoyages,describeVesselStatus,describeClosing} from './rules.mjs?v=20261102-v65';
import {parseTfgBookingResult} from './tfg.mjs?v=20261031-v41';
import {validateBooking,bookingTerminal} from './booking_search.mjs?v=20261031-v41';
import {lookupTfgBooking} from './tfg_booking.mjs?v=20261102-v63';
import {lookupConatecoBooking,matchConatecoBookingToSchedule,matchConatecoVesselToForecast} from './conateco_booking.mjs?v=20261102-v64';
import {matchTfgVoyage,isTfgFeedFresh,evaluateTfgSchedule} from './tfg_schedule.mjs?v=20261102-v62';
import {evaluateConateco,isConatecoRecent} from './conateco_rules.mjs?v=20261102-v65';
import {selectConatecoFleet,isDepartedConateco} from './conateco_fleet.mjs?v=20261101-v50';

const urls = Object.freeze({
  cntBooking:'https://www.conateco.it/booking-export/',
  cntForecast:'https://www.conateco.it/berth-forecast/',
  tfgBooking:'https://tfg.bucci.it/@/TFGW_WW_BKK',
  tfgSchedule:'https://tfg.bucci.it/@/TFGW_TP_ETA',
  sctSchedule:'https://www.salernocontainerterminal.com/vessel-schedule/'
});
const terminals = {cnt:'CO.NA.TE.CO.',tfg:'Terminal Flavio Gioia',sct:'Salerno Container Terminal'};

const publicTfgSnapshot='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/tfg_schedule.json';
/**
 * GitHub Pages is branch-deployed. Commits by Actions using GITHUB_TOKEN do
 * not trigger Pages builds, so the raw public repository file is the freshest
 * snapshot. Fall back to the last deployed Pages copy if GitHub raw is down.
 * No booking number is ever included in either URL or request.
 */
const cloudflareTfgApiOrigin='https://container-booking-backend.pasqualemilano0.workers.dev';
/** Only the published GitHub Pages origin uses the Cloudflare monitor.
 * Local QA fixtures remain isolated from real public terminal data. */
function cloudflareMonitorUrl(route){
  const host=window.location.hostname.toLowerCase();
  if(window.location.protocol!=='https:')return null;
  if(host==='pasqualemilano0-rgb.github.io')
    return cloudflareTfgApiOrigin+route;
  return null;
}
function tfgOnDemandUrls(){
  // The schedule endpoint never receives a booking identifier.
  const endpoint=cloudflareMonitorUrl('/api/tfg');
  return endpoint?[endpoint]:[];
}
function hasOnDemandTfgBackend(){return tfgOnDemandUrls().length>0;}
async function loadTfgSnapshot(){
  const liveEndpoints=tfgOnDemandUrls();
  const liveRequested=liveEndpoints.length>0;
  for(const liveEndpoint of liveEndpoints){
    try{
      const response=await fetch(liveEndpoint,{
        cache:'no-store',credentials:'omit',
        signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(30000):undefined
      });
      if(!response.ok)throw new Error('API TFG non disponibile');
      const direct=await response.json();
      if(direct?.live!==true || direct.source!==urls.tfgSchedule
        || !Array.isArray(direct.rows) || !direct.rows.length
        || !direct.acquired_at || !direct.source_updated_at
        || direct.booking_verified!==false){
        throw new Error('Risposta TFG non verificata');
      }
      return direct;
    }catch{
      // A failed direct read is never labeled live. Continue with public copies.
    }
  }
  const sources=[
    cloudflareMonitorUrl('/api/tfg/snapshot'),
    publicTfgSnapshot+'?t='+Date.now(),'./data/tfg_schedule.json'
  ].filter(Boolean);
  let best=null,bestStamp=-Infinity;
  for(const source of sources){
    try{
      const response=await fetch(source,{cache:'no-store',credentials:'omit',
        signal:typeof AbortSignal.timeout==='function'
          ?AbortSignal.timeout(source.startsWith(cloudflareTfgApiOrigin)?7000:10000):undefined});
      if(!response.ok)continue;
      const data=await response.json();
      if(data?.source!==urls.tfgSchedule||!Array.isArray(data.rows)||!data.rows.length
        ||!Number.isFinite(Date.parse(data.acquired_at))
        ||!Number.isFinite(Date.parse(data.source_updated_at)))continue;
      const time=Date.parse(data.acquired_at);
      if(time>bestStamp){best={...data,live:false,live_failed:liveRequested};bestStamp=time;}
    }catch{
      // Keep the newest valid snapshot from the other providers.
    }
  }
  if(best)return best;
  throw new Error('Non riesco a leggere il programma TFG');
}


const byId = id=>document.getElementById(id);
const query=byId('query'), results=byId('results');
const sctPicker=byId('sct-picker'), sctStatus=byId('sct-picker-status');
const sctAlert=byId('sct-alert'), sctVesselList=byId('sct-vessel-list');
const sctVesselCount=byId('sct-vessel-count'), sctShowMore=byId('sct-show-more');
const sctFilter=byId('sct-filter'), sctType=byId('sct-type'), sctOnlyOpen=byId('sct-only-open');
let selectedPort='napoli';
let bookingLookupSeq=0;
let bookingLookupAbort=null;
let cntBookingRefresh=null;
let cntBookingTimer=null;
function cancelBookingLookup(){
  ++bookingLookupSeq;
  cntBookingRefresh=null;
  if(cntBookingTimer!==null){clearInterval(cntBookingTimer);cntBookingTimer=null;}
  if(bookingLookupAbort){bookingLookupAbort.abort();bookingLookupAbort=null;}
}
let sctCache=null;
let sctChoices=[];
let sctFiltered=[];
let chosenSctIndex=null;
let sctRequestId=0;
let sctDetailSeq=0; // Invalida esiti asincroni dopo modifiche a nave o filtro.
let sctVisibleLimit=8;

function node(tag, klass='', content) {
  const el=document.createElement(tag);
  if (klass) el.className=klass;
  if (content!==undefined) el.textContent=String(content);
  return el;
}
function clearAndAppend(el,...children){el.replaceChildren(...children);}
function row(label,value) {const el=node('div','fact'); el.append(node('span','',label),node('strong','',value??'Non disponibile'));return el;}
function facts(entries) {const el=node('div','facts');entries.forEach(([k,v])=>el.append(row(k,v)));return el;}
function badge(label,kind='neutral') {const el=node('span',`result-label ${kind}`);el.append(node('span','dot'),document.createTextNode(label));return el;}
function link(text,url,style='secondary-btn'){const a=node('a',style,text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function textBlock(msg, klass='result-notice'){return node('p',klass,msg);}
function terminalDeliveryPanel(place){
  const cnt=place.terminal==='cnt';
  const wrap=node('section','delivery-spot delivery-spot-terminal delivery-spot-'+place.terminal);
  wrap.setAttribute('aria-label',cnt?'Opzioni di consegna della nave':'Terminal di consegna pubblicato');
  wrap.dataset.freshness=place.inferred?'indicative':place.known?'recent':'published';
  wrap.dataset.scope=place.scope||'voyage';
  const top=node('div','delivery-spot-top');
  const icon=node('span','delivery-spot-icon');
  icon.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.7');
  const pin=document.createElementNS('http://www.w3.org/2000/svg','path');
  pin.setAttribute('d','M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z');
  const center=document.createElementNS('http://www.w3.org/2000/svg','circle');
  center.setAttribute('cx','12');center.setAttribute('cy','10');center.setAttribute('r','2.5');
  svg.append(pin,center);icon.append(svg);
  const heading=node('div','delivery-spot-heading');
  const value=node('strong','delivery-spot-value');
  if(place.choices?.length>1){
    value.classList.add('delivery-spot-options');
    place.choices.forEach((choice,index)=>{
      if(index)value.append(node('span','delivery-choice-or','/'));
      value.append(node('span','delivery-choice',choice));
    });
  }else value.textContent=place.value;
  heading.append(node('span','delivery-spot-label',cnt?'OPZIONI DI CONSEGNA · NAVE':'TERMINAL DI CONSEGNA'),value);
  if(place.terminal==='tfg'&&!place.known)heading.append(node('span','delivery-verification-warning',
    '⚠ VERIFICA ATTUALE NON DISPONIBILE · CONTROLLA TFG'));
  if(cnt&&place.externalNotice)heading.append(node('span','delivery-depot-status','DEPOT ESTERNI: OK'));
  top.append(icon,heading);
  const details=node('details','delivery-source-details');
  details.append(node('summary','','Fonte e aggiornamento'),
    node('p','delivery-spot-source',place.source),
    node('p','delivery-spot-note',place.note),
    facts([['Lettura effettuata',tfgTextDate(place.acquired_at)],
      [cnt?'Aggiornamento interno':'Aggiornamento TFG',cnt&&!place.source_updated_at?'Non pubblicato':tfgTextDate(place.source_updated_at)]]));
  wrap.append(top,details);
  return wrap;
}
function deliveryPanel(place){
  if((place.terminal==='tfg'&&place.published)||(place.terminal==='cnt'&&place.available))
    return terminalDeliveryPanel(place);
  const wrap=node('div','delivery-spot'+(place.known?'':' delivery-spot-unknown')
    +(place.inferred?' delivery-spot-indicative':'')
    +(place.externalNotice?' delivery-spot-external':''));
  const title=node('span','delivery-spot-label',
    place.inferred?'DESTINAZIONE INDICATIVA · DA VERIFICARE SUL BOOKING':'DOVE SCARICARE · '+place.source);
  const value=node('strong','delivery-spot-value',place.value);
  const note=node('small','delivery-spot-note',place.note);
  wrap.append(title,value);
  if(place.inferred)wrap.append(node('strong','delivery-spot-caution',
    '⚠ INDICAZIONE PRESUNTA · NON È IL LUOGO CONFERMATO DEL BOOKING'));
  if(place.externalNotice){
    wrap.append(node('strong','delivery-spot-external-notice',
      '⚠ DEPOSITI ESTERNI SEGNALATI · DRYPORT DA CONFERMARE'));
  }
  wrap.append(note);
  return wrap;
}
function deliveryChip(place){
  const cnt=place.terminal==='cnt'&&place.available;
  const styled=cnt||(place.terminal==='tfg'&&place.published);
  const chip=node('span','delivery-chip'+(place.known?'':' delivery-chip-unknown')
    +(place.inferred?' delivery-chip-indicative':'')
    +(place.externalNotice?' delivery-chip-external':'')
    +(styled?' delivery-chip-terminal delivery-chip-'+place.terminal:''));
  chip.append(
    node('span','delivery-chip-label',cnt?'CONSEGNA · NAVE':place.inferred
      ?'📍 DESTINAZIONE INDICATIVA · NON CONFERMATA'
      :place.terminal==='tfg'?'TERMINAL DI CONSEGNA':'📍 TERMINAL DI SCARICO / CONSEGNA'),
    node('strong','delivery-chip-value',place.value)
  );
  if(place.terminal==='tfg'&&place.published&&!place.known)
    chip.append(node('small','delivery-chip-caution','⚠ Verifica diretta non disponibile'));
  if(place.inferred&&!cnt)chip.append(node('small','delivery-chip-caution',
    'Verifica Booking Export prima di partire'));
  if(place.externalNotice&&!cnt){
    chip.append(node('small','delivery-chip-external-notice',
      '⚠ ESTERNI SEGNALATI · verifica il deposito sul booking'));
  }
  chip.title=place.note;
  return chip;
}

/* Depositi esterni: evidenziare il segnale ufficiale, NON inventare il luogo. */
function depotAcceptanceChip(status){
  const wrap=node('span','depot-acceptance-chip depot-acceptance-'+status.kind);
  wrap.append(node('span','depot-acceptance-label','ACCETTAZIONE SU DEPOSITI ESTERNI'),
    node('strong','depot-acceptance-value',status.value),
    node('small','depot-acceptance-hint','Luogo preciso e booking da verificare'));
  wrap.title=status.note;
  return wrap;
}
function depotAcceptancePanel(status){
  const wrap=node('section','depot-acceptance-panel depot-acceptance-'+status.kind);
  wrap.append(node('span','depot-acceptance-label','CO.NA.TE.CO. · ACCETTAZIONE SU DEPOSITI ESTERNI'),
    node('strong','depot-acceptance-value',status.value),
    node('p','depot-acceptance-note',status.note));
  return wrap;
}

function openResults(title, statusLabel,kind,description){
  results.hidden=false;
  const hdr=node('div','rheader'); hdr.append(node('h3','',title),badge(statusLabel,kind));
  clearAndAppend(results,hdr,textBlock(description));
  results.scrollIntoView({behavior:'smooth',block:'start'});
}
function currentBookingTerminal(){
  return document.querySelector('input[name="napoli-terminal"]:checked')?.value==='tfg'?'tfg':'cnt';
}
function refreshBookingTerminalChoice(){
  const selected=currentBookingTerminal();
  document.querySelectorAll('button[data-booking-target]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.bookingTarget===selected));
  });
  const button=byId('search-btn');
  button.firstChild.textContent=selected==='tfg'
    ?'⌕  CERCA BOOKING TFG '
    :'⌕  CERCA BOOKING CNT ';
  byId('query-help').textContent=selected==='tfg'
    ?'TFG: il servizio dell’app consulta il modulo ufficiale. Il numero viene inviato solo quando premi Cerca, senza salvataggio.'
    :'CO.NA.TE.CO.: ricerca diretta nel servizio Booking Export ufficiale. Il numero viene inviato soltanto a CO.NA.TE.CO. quando premi Cerca.';
}
function chooseBookingTerminal(terminal){
  const selected=bookingTerminal(terminal);
  const radio=document.querySelector('input[name="napoli-terminal"][value="'+selected+'"]');
  if(!radio)return;
  if(!radio.checked){
    radio.checked=true;
    radio.dispatchEvent(new Event('change',{bubbles:true}));
  }
  refreshBookingTerminalChoice();
  cancelBookingLookup();
  results.hidden=true; // Do not leave the previous terminal's outcome on screen.
}
document.querySelectorAll('button[data-booking-target]').forEach(button=>{
  button.addEventListener('click',()=>chooseBookingTerminal(button.dataset.bookingTarget));
});
document.querySelectorAll('input[name="napoli-terminal"]').forEach(radio=>{
  radio.addEventListener('change',()=>{
    refreshBookingTerminalChoice();
    cancelBookingLookup();
    results.hidden=true;
  });
});
refreshBookingTerminalChoice();

function getPort(){return document.querySelector('input[name=port]:checked')?.value||'napoli';}
function updateMode(){
  cancelBookingLookup();
  selectedPort=getPort();
  const salerno=selectedPort==='salerno';
  ++sctRequestId; // Ignora risposte arrivate dopo il cambio di porto.
  ++sctDetailSeq;
  chosenSctIndex=null;
  sctChoices=[];
  sctFiltered=[];
  sctVisibleLimit=8;
  sctPicker.hidden=!salerno;
  byId('napoli-terminal-switch').hidden=salerno;
  const napoliTerminal=document.querySelector('input[name=napoli-terminal]:checked')?.value||'cnt';
  byId('tfg-fleet').hidden=salerno||napoliTerminal!=='tfg';
  byId('cnt-fleet').hidden=salerno||napoliTerminal!=='cnt';
  byId('napoli-booking-controls').hidden=salerno;
  byId('napoli-booking-details').hidden=salerno;
  if(salerno)byId('napoli-booking-details').open=false;
  query.disabled=salerno;
  query.required=!salerno;
  sctFilter.value='';
  sctType.value='all';
  sctOnlyOpen.checked=false;
  sctVesselList.replaceChildren();
  sctAlert.textContent='Caricamento del programma navi…';
  sctAlert.dataset.state='loading';
  byId('query-label').textContent='Numero booking';
  query.placeholder='Es. EBKG19223970';
  byId('query-help').textContent='Consulta i controlli ufficiali: il luogo di scarico non viene confermato automaticamente.';
  refreshBookingTerminalChoice();
  query.value='';
  byId('booking-feedback').textContent='';
  results.hidden=true;
  autoRefreshActiveTerminal(true);
}
document.querySelectorAll('input[name=port]').forEach(r=>r.addEventListener('change',updateMode));
byId('clear-query').addEventListener('click',()=>{
  cancelBookingLookup();
  query.value='';
  chosenSctIndex=null;
  byId('booking-feedback').textContent='';
  results.hidden=true;
  query.removeAttribute('aria-invalid');
  query.focus();
});
query.addEventListener('input',()=>{
  cancelBookingLookup();
  chosenSctIndex=null;
  byId('booking-feedback').textContent='';
  query.removeAttribute('aria-invalid');
  if(selectedPort==='napoli')results.hidden=true;
});
sctVesselList.addEventListener('click',event=>{
  const button=event.target.closest('button[data-vessel-index]');
  if(!button || !sctVesselList.contains(button) || selectedPort!=='salerno')return;
  const rowIndex=Number(button.dataset.vesselIndex);
  const choice=sctFiltered.find(item=>item.index===rowIndex);
  if(!choice)return;
  chosenSctIndex=choice.index;
  renderPickerOptions();
  void renderSct(choice.row.vessel,chosenSctIndex);
});
sctShowMore.addEventListener('click',()=>{
  sctVisibleLimit+=8;
  renderPickerOptions();
});
sctFilter.addEventListener('input',()=>{
  ++sctDetailSeq;
  chosenSctIndex=null;
  sctVisibleLimit=8;
  results.hidden=true;
  renderPickerOptions();
});
sctOnlyOpen.addEventListener('change',()=>{
  ++sctDetailSeq;
  chosenSctIndex=null;
  results.hidden=true;
  sctVisibleLimit=8;
  renderPickerOptions();
});
sctType.addEventListener('change',()=>{
  ++sctDetailSeq;
  sctVisibleLimit=8;
  renderPickerOptions();
  if(chosenSctIndex!==null){
    const selected=sctFiltered.find(choice=>choice.index===chosenSctIndex);
    if(selected)void renderSct(selected.row.vessel,chosenSctIndex);
    else{
      chosenSctIndex=null;
      results.hidden=true;
      renderPickerOptions();
    }
  }
});
byId('reload-sct').addEventListener('click',()=>{
  if(selectedPort!=='salerno')return;
  ++sctDetailSeq;
  chosenSctIndex=null;
  sctVisibleLimit=8;
  results.hidden=true;
  void refreshSctPicker(true);
});
byId('search-form').addEventListener('submit',(event)=>{
  event.preventDefault();
  // Per Salerno si sceglie la nave dal Vessel Schedule, non il numero booking.
  if(selectedPort!=='napoli')return;
  const result=validateBooking(query.value);
  if(!result.valid){
    query.setAttribute('aria-invalid','true');
    byId('booking-feedback').textContent=result.reason;
    query.focus();
    results.hidden=true;
    return;
  }
  query.removeAttribute('aria-invalid');
  byId('booking-feedback').textContent='';
  query.value=result.booking;
  if(currentBookingTerminal()==='cnt'){
    void renderConatecoBooking(result.booking);
    return;
  }
  // TFG: a POST-only backend reads the official HTML reply and returns
  // only vetted vessel/voyage fields. Direct official form remains fallback.
  void renderTfgBooking(result.booking);
});

async function copy(value,el){
  try {
    if(!navigator.clipboard?.writeText)throw new Error('Appunti non disponibili');
    await navigator.clipboard.writeText(value);
    el.textContent='BOOKING COPIATO ✓';
  } catch {
    el.textContent='Copia manualmente il booking qui sopra';
  }
}
async function checkPublicTfgSchedule(data,host) {
  const section=node('section','tfg-cross-check');
  section.append(node('h4','','Programma navi TFG'));
  const content=node('div','tfg-check-content');
  content.append(textBlock('Controllo della copia pubblicata del programma TFG…','tiny'));
  section.append(content);
  host.append(section);
  const fail=(msg)=>{
    const warning=node('div','ops-alert');
    warning.dataset.state='warning';
    warning.textContent=msg;
    content.replaceChildren(warning,link('Apri il programma ufficiale TFG',urls.tfgSchedule));
  };
  if(!data.usable) {
    fail('Non posso incrociare il programma: nave, viaggio o booking non confermati nel testo copiato.');
    return;
  }
  try {
    const feed=await loadTfgSnapshot();
    const freshness=isTfgFeedFresh(feed);
    const match=matchTfgVoyage(data,feed);
    if(match.kind==='unavailable'||!feed.rows.length) {
      fail('La programmazione TFG non è ancora disponibile nell’app. Controlla la pagina ufficiale.');
      return;
    }
    if(match.kind!=='match'){
      fail(match.kind==='ambiguous'
        ?'Il viaggio compare più volte: impossibile identificare con certezza la partenza.'
        :'Nessuna corrispondenza certa tra la nave/viaggio del booking e la copia del programma TFG.');
      return;
    }
    const info=match.row;
    const verdict=evaluateTfgSchedule(info,feed);
    const last=feed.source_updated_at
      ?new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(feed.source_updated_at))
      :'non disponibile';
    const table=facts([
      ['Nave nel programma',info.vessel||'Non disponibile'],
      ['Viaggio di partenza',info.departure_voyage||'Non disponibile'],
      ['Stato pubblicato',info.acceptance||'Da verificare'],
      ['CUSTOM CLOSE TIME (TFG)',info.custom_close_time||'Non indicato'],
      ['Cut-off Fast Corridor',info.fast_corridor_cut_off||info.cut_off||'Non indicato'],
      ['Cut-off generale per consegna',info.gate_cut_off||'Da verificare al terminal'],
      ['Aggiornamento terminal',last]
    ]);
    content.replaceChildren(badge(verdict.label,verdict.kind),
      deliveryPanel(tfgScheduleDelivery(info,feed)),table,textBlock(verdict.reason,'note'));
    if(!freshness){
      const warning=node('div','ops-alert');
      warning.dataset.state='warning';
      warning.textContent=feed.live && !feed.live_failed
        ?'DATI NON AGGIORNATI RECENTEMENTE: lo stato ACCETTA CARICO conferma quanto pubblicato da TFG per la nave alla data indicata; non conferma il booking.'
        :'DATI NON AGGIORNATI. La copia del programma non conferma un’accettazione attuale.';
      content.append(warning);
    }
    content.append(link('Verifica i dati aggiornati direttamente su TFG',urls.tfgSchedule));
  } catch {
    fail('Impossibile leggere una copia attendibile del programma TFG. Nessuna accettazione confermata.');
  }
}

function showTfgExtracted(out,booking,host) {
  const data=parseTfgBookingResult(out,booking);
  host.replaceChildren();
  if(!data.hasContent){
    host.append(badge('RISULTATO NON VERIFICABILE','warn'),textBlock(
      data.reason||'Il testo non contiene un risultato TFG riconoscibile. Controlla di aver copiato booking, nave e viaggio.','note'));
    return;
  }
  const panel=node('article','tfg-parsed');
  const status=data.usable
    ?['ESTRATTO DAL TESTO TFG','neutral']
    :data.bookingState==='mismatch'
      ?['BOOKING DIVERSO','bad']
      :['DATI DA CONFERMARE','warn'];
  panel.append(badge(status[0],status[1]));
  panel.append(textBlock('Il luogo di scarico proviene esclusivamente dalla colonna TERMINAL DI CONSEGNA del programma ufficiale TFG.','note'));
  const values=[
    ['Nave',data.vessel||'Da verificare'],
    ['Viaggio',data.voyage||'Da verificare'],
    ['Data riportata',data.vesselDate||'Da verificare'],
    ['Armatore',data.carrier||'Da verificare']
  ];
  if(!data.usable){
    values.unshift(['Booking riportato',data.booking||'Non presente']);
    values.push(['Terminal di consegna','Da verificare nel programma TFG']);
  }
  panel.append(facts(values),textBlock(data.reason,'note'));
  const warning=node('div','ops-alert');
  warning.dataset.state='warning';
  warning.textContent='ACCETTAZIONE NON CONFERMATA · Risultato copiato, non certificato dall’app. Il terminal di consegna viene letto soltanto dal programma navi TFG. Ricontrolla prima della consegna.';
  panel.append(warning,link('Controlla programma navi TFG',urls.tfgSchedule));
  host.append(panel);
  void checkPublicTfgSchedule(data,host);
  host.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function buildTfgImporter(booking){
  const details=node('details','tfg-import');
  details.open=true;
  details.append(node('summary','','3. Incolla e controlla il risultato TFG'));
  details.append(textBlock(
    'Sul portale TFG cerca il booking, poi copia il testo del risultato. Torna qui e tocca «Incolla e leggi». La lettura del testo avviene sul telefono e non verifica nuovamente il portale.',
    'tiny'
  ));
  const area=node('textarea','tfg-textarea');
  area.rows=3;
  area.maxLength=16000;
  area.placeholder='Incolla il testo del risultato TFG…';
  area.setAttribute('aria-label','Risultato copiato dal sito TFG');
  area.setAttribute('spellcheck','false');
  const actions=node('div','actions');
  const output=node('div','tfg-output');
  const paste=node('button','secondary-btn','INCOLLA E LEGGI');
  paste.type='button';
  paste.addEventListener('click',async()=>{
    try{
      if(!navigator.clipboard?.readText)throw new Error('Appunti non disponibili');
      const value=(await navigator.clipboard.readText()).slice(0,16000).trim();
      if(!value){
        output.replaceChildren(textBlock('Gli appunti sono vuoti. Copia prima il risultato dal sito TFG.','note'));
        return;
      }
      area.value=value;
      paste.textContent='Testo acquisito ✓';
      showTfgExtracted(value,booking,output);
    }catch{
      paste.textContent='Incolla il testo manualmente';
      output.replaceChildren(textBlock('Il browser non consente di leggere gli appunti. Tieni premuto sul campo, incolla il testo e premi «Leggi risultato».','note'));
      area.focus();
    }
  });
  const run=node('button','primary','LEGGI RISULTATO');
  run.type='button';
  run.addEventListener('click',()=>{
    if(!area.value.trim()){
      output.replaceChildren(textBlock('Incolla il risultato TFG prima di continuare.','note'));
      area.focus();
      return;
    }
    showTfgExtracted(area.value,booking,output);
  });
  actions.append(paste,run);
  details.append(area,actions,output);
  return details;
}
/* CO.NA.TE.CO. official Booking Export API. The driver explicitly initiates
 * a single lookup; results are kept in memory and never stored or cached. */
function renderConatecoAcceptance(output,verdict,feed){
  output.dataset.state=verdict.kind;
  const label=badge(verdict.kind==='good'?'ACCETTA CARICO (NAVE)':verdict.label,verdict.kind);
  label.classList.add('booking-acceptance-label');
  output.replaceChildren(node('span','booking-vessel-label','STATO NAVE · BERTH FORECAST'),label,
    node('small','booking-acceptance-source',
      'Fonte: CO.NA.TE.CO. · Berth Forecast · '+(feed?.copy_origin||'Copia non disponibile')+
      ' · Acquisito: '+tfgTextDate(feed?.acquired_at)));
}
function renderConatecoDelivery(output,place){
  const source=output.querySelector('.delivery-source-details');
  const panel=deliveryPanel(place);
  const nextSource=panel.querySelector('.delivery-source-details');
  if(source?.open&&nextSource)nextSource.open=true;
  // Keep an unchanged card in place while the periodic age check runs.
  if(output.childElementCount===1&&output.firstElementChild.isEqualNode(panel))return;
  const focused=!!source&&document.activeElement===source.querySelector('summary');
  output.replaceChildren(panel);
  if(focused)nextSource?.querySelector('summary')?.focus({preventScroll:true});
}
function renderConatecoVesselContext(data,feed,output,acceptance,deliveryOutput){
  output.replaceChildren();
  const selected=matchConatecoVesselToForecast(data,feed);
  const vesselVerdict=selected.kind==='match'
    ?evaluateConateco(selected.row,feed)
    :{kind:'unknown',label:'ACCETTAZIONE DA VERIFICARE',
      reason:selected.kind==='ambiguous'
        ?'Più viaggi possibili per questa nave nel Berth Forecast: non posso scegliere lo stato corretto.'
        :'La nave del booking non è individuabile nel Berth Forecast disponibile.'};
  renderConatecoAcceptance(acceptance,vesselVerdict,feed);
  if(selected.kind==='match'&&selected.basis==='vessel-name'){
    const warning=node('div','booking-voyage-warning',
      '⚠ VIAGGIO DEL BOOKING NON CONFERMATO · Stato e opzioni riguardano soltanto la nave.');
    warning.setAttribute('role','note');
    acceptance.append(warning);
    acceptance.dataset.voyageMatch='vessel-only';
  }else{
    acceptance.dataset.voyageMatch=selected.kind==='match'?'eta-day':'unverified';
  }
  const optionsRow=selected.kind==='match'&&!isDepartedConateco(selected.row)?selected.row:null;
  renderConatecoDelivery(deliveryOutput,conatecoForecastDelivery(optionsRow,feed));
  output.append(textBlock(vesselVerdict.reason,'note'));
  if(selected.kind==='match'){
    output.append(facts([['Nave nel Berth Forecast',selected.row.vessel],
      ['Viaggio nel Berth Forecast',selected.row.voyage||'Non indicato'],
      ['Depot esterni',conatecoDepotAcceptance(selected.row,feed).value]]));
    if(selected.basis==='vessel-name')output.append(textBlock(
      'Corrispondenza per nome nave. Il viaggio del booking non è verificato.','booking-source'));
  }
  const matched=matchConatecoBookingToSchedule(data,feed);
  if(matched.kind!=='match'){
    const explanation=matched.kind==='ambiguous'
      ?'Nel Berth Forecast compaiono più viaggi con la stessa nave e lo stesso giorno ETA: destinazione e accettazione da verificare.'
      :matched.kind==='unverified'
        ?'ETA non interpretabile, viaggio non indicato o dati del programma in conflitto: non posso identificare con certezza il viaggio nel Berth Forecast.'
        :'Nave ed ETA del booking non coincidono con un viaggio unico del Berth Forecast: le opzioni visualizzate si riferiscono solo alla nave.';
    output.append(textBlock(explanation+' Controlla sempre il programma ufficiale.','note'));
    return;
  }
  output.append(node('h4','booking-vessel-caption','PROGRAMMA NAVE · NON CONFERMA IL BOOKING'));
}
async function showConatecoVesselContext(data,requestId,output,acceptance,deliveryOutput){
  let currentFeed=null;
  const active=()=>requestId===bookingLookupSeq&&selectedPort==='napoli'
    &&currentBookingTerminal()==='cnt'&&acceptance.isConnected;
  const refresh=next=>{
    if(!active())return;
    if(next===null){
      // Explicit load failure; never leave the prior booking card green.
      if(currentFeed)currentFeed={...currentFeed,refresh_failed:true};
      else {
        renderConatecoAcceptance(acceptance,{kind:'unknown',label:'ACCETTAZIONE DA VERIFICARE'});
        renderConatecoDelivery(deliveryOutput,conatecoForecastDelivery(null,null));
        output.replaceChildren(textBlock('Berth Forecast non disponibile: consulta il sito ufficiale.','note'));
        return;
      }
    }else if(next&&(next.refresh_failed===true||!currentFeed
      ||Date.parse(next.acquired_at)>=Date.parse(currentFeed.acquired_at))){
      currentFeed=next;
    }
    if(currentFeed)renderConatecoVesselContext(data,currentFeed,output,acceptance,deliveryOutput);
  };
  cntBookingRefresh=refresh;
  // Reevaluate age and cut-off locally; only public schedules are refreshed.
  cntBookingTimer=setInterval(()=>refresh(),30000);
  try{
    refresh(await loadCntSnapshot());
  }catch{
    if(!active()||currentFeed)return;
    renderConatecoAcceptance(acceptance,{kind:'unknown',label:'ACCETTAZIONE DA VERIFICARE'});
    renderConatecoDelivery(deliveryOutput,conatecoForecastDelivery(null,null));
    output.replaceChildren(textBlock('Berth Forecast non disponibile: consulta il programma ufficiale della nave.','note'));
  }
}
async function renderConatecoBooking(booking){
  cancelBookingLookup();
  const requestId=bookingLookupSeq;
  const controller=new AbortController();
  bookingLookupAbort=controller;
  const timeoutId=setTimeout(()=>controller.abort(),16000);
  openResults('Booking · CO.NA.TE.CO.','RICERCA IN CORSO','neutral',
    'Consultazione diretta del servizio Booking Export ufficiale. Nessuna conferma prima della risposta.');
  results.append(node('div','booking-loading','Consulto il terminal…'));
  try{
    const data=await lookupConatecoBooking(booking,undefined,controller.signal);
    if(requestId!==bookingLookupSeq||selectedPort!=='napoli'||currentBookingTerminal()!=='cnt')return;
    const success=data.kind==='vessel-found';
    openResults('Booking · CO.NA.TE.CO.',
      success?'DATI BOOKING RILEVATI':'BOOKING NON CONFERMATO',
      success?'good':'warn',
      success
        ?'Nave individuata dal Booking Export ufficiale.'
        :'Il servizio ufficiale non ha restituito una conferma utilizzabile. Controlla il risultato sul portale.');
    const terminalFacts=[
      ['ETA dal Booking Export',success?data.eta:'DA VERIFICARE'],
      ['Messaggio terminal',data.message||'Nessun messaggio aggiuntivo'],
      ['Stato accettazione del booking','NON VERIFICATO']
    ];
    let details,forecastDetails,acceptance,deliveryOutput;
    if(success){
      const vessel=node('div','booking-vessel-result booking-overview');
      vessel.append(node('span','booking-vessel-label','NAVE ASSOCIATA AL BOOKING'),
        node('strong','booking-vessel-name',data.vessel));
      acceptance=node('div','booking-vessel-acceptance');
      acceptance.setAttribute('role','status');
      acceptance.dataset.state='loading';
      acceptance.append(node('span','booking-acceptance-label','CONTROLLO ACCETTAZIONE…'));
      details=node('details','booking-terminal-details');
      forecastDetails=node('div','booking-forecast-details');
      deliveryOutput=node('div','booking-cnt-delivery');
      details.append(node('summary','','Dettagli del terminal'),facts(terminalFacts),forecastDetails,
        textBlock('Lo stato e le opzioni riguardano la nave: il singolo booking e l’ingresso non sono autorizzati dall’app.','booking-source'));
      results.append(vessel,acceptance,deliveryOutput,details);
    }else{
      results.append(facts([['Nave associata al booking','DA VERIFICARE'],...terminalFacts]));
    }
    results.append(textBlock('Fonte: CO.NA.TE.CO. · Booking Export. Nessun dato del booking viene salvato nell’app.','booking-source'));
    if(success)await showConatecoVesselContext(data,requestId,forecastDetails,acceptance,deliveryOutput);
  }catch{
    if(requestId!==bookingLookupSeq||selectedPort!=='napoli'||currentBookingTerminal()!=='cnt')return;
    openResults('Booking · CO.NA.TE.CO.','SERVIZIO NON DISPONIBILE','warn',
      'Non è stato possibile leggere la risposta ufficiale. Il booking NON è stato verificato. Puoi riprovare oppure aprire Booking Export.');
  }finally{
    clearTimeout(timeoutId);
    if(bookingLookupAbort===controller)bookingLookupAbort=null;
    if(requestId===bookingLookupSeq&&selectedPort==='napoli'&&currentBookingTerminal()==='cnt'){
      const actions=node('div','booking-api-actions');
      actions.append(link('APRI BOOKING EXPORT UFFICIALE',urls.cntBooking,'secondary-btn'));
      const btn=node('button','secondary-btn','COPIA BOOKING');
      btn.type='button';btn.addEventListener('click',()=>copy(booking,btn));
      actions.append(btn);
      results.append(actions);
    }
  }
}
/** One user-initiated submission to the official TFG booking form.
 * HTML form navigation does not require cross-origin CORS and keeps sensitive
 * results on the terminal's own site. No proxy, scraping or storage.
 */
function submitTfgOfficialForm(booking){
  const checked=validateBooking(booking);
  if(!checked.valid)return false;
  const form=node('form');
  form.method='POST';
  form.action=urls.tfgBooking;
  form.target='_blank';
  form.rel='noopener noreferrer';
  form.acceptCharset='UTF-8';
  form.style.display='none';
  for(const [name,value] of [['modo','2'],['bkk',checked.booking]]){
    const input=node('input');
    input.type='hidden';
    input.name=name;
    input.value=value;
    form.append(input);
  }
  document.body.append(form);
  try{
    form.submit();
    return true;
  }catch{
    // The manual official link remains available in the results panel.
    return false;
  }finally{
    form.remove();
  }
}
/* TFG automatic booking: source response + separate vessel schedule.
 * A positive official booking record is NOT a cargo acceptance guarantee.
 */
async function showTfgVesselContext(data,requestId,output=results,details=output){
  try{
    const feed=tfgFeed?.rows?.length?tfgFeed:await loadTfgSnapshot();
    if(requestId!==bookingLookupSeq||selectedPort!=='napoli'||currentBookingTerminal()!=='tfg')return;
    const candidate=matchTfgVoyage({usable:true,vessel:data.vessel,voyage:data.voyage},feed);
    if(candidate.kind!=='match'){
      output.append(textBlock(candidate.kind==='ambiguous'
        ?'Il programma TFG contiene più righe per la stessa nave/viaggio: non posso assegnare il terminal.'
        :'Nave e viaggio non incrociabili con certezza con il programma TFG: luogo di consegna da verificare.','note'));
      return;
    }
    const verdict=evaluateTfgSchedule(candidate.row,feed);
    const status=node('div','booking-tfg-status');
    status.dataset.state=verdict.kind;
    status.append(node('span','booking-vessel-label','STATO DELLA NAVE'),badge(verdict.label,verdict.kind));
    output.append(status,deliveryPanel(tfgScheduleDelivery(candidate.row,feed)));
    details.append(textBlock(verdict.reason,'note'));
    if(feed?.live!==true)details.append(textBlock(
      'Dati da copia pubblica del programma, non una lettura in diretta. Ricontrolla TERMINAL DI CONSEGNA sul sito TFG.','note'));
  }catch{
    if(requestId===bookingLookupSeq)output.append(textBlock(
      'Programma navi TFG non disponibile: luogo di consegna e accettazione da verificare.','note'));
  }
}
async function renderTfgBooking(booking){
  cancelBookingLookup();
  const requestId=bookingLookupSeq;
  const controller=new AbortController();
  bookingLookupAbort=controller;
  const timeoutId=setTimeout(()=>controller.abort(),45000);
  openResults('Booking · TFG','RICERCA IN CORSO','neutral',
    'Consultazione del modulo EXPORT BOOKING del sito ufficiale TFG tramite il servizio dell’app. Il numero non viene salvato.');
  results.append(node('div','booking-loading','Controllo il booking su TFG…'));
  try{
    const data=await lookupTfgBooking(booking,undefined,controller.signal);
    if(requestId!==bookingLookupSeq||selectedPort!=='napoli'||currentBookingTerminal()!=='tfg')return;
    const found=data.status==='found';
    openResults('Booking · TFG',found?'DATI BOOKING RILEVATI':'BOOKING NON CONFERMATO',found?'good':'warn',
      found?'Nave e viaggio trovati sul portale TFG.'
        :'Il modulo TFG non ha fornito un abbinamento booking/nave verificabile.');
    const entries=[
      ['Nave',found?data.vessel:'DA VERIFICARE'],
      ['Viaggio',found?data.voyage:'DA VERIFICARE'],
      ['Risposta del terminal',data.message],
      ['Accettazione booking','NON CONFERMATA']
    ];
    let context,details;
    if(found){
      const overview=node('div','booking-vessel-result booking-tfg-overview');
      const voyage=node('div','booking-voyage');
      voyage.append(node('span','','VIAGGIO'),node('strong','',data.voyage));
      overview.append(node('span','booking-vessel-label','NAVE ASSOCIATA AL BOOKING'),
        node('strong','booking-vessel-name',data.vessel),voyage);
      context=node('div','booking-tfg-context');
      details=node('details','booking-terminal-details booking-tfg-details');
      details.append(node('summary','','Dettagli del booking'),facts(entries));
      results.append(overview,context,details);
    }else{
      results.append(facts(entries));
    }
    results.append(textBlock('Fonte: TFG · Export Booking. Nessun booking archiviato.','booking-source'));
    if(found)await showTfgVesselContext(data,requestId,context,details);
  }catch(error){
    if(requestId!==bookingLookupSeq||selectedPort!=='napoli'||currentBookingTerminal()!=='tfg')return;
    const limited=error?.message==='TFG_RATE_LIMITED';
    openResults('Booking · TFG',limited?'TROPPE RICHIESTE':'SERVIZIO NON DISPONIBILE','warn',
      limited?'Per proteggere il portale TFG, attendi almeno un minuto prima di riprovare. Se necessario usa il sito ufficiale.':
      'Non è stato possibile verificare la risposta TFG. Puoi aprire direttamente il modulo ufficiale con il booking già inserito.');
  }finally{
    clearTimeout(timeoutId);
    if(bookingLookupAbort===controller)bookingLookupAbort=null;
    if(requestId===bookingLookupSeq&&selectedPort==='napoli'&&currentBookingTerminal()==='tfg'){
      const actions=node('div','booking-api-actions');
      const btn=node('button','secondary-btn','CERCA SUL SITO TFG');
      btn.type='button';
      btn.addEventListener('click',()=>{
        const okay=submitTfgOfficialForm(booking);
        if(!okay)btn.textContent='Apri il portale manualmente';
      });
      actions.append(btn,link('APRI PORTALE TFG',urls.tfgBooking,'secondary-btn'));
      results.append(actions,textBlock(
        'Se il sito non apre una nuova scheda, usa APRI PORTALE TFG. Il risultato positivo deve comunque essere verificato prima di partire.','tiny'));
    }
  }
}
function renderNapoli(booking,terminal){
  const selected=bookingTerminal(terminal);
  const site=selected==='tfg'?urls.tfgBooking:urls.cntBooking;
  const name=selected==='tfg'?'TFG · FLAVIO GIOIA':'CO.NA.TE.CO.';
  openResults('Booking · '+name,'RISULTATO SUL SITO TFG','warn',
    'Il booking viene inviato direttamente al modulo ufficiale TFG: il risultato si apre in una scheda del terminal. Se non appare, usa il collegamento qui sotto e verifica manualmente.');
  const reference=node('div','napoli-reference');
  const left=node('div','napoli-reference-number');
  left.append(node('span','napoli-small-label','BOOKING DA VERIFICARE'),node('strong','',booking));
  const copyBtn=node('button','secondary-btn','COPIA BOOKING');
  copyBtn.type='button';
  copyBtn.addEventListener('click',()=>copy(booking,copyBtn));
  reference.append(left,copyBtn);
  results.append(reference);

  const action=node('section','booking-action-panel');
  action.append(node('h4','','Verifica su '+name));
  const official=link('↗ APRI RICERCA BOOKING UFFICIALE',site,'primary booking-external-link');
  const clipboardStatus=node('p','booking-copy-status',
    'Se il portale non si apre, tocca il pulsante qui sotto. Il booking non è ancora verificato.');
  official.addEventListener('click',()=>{
    // Clipboard write begins in the same user gesture as opening the official site.
    // Never wait before navigation: popup blockers can reject a deferred open.
    if(!navigator.clipboard?.writeText){
      clipboardStatus.textContent='Copia il booking dal pulsante sopra, poi incollalo sul portale.';
      return;
    }
    void navigator.clipboard.writeText(booking)
      .then(()=>{
        if(clipboardStatus.isConnected)clipboardStatus.textContent=
          'BOOKING COPIATO ✓  Torna al portale, tieni premuto su Codice Booking, incolla e premi Cerca.';
      })
      .catch(()=>{
        if(clipboardStatus.isConnected)clipboardStatus.textContent=
          'Copia automatica non consentita: usa COPIA BOOKING oppure seleziona il numero qui sopra.';
      });
  });
  action.append(official,clipboardStatus,
    textBlock('La risposta del modulo TFG rimane sul sito ufficiale; l’app non la interpreta automaticamente.','tiny'));
  results.append(action);

  if(selected==='tfg'){
    const advanced=node('details','booking-postcheck');
    advanced.append(node('summary','','Hai un risultato TFG? Incollalo qui per confrontare nave e viaggio'));
    advanced.append(buildTfgImporter(booking));
    results.append(advanced);
  } else {
    const advanced=node('details','booking-postcheck');
    advanced.append(node('summary','','Consulta anche l’accettazione delle navi CO.NA.TE.CO.'));
    advanced.append(textBlock(
      'Il Berth Forecast indica lo stato della nave, non autorizza il booking. DRYPORT e INTERNO PORTO sono destinazioni indicative.','tiny'));
    advanced.append(link('VEDI BERTH FORECAST',urls.cntForecast));
    results.append(advanced);
  }
  return official;
}

const publicSctSnapshot='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/sct.json';
async function getSchedule(force=false){
  if(sctCache && !force)return sctCache;
  // Cloudflare cron monitors the official SCT schedule and stores the last
  // validated copy. Raw GitHub and the Pages file remain independent fallbacks.
  // No provider here verifies a specific booking in real time.
  const sources=[
    cloudflareMonitorUrl('/api/sct'),
    publicSctSnapshot+'?t='+Date.now(),
    './data/sct.json?verifica='+Date.now()
  ].filter(Boolean);
  let best=null;
  let bestTimestamp=-Infinity;
  for(const url of sources){
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'omit',
        signal:typeof AbortSignal.timeout==='function'
          ?AbortSignal.timeout(url.startsWith(cloudflareTfgApiOrigin)?7000:10000):undefined});
      if(!response.ok)continue;
      const data=await response.json();
      if(!data || !Array.isArray(data.rows) || data.rows.length===0)continue;
      if(data.source!=='https://www.salernocontainerterminal.com/ca/an/vessel_schedule.php')continue;
      const timestamp=Date.parse(data.acquired_at??data.updated_at);
      const score=Number.isFinite(timestamp)?timestamp:-Infinity;
      if(!best || score>bestTimestamp){
        best=data;
        bestTimestamp=score;
      }
    }catch{
      // One public copy can be unavailable: test the alternative.
    }
  }
  if(!best)throw Error('Copia programma SCT non disponibile');
  // Commit to the global cache ONLY after the requesting UI check succeeds.
  return best;
}
function formatUpdated(updatedAt){
  const ms=Date.parse(updatedAt);
  if(!Number.isFinite(ms))return 'non disponibile';
  return new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(ms))+' (ora italiana)';
}
function selectedTypeVerdict(row,data){
  if(sctType.value==='all')return evaluateSct(row,data);
  return evaluateSctType(row,data,sctType.value);
}

function updateSctAlert(data) {
  if(!data || !Array.isArray(data.rows) || data.rows.length===0) {
    sctAlert.dataset.state='warning';
    sctAlert.textContent='Nessun programma navi disponibile. Consulta il sito ufficiale.';
    return;
  }
  if(!isSctFeedRecent(data)) {
    sctAlert.dataset.state='warning';
    sctAlert.textContent='ATTENZIONE · Copia del programma SCT non recente. L’accettazione va verificata sul sito ufficiale.';
    return;
  }
  sctAlert.dataset.state='info';
  sctAlert.textContent='Programma SCT letto alle '+formatUpdated(data.acquired_at??data.updated_at)+
    '. '+(data.source_updated_at?'Aggiornamento dichiarato: '+formatUpdated(data.source_updated_at)+'. ':
    'Il terminal non indica l’ora dell’ultimo aggiornamento. ')+
    'Controlla prima della consegna.';
}
function renderPickerOptions(){
  if(!sctCache || selectedPort!=='salerno')return;
  const filter=normalizeName(sctFilter.value);
  const onlyOpen=sctOnlyOpen.checked;
  sctFiltered=sctChoices.filter(choice=>{
    if(filter && !normalizeName(choice.row.vessel).includes(filter)
      && !normalizeName(choice.row.voyage).includes(filter))return false;
    if(!onlyOpen)return true;
    // "Solo in accettazione" esclude i verdetti parziali o incerti.
    return selectedTypeVerdict(choice.row,sctCache).kind==='good';
  });
  const rank={good:0,warn:1,unknown:2,bad:3};
  sctFiltered.sort((a,b)=>{
    const va=selectedTypeVerdict(a.row,sctCache);
    const vb=selectedTypeVerdict(b.row,sctCache);
    const diff=(rank[va.kind]??2)-(rank[vb.kind]??2);
    if(diff)return diff;
    const dateA=parseItalianDate(a.row.eta)||'9999';
    const dateB=parseItalianDate(b.row.eta)||'9999';
    return dateA.localeCompare(dateB)||a.row.vessel.localeCompare(b.row.vessel,'it');
  });
  const visible=sctFiltered.slice(0,sctVisibleLimit);
  sctVesselList.replaceChildren();
  if(!visible.length){
    sctVesselList.append(node('p','empty',onlyOpen&&!isSctFeedRecent(sctCache)
      ?'Dati non abbastanza recenti per confermare navi in accettazione. Disattiva il filtro per vedere tutte le navi.'
      :'Nessuna nave corrispondente. Prova un altro nome o disattiva i filtri.'));
  }
  for(const choice of visible){
    const item=choice.row;
    const verdict=selectedTypeVerdict(item,sctCache);
    const button=node('button','vessel-row');
    button.type='button';
    button.dataset.vesselIndex=String(choice.index);
    if(choice.index===chosenSctIndex){
      button.classList.add('selected');
      button.setAttribute('aria-current','true');
    }
    const main=node('span','vessel-main');
    main.append(node('strong','vessel-name',item.vessel));
    const subtitle=node('span','vessel-meta',
      'Viaggio '+(item.voyage||'N/D')+' · ETA '+(item.eta||'N/D'));
    main.append(subtitle);
    const right=node('span','vessel-right');
    right.append(badge(verdict.label,verdict.kind));
    right.append(node('span','row-chevron','›'));
    button.append(main,right);
    button.setAttribute('aria-label',item.vessel+', viaggio '+(item.voyage||'non disponibile')+', '+verdict.label);
    sctVesselList.append(button);
  }
  sctShowMore.hidden=sctFiltered.length<=sctVisibleLimit;
  sctShowMore.textContent='Mostra altre navi ('+(sctFiltered.length-sctVisibleLimit)+')';
  sctVesselCount.textContent=sctFiltered.length+' viaggi';
  sctStatus.textContent=(sctCache.mode==='cloudflare_scheduled'
      ?'Cloudflare · ultima lettura SCT: '
      :sctCache.mode==='github_verified_fallback'
        ?'GitHub · copia di riserva SCT: ':'Ultima lettura SCT: ')+
    formatUpdated(sctCache.acquired_at??sctCache.updated_at)+
    ' · Modifiche osservate: '+formatUpdated(sctCache.data_changed_at)+
    ' · Aggiornamento dichiarato dal terminal: '+formatUpdated(sctCache.source_updated_at);
  sctStatus.classList.toggle('stale',!isSctFeedRecent(sctCache));
}
async function refreshSctPicker(force=false){
  const requestId=++sctRequestId;
  if(navigator.onLine===false){markOfflineTerminal('sct');return;}
  const previous=sctCache?.rows?.length?sctCache:null;
  ++sctDetailSeq;
  // Reconciliation by voyage ID is not available for the SCT feed: never
  // keep a previously selected row index across a full schedule refresh.
  chosenSctIndex=null;
  results.hidden=true;
  if(!previous){
    sctChoices=[];
    sctFiltered=[];
    sctVesselList.replaceChildren(node('p','empty','Caricamento elenco navi…'));
    sctVesselCount.textContent='—';
  }
  sctShowMore.hidden=true;
  sctAlert.dataset.state='loading';
  sctAlert.textContent='Lettura del programma navi…';
  try{
    const data=await getSchedule(force);
    if(requestId!==sctRequestId || selectedPort!=='salerno')return;
    sctCache=data;
    sctChoices=listSctVoyages(data.rows);
    updateSctAlert(data);
    renderPickerOptions();
  }catch{
    if(requestId!==sctRequestId || selectedPort!=='salerno')return;
    if(previous){
      sctCache={...previous,refresh_failed:true};
      sctChoices=listSctVoyages(sctCache.rows);
      sctAlert.dataset.state='warning';
      sctAlert.textContent='⚠ Aggiornamento SCT non riuscito. Navi della copia precedente consultabili, ma accettazione NON confermata. Verifica sul sito ufficiale.';
      renderPickerOptions();
    }else{
      sctCache=null;
      sctAlert.dataset.state='warning';
      sctAlert.textContent='Dati SCT non disponibili. Controlla la connessione oppure consulta il sito ufficiale.';
      sctVesselList.replaceChildren(node('p','empty','Non è possibile caricare le navi.'));
      sctVesselCount.textContent='Nessun dato';
      sctStatus.textContent='';
    }
  }
}

function renderVoyage(rowData,schedule){
  const r=node('article','voyage');
  const type=sctType.value;
  const verdict=type==='all'
    ?evaluateSct(rowData,schedule)
    :evaluateSctType(rowData,schedule,type);
  const dry=evaluateSctType(rowData,schedule,'dry');
  const reef=evaluateSctType(rowData,schedule,'reefer');
  r.append(
    badge(verdict.label,verdict.kind),
    node('h4','',rowData.vessel||'Nave'),
    facts([
      ['Viaggio',rowData.voyage],
      ['Arrivo previsto (ETA)',rowData.eta],
      ['Chiusura accettazione',describeClosing(rowData.closing)],
      ['Container standard',dry.label],
      ['Container refrigerati',reef.label],
      ['Stato della nave',describeVesselStatus(rowData.status)]
    ]),
    textBlock(verdict.reason,'note')
  );
  return r;
}
async function renderSct(name,specificIndex=null){
  const requestId=sctRequestId;
  const detailId=++sctDetailSeq;
  openResults('Stato della nave','CONTROLLO IN CORSO','neutral','Verifica per '+name);
  try{
    const data=await getSchedule();
    if(selectedPort!=='salerno'||requestId!==sctRequestId||detailId!==sctDetailSeq)return;
    const chosen=Number.isInteger(specificIndex)?data.rows[specificIndex]:null;
    const rows=chosen?[chosen]:findSctVessels(data.rows,name);
    const recent=isSctFeedRecent(data);
    const hdr=results.querySelector('.result-label');
    hdr.className='result-label '+(recent?'neutral':'unknown');
    hdr.lastChild.textContent=recent?'COPIA RECENTE':'DATI NON AGGIORNATI';
    results.querySelector('.result-notice').textContent=
      'Nave: '+name+(chosen?' · viaggio '+(chosen.voyage||'non disponibile'):'')+
      '. Ultima lettura del programma: '+formatUpdated(data.acquired_at??data.updated_at)+
      '. Aggiornamento ufficiale SCT: '+formatUpdated(data.source_updated_at)+
      '. Le informazioni non sono in tempo reale.';
    if(!rows.length){
      results.append(node('div','empty',data.rows.length
        ?'Nave non trovata nel programma salvato. Controlla il sito ufficiale o una variante del nome.'
        :'Non sono presenti dati di Salerno. Consulta il sito ufficiale.'));
    }else{
      rows.forEach(row=>results.append(renderVoyage(row,data)));
    }
    const actions=node('div','actions');
    actions.classList.add('result-actions');
    actions.append(link('Apri programma navi ufficiale ↗',urls.sctSchedule));
    results.append(actions,textBlock(
      'Un esito positivo riguarda la nave e la tipologia di container. Non è un’autorizzazione a consegnare uno specifico booking.','note'
    ));
  }catch{
    if(selectedPort!=='salerno'||requestId!==sctRequestId||detailId!==sctDetailSeq)return;
    const hdr=results.querySelector('.result-label');
    hdr.className='result-label unknown';
    hdr.lastChild.textContent='DATI NON DISPONIBILI';
    results.append(
      node('div','empty','Non riesco a leggere la copia del programma navi. Non è possibile confermare l’accettazione.'),
      link('Apri programma navi ufficiale ↗',urls.sctSchedule)
    );
  }
}


/**
 * Clears only Cache Storage entries under this project's path.
 * Browser HTTP cache belongs to browser settings; a unique URL and versioned
 * resource links force fresh requests without touching unrelated GitHub Pages.
 */
async function refreshContainerBooking() {
  const btn=byId('refresh-app');
  if(btn){btn.disabled=true;btn.textContent='Aggiornamento…';}
  const sitePath=new URL('./',window.location.href).pathname;
  try {
    if('serviceWorker' in navigator) {
      const registrations=await navigator.serviceWorker.getRegistrations();
      for(const registration of registrations){
        const scope=new URL(registration.scope);
        if(scope.origin===window.location.origin && scope.pathname.startsWith(sitePath)){
          await registration.unregister();
        }
      }
    }
    if('caches' in window){
      const cacheNames=await caches.keys();
      for(const cacheName of cacheNames){
        const cache=await caches.open(cacheName);
        for(const req of await cache.keys()){
          const u=new URL(req.url);
          if(u.origin===window.location.origin && u.pathname.startsWith(sitePath)){
            await cache.delete(req);
          }
        }
      }
    }
  } catch {
    // Cache APIs can be unavailable; still request a fresh version of the page.
  }
  const freshUrl=new URL(window.location.href);
  freshUrl.searchParams.set('aggiorna',String(Date.now()));
  window.location.replace(freshUrl.toString());
}
byId('refresh-app')?.addEventListener('click',refreshContainerBooking);


/* Napoli: programma pubblico TFG. Non contiene né interroga booking privati. */
const tfgFleet=byId('tfg-fleet');
const tfgList=byId('tfg-vessel-list');
const tfgShipFilter=byId('tfg-ship-filter');
const tfgAlert=byId('tfg-feed-alert');
const tfgCount=byId('tfg-vessel-count');
const tfgUpdated=byId('tfg-feed-updated');
const tfgMore=byId('tfg-show-more');
let tfgFeed=null;
let tfgVisibleCount=8;
let tfgRequest=0;
let tfgCurrentRows=[];

function tfgTextDate(value) {
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp))return 'non disponibile';
  return new Intl.DateTimeFormat('it-IT',{
    dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'
  }).format(new Date(timestamp));
}
function showTfgShipDetails(row,feed) {
  openResults('Nave TFG','PROGRAMMA PUBBLICO','neutral',
    'Informazioni del programma TFG, non verifica del singolo booking.');
  const assessment=evaluateTfgSchedule(row,feed);
  results.append(deliveryPanel(tfgScheduleDelivery(row,feed)),badge(assessment.label,assessment.kind));
  results.append(facts([
    ['Nave',row.vessel||'—'],
    ['Viaggio di partenza',row.departure_voyage||'—'],
    ['Viaggio di arrivo',row.arrival_voyage||'—'],
    ['ETA',row.eta||'—'],
    ['Accettazione pubblicata',row.acceptance||'Non indicata'],
    ['CUSTOM CLOSE TIME (TFG)',row.custom_close_time||'Non indicato'],
    ['Cut-off Fast Corridor',row.fast_corridor_cut_off||row.cut_off||'Non indicato'],
    ['Cut-off generale per consegna',row.gate_cut_off||'Da verificare al terminal'],
    ['Terminal nel programma',row.destination||'Non indicato'],
    ['Modalità lettura',feed.live?'Diretta dal portale TFG':'Copia periodica del programma'],
    ['Lettura effettuata',tfgTextDate(feed.acquired_at)],
    ['Aggiornamento dichiarato da TFG',tfgTextDate(feed.source_updated_at)]
  ]));
  const note=node('div','ops-alert');
  note.dataset.state='warning';
  note.textContent='Il programma non autorizza il singolo booking. Controlla sempre il luogo di consegna e le disposizioni aggiornate sul sito TFG.';
  results.append(textBlock(assessment.reason,'note'),note,
    link('Consulta il programma ufficiale TFG',urls.tfgSchedule));
}
function renderTfgFleet() {
  if(selectedPort!=='napoli'||!tfgFeed)return;
  const search=normalizeName(tfgShipFilter.value);
  const rows=tfgFeed.rows.map((row,index)=>({row,index}))
    .filter(({row})=>normalizeName(row.vessel).includes(search)||normalizeName(row.departure_voyage).includes(search));
  const weight={good:0,warn:1,unknown:2,bad:3};
  rows.sort((a,b)=>{
    const av=evaluateTfgSchedule(a.row,tfgFeed),bv=evaluateTfgSchedule(b.row,tfgFeed);
    return (weight[av.kind]??2)-(weight[bv.kind]??2)
      ||String(a.row.eta||'').localeCompare(String(b.row.eta||''))
      ||String(a.row.vessel||'').localeCompare(String(b.row.vessel||''));
  });
  tfgCurrentRows=rows;
  tfgList.replaceChildren();
  for (const {row,index} of rows.slice(0,tfgVisibleCount)) {
    const verdict=evaluateTfgSchedule(row,tfgFeed);
    const button=node('button','vessel-row');
    button.type='button';
    button.dataset.tfgRow=String(index);
    const main=node('span','vessel-main');
    main.append(node('strong','vessel-name',row.vessel||'Nave senza nome'),
      node('span','vessel-meta','Viaggio '+(row.departure_voyage||'?')+' · ETA '+(row.eta||'—')),
      deliveryChip(tfgScheduleDelivery(row,tfgFeed)));
    if(!isTfgFeedFresh(tfgFeed)){
      // The vessel is confirmed by the official published state, not by
      // a booking check. Show the terminal's declared update prominently.
      main.append(node('span','tfg-published-state',
        verdict.kind==='good'
          ?'Stato nave TFG aggiornato: '+tfgTextDate(tfgFeed.source_updated_at)
          :'TFG pubblica: '+(String(row.acceptance||'').trim()||'stato non indicato')));
    }
    const side=node('span','vessel-right');
    side.append(badge(verdict.label,verdict.kind),node('span','row-chevron','›'));
    button.append(main,side);
    tfgList.append(button);
  }
  if(!rows.length){
    tfgList.append(node('p','empty',search?'Nessuna nave corrisponde alla ricerca.':'Nessuna nave disponibile nella copia pubblicata.'));
  }
  tfgCount.textContent=rows.length+' viaggi';
  tfgMore.hidden=rows.length<=tfgVisibleCount;
  if(!tfgMore.hidden)tfgMore.textContent='Mostra altre navi ('+(rows.length-tfgVisibleCount)+')';
}
async function refreshTfgShips(force=false) {
  const current=++tfgRequest;
  if(selectedPort!=='napoli')return;
  if(navigator.onLine===false){markOfflineTerminal('tfg');return;}
  const previous=tfgFeed?.rows?.length?tfgFeed:null;
  tfgAlert.dataset.state=previous?'warning':'loading';
  tfgAlert.textContent=previous
    ?'Aggiornamento TFG in corso: elenco precedente, accettazioni da riconfermare.'
    :'Lettura del programma navi TFG…';
  if(!previous){
    tfgList.replaceChildren(node('p','empty','Caricamento…'));
    tfgCount.textContent='—';
    tfgMore.hidden=true;
  }
  try {
    let next=tfgFeed;
    if(force||!next){
      next=await loadTfgSnapshot();
    }
    if(current!==tfgRequest||selectedPort!=='napoli')return;
    tfgFeed=next; // Older overlapping requests cannot replace the newer feed.
    const fresh=isTfgFeedFresh(tfgFeed);
    tfgAlert.dataset.state=fresh&&!tfgFeed.live_failed?'info':'warning';
    tfgAlert.textContent=!tfgFeed.rows.length
      ?'Programma TFG non acquisito automaticamente. Apri il sito ufficiale per vedere le navi.'
      :tfgFeed.live_failed
        ?'Lettura diretta TFG non riuscita. Questa è una copia precedente: nessuna accettazione attuale è confermata.'
        :tfgFeed.live && !fresh
          ?'Lettura diretta non verificabile: controlla sul portale ufficiale TFG.'
        :!fresh
          ?'ATTENZIONE: copia del programma TFG non acquisita recentemente. Nessuna accettazione attuale è confermata.'
          :tfgFeed.live
            ?'Lettura diretta riuscita: '+tfgTextDate(tfgFeed.acquired_at)+
              '. Ultimo aggiornamento TFG: '+tfgTextDate(tfgFeed.source_updated_at)+
              '. Il terminal aggiorna solo quando il programma cambia; booking non verificato.'
            :'Copia del programma TFG acquisita periodicamente. Non è una verifica in diretta.';
    byId('tfg-reload').textContent=hasOnDemandTfgBackend()?'Verifica ora':'Aggiorna copia';
    tfgUpdated.textContent=(tfgFeed.live?'Lettura diretta effettuata: '
      :tfgFeed.mode==='cloudflare_scheduled'?'Cloudflare · copia acquisita: '
      :tfgFeed.mode==='github_verified_fallback'?'GitHub · copia di riserva: '
      :'Copia acquisita: ')+tfgTextDate(tfgFeed.acquired_at)+
      ' · Aggiornamento dichiarato dal terminal: '+tfgTextDate(tfgFeed.source_updated_at);
    renderTfgFleet();
  } catch {
    if(current!==tfgRequest||selectedPort!=='napoli')return;
    results.hidden=true; // An earlier live detail is no longer confirmed.
    tfgAlert.dataset.state='warning';
    if(previous){
      tfgFeed={...previous,live:false,live_failed:true};
      tfgAlert.textContent='Errore nella nuova lettura TFG. Dati precedenti visibili, ma nessuna accettazione confermata.';
      tfgUpdated.textContent='Copia precedente: '+tfgTextDate(tfgFeed.acquired_at)+
        ' · Aggiornamento terminal: '+tfgTextDate(tfgFeed.source_updated_at);
      renderTfgFleet();
    }else{
      tfgFeed=null;
      tfgAlert.textContent='Impossibile leggere il programma TFG. Usa il sito ufficiale; nessuna accettazione è confermata.';
      tfgList.replaceChildren();
      tfgUpdated.textContent='';
      tfgCount.textContent='Dati non disponibili';
    }
  }
}
tfgShipFilter.addEventListener('input',()=>{
  tfgVisibleCount=8;
  renderTfgFleet();
});
tfgMore.addEventListener('click',()=>{
  tfgVisibleCount+=8;
  renderTfgFleet();
});
byId('tfg-reload').addEventListener('click',()=>{
  tfgVisibleCount=8;
  void refreshTfgShips(true);
});
tfgList.addEventListener('click',event=>{
  const button=event.target.closest('button[data-tfg-row]');
  if(!button||!tfgList.contains(button)||!tfgFeed||selectedPort!=='napoli')return;
  const row=tfgFeed.rows[Number(button.dataset.tfgRow)];
  if(row)showTfgShipDetails(row,tfgFeed);
});
// Caricamento TFG on-demand quando viene selezionato.

/* Reread published GitHub snapshot when the driver returns to the app.
   The repository fetch itself is scheduled separately every 15 minutes. */
// Aggiornamento TFG gestito dal controllo automatico centralizzato.


/* CO.NA.TE.CO. public Berth Forecast. Booking data are never stored here. */
const publicCntSnapshot='https://raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/conateco.json';
const cntList=byId('cnt-vessel-list');
const cntShipFilter=byId('cnt-ship-filter');
const cntAlert=byId('cnt-feed-alert');
const cntCount=byId('cnt-vessel-count');
const cntUpdated=byId('cnt-feed-updated');
const cntMore=byId('cnt-show-more');
const cntArchiveToggle=byId('cnt-archive-toggle');
let cntFeed=null;
let cntVisibleCount=8;
let cntShowArchived=false;
let cntRequest=0;
const cntStatus={PRE:'PREVISTA',ARR:'ARRIVATA',CHI:'CHIUSA'};
async function loadCntSnapshot() {
  const sources=[
    cloudflareMonitorUrl('/api/cnt'),
    publicCntSnapshot+'?t='+Date.now(),
    './data/conateco.json'
  ].filter(Boolean);
  let best=null,bestTimestamp=-Infinity;
  for(const src of sources){
    try{
      const resp=await fetch(src,{cache:'no-store',credentials:'omit',
        signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(7000):undefined});
      if(!resp.ok)continue;
      const data=await resp.json();
      if(data?.source!=='https://api.conateco.it/ConatecoServicesApi/BerthForecast'
        ||!Array.isArray(data.rows)||!data.rows.length)continue;
      const at=Date.parse(data.acquired_at);
      if(!Number.isFinite(at)||at>Date.now()+300000)continue;
      if(at>bestTimestamp){
        best={...data,copy_origin:data.mode==='github_verified_fallback'?'GitHub · riserva'
          :src.startsWith(cloudflareTfgApiOrigin)?'Copia Cloudflare'
          :src.startsWith('https://raw.githubusercontent.com/')?'GitHub · riserva':'GitHub Pages · riserva'};
        bestTimestamp=at;
      }
    }catch{/* An independent fallback can provide a newer validated copy. */}
  }
  if(best)return best;
  throw new Error('Berth Forecast non disponibile');
}
function renderCntShipDetails(row,feed) {
  cancelBookingLookup();
  const verdict=evaluateConateco(row,feed);
  openResults('Nave CO.NA.TE.CO.','PROGRAMMA PUBBLICO','neutral',
    'Informazioni riferite alla nave. Non è una verifica del tuo booking.');
  results.append(deliveryPanel(conatecoForecastDelivery(row,feed)),
    depotAcceptancePanel(conatecoDepotAcceptance(row,feed)),badge(verdict.label,verdict.kind));
  results.append(facts([
    ['Nave',row.vessel||'—'],
    ['Viaggio imbarco',row.voyage||'—'],
    ['Armatore',row.carrier||'—'],
    ['ETA',row.eta||'Da verificare'],
    ['Stato nave',cntStatus[row.vessel_status]||'Da verificare'],
    ['Apertura prevista',row.opening||'Da verificare'],
    ['Chiusura prevista',row.closing||'Da verificare'],
    ['Segnale accettazione',row.acceptance_icon||'Non disponibile'],
    ['Blocco carico',row.stop_cargo||'Non segnalato'],
    ['Accettazione su depositi esterni (Berth Forecast)',conatecoDepotAcceptance(row,feed).value],
    ['Note terminal',row.notes||'Nessuna'],
    ['Acquisito da CO.NA.TE.CO.',tfgTextDate(feed.acquired_at)]
  ]));
  const warning=node('div','ops-alert');
  warning.dataset.state='warning';
  warning.textContent='ATTENZIONE · Il Berth Forecast segnala lo stato della nave, non autorizza un booking o l’ingresso. Controlla Booking Export e le eventuali variazioni del terminal.';
  results.append(textBlock(verdict.reason,'note'),warning,
    link('Verifica Berth Forecast sul sito ufficiale',urls.cntForecast),
    link('Controlla il booking CO.NA.TE.CO.',urls.cntBooking));
}
function renderCntFleet(){
  if(selectedPort!=='napoli'||!cntFeed)return;
  // Keep departed voyages searchable but don't put last month's departures
  // above ships that are currently present or expected.
  const listing=selectConatecoFleet(cntFeed.rows,{
    query:cntShipFilter.value,showDeparted:cntShowArchived
  });
  const choices=listing.rows;
  const score={good:0,warn:1,unknown:2,bad:3};
  const categoryOrder={PREVISTE:0,PRESENTI:1,ORMEGGIATE:1,PARTITE:3};
  const recent=isConatecoRecent(cntFeed);
  choices.sort((a,b)=>{
    const x=evaluateConateco(a.row,cntFeed),y=evaluateConateco(b.row,cntFeed);
    const past=Number(isDepartedConateco(a.row))-Number(isDepartedConateco(b.row));
    return past
      ||(recent?(score[x.kind]??2)-(score[y.kind]??2):
        (categoryOrder[String(a.row.category||'').toUpperCase()]??2)-
        (categoryOrder[String(b.row.category||'').toUpperCase()]??2))
      ||String(a.row.eta||'').localeCompare(String(b.row.eta||''))
      ||String(a.row.vessel||'').localeCompare(String(b.row.vessel||''));
  });
  cntArchiveToggle.hidden=listing.searching||listing.archivedCount===0;
  cntArchiveToggle.textContent=cntShowArchived
    ?'NASCONDI NAVI PARTITE'
    :'MOSTRA '+listing.archivedCount+' NAVI PARTITE';
  cntArchiveToggle.setAttribute('aria-pressed',String(cntShowArchived));
  cntList.replaceChildren();
  for(const {row,index} of choices.slice(0,cntVisibleCount)){
    const verdict=evaluateConateco(row,cntFeed);
    const button=node('button','vessel-row');
    button.type='button';
    button.dataset.cntRow=String(index);
    const main=node('span','vessel-main');
    main.append(node('strong','vessel-name',row.vessel||'Nave'),
      node('span','vessel-meta','Viaggio '+(row.voyage||'?')+' · '+(row.eta||'ETA N/D')),
      deliveryChip(conatecoForecastDelivery(row,cntFeed)));
    const side=node('span','vessel-right');
    side.append(badge(verdict.label,verdict.kind),node('span','row-chevron','›'));
    button.append(main,side);
    cntList.append(button);
  }
  if(!choices.length){
    cntList.append(node('p','empty',listing.searching?'Nessuna nave o viaggio corrispondente.':'Nessun programma navi CO.NA.TE.CO. disponibile.'));
  }
  cntCount.textContent=choices.length+' viaggi';
  cntMore.hidden=choices.length<=cntVisibleCount;
  cntMore.textContent='Mostra altre navi ('+(choices.length-cntVisibleCount)+')';
}
async function refreshCntShips(force=false){
  const seq=++cntRequest;
  if(selectedPort!=='napoli')return;
  if(navigator.onLine===false){markOfflineTerminal('cnt');return;}
  const previous=cntFeed?.rows?.length?cntFeed:null;
  cntAlert.dataset.state=previous?'warning':'loading';
  cntAlert.textContent=previous
    ?'Aggiornamento CNT in corso. La copia precedente non conferma variazioni recenti.'
    :'Lettura Berth Forecast CO.NA.TE.CO.…';
  if(!previous){
    cntList.replaceChildren(node('p','empty','Caricamento navi…'));
    cntCount.textContent='—';
    cntMore.hidden=true;
  }
  try{
    const next=(force||!cntFeed)?await loadCntSnapshot():cntFeed;
    if(seq!==cntRequest||selectedPort!=='napoli')return;
    cntFeed=next; // Ignore stale overlapping HTTP completions.
    if(cntBookingRefresh)cntBookingRefresh(next);
    const fresh=isConatecoRecent(cntFeed);
    cntAlert.dataset.state=fresh?'info':'warning';
    cntAlert.textContent=!cntFeed.rows.length
      ?'Dati automatici CO.NA.TE.CO. non disponibili. Verifica sul Berth Forecast ufficiale.'
      :fresh
        ?'Ultima acquisizione alle '+tfgTextDate(cntFeed.acquired_at)+
          '. Dati del programma ricevuti: verifica comunque il tuo booking.'
        :'DATI NON AGGIORNATI · Ultima acquisizione '+tfgTextDate(cntFeed.acquired_at)+
          '. Non posso confermare l’accettazione attuale. Tocca Aggiorna oppure verifica il Berth Forecast ufficiale.';
    cntUpdated.textContent=(cntFeed.mode==='cloudflare_scheduled'
      ?'Cloudflare · acquisito: '
      :cntFeed.mode==='github_verified_fallback'
        ?'GitHub · copia di riserva: ':'Acquisito: ')+tfgTextDate(cntFeed.acquired_at)
      +' · Aggiornamento interno dichiarato dal terminal: non pubblicato';
    renderCntFleet();
  }catch{
    if(seq!==cntRequest||selectedPort!=='napoli')return;
    if(previous){
      cntFeed={...previous,refresh_failed:true};
      cntAlert.dataset.state='warning';
      cntAlert.textContent='⚠ Aggiornamento CNT non riuscito. Navi della copia precedente consultabili, ma accettazione NON riconfermata. Verifica sul Berth Forecast ufficiale.';
      cntUpdated.textContent='Copia precedente, verifica fallita · Acquisita: '+tfgTextDate(cntFeed.acquired_at);
      renderCntFleet();
      if(cntBookingRefresh)cntBookingRefresh(cntFeed);
    }else{
      cntFeed=null;
      cntAlert.dataset.state='warning';
      cntAlert.textContent='Berth Forecast non disponibile. Controlla la connessione oppure apri il sito ufficiale.';
      cntList.replaceChildren(node('p','empty','Nessun programma disponibile.'));
      cntCount.textContent='Dati assenti';
      cntUpdated.textContent='';
      if(cntBookingRefresh)cntBookingRefresh(null);
    }
    if(!results.hidden&&!results.querySelector('.booking-vessel-acceptance'))results.hidden=true;
  }
}
cntShipFilter.addEventListener('input',()=>{
  cntVisibleCount=8;
  renderCntFleet();
});
cntMore.addEventListener('click',()=>{
  cntVisibleCount+=8;
  renderCntFleet();
});
cntArchiveToggle.addEventListener('click',()=>{
  cntShowArchived=!cntShowArchived;
  cntVisibleCount=8;
  renderCntFleet();
});
byId('cnt-reload').addEventListener('click',()=>{
  cntVisibleCount=8;
  void refreshCntShips(true);
});
cntList.addEventListener('click',event=>{
  const button=event.target.closest('button[data-cnt-row]');
  if(!button||!cntList.contains(button)||!cntFeed||selectedPort!=='napoli')return;
  const row=cntFeed.rows[Number(button.dataset.cntRow)];
  if(row)renderCntShipDetails(row,cntFeed);
});
document.querySelectorAll('input[name=napoli-terminal]').forEach(r=>r.addEventListener('change',()=>{
  if(selectedPort!=='napoli')return;
  const t=document.querySelector('input[name=napoli-terminal]:checked')?.value||'cnt';
  byId('tfg-fleet').hidden=t!=='tfg';
  byId('cnt-fleet').hidden=t!=='cnt';
  results.hidden=true;
  autoRefreshActiveTerminal(true);
}));
// Caricamento automatico iniziale a fine modulo.


// Aggiornamento CNT gestito dal controllo automatico centralizzato.


/* SCT: reread the repository snapshot every 15 minutes and when returning
   to the tab; refresh the list without claiming the terminal was contacted live. */
/* Aggiornamento in foreground: nessuna azione richiesta all'autista.
   Non interroga i terminal nascosti e non consuma rete quando offline. */
const autoLastRead={tfg:0,cnt:0,sct:0};
/** Do not leave an infinite spinner offline or show green from a cached
 * publication when the latest recheck cannot be completed. */
function markOfflineTerminal(term){
  if(term==='sct'){
    ++sctDetailSeq;
    results.hidden=true; // A previously opened vessel card cannot retain an old green.
    if(sctCache?.rows?.length){
      sctCache={...sctCache,refresh_failed:true};
      sctChoices=listSctVoyages(sctCache.rows);
      renderPickerOptions();
    }else{
      sctVesselList.replaceChildren(node('p','empty','Nessun programma salvato disponibile.'));
      sctVesselCount.textContent='Dati assenti';
      sctStatus.textContent='';
    }
    sctAlert.dataset.state='warning';
    sctAlert.textContent='⚠ Nessuna connessione. SCT: copia non riconfermata. Controlla il sito ufficiale quando torna la rete.';
  }else if(term==='cnt'){
    if(cntFeed?.rows?.length){
      cntFeed={...cntFeed,refresh_failed:true};
      renderCntFleet();
      if(cntBookingRefresh)cntBookingRefresh(cntFeed);
      cntUpdated.textContent='Copia precedente non riconfermata · Acquisita: '+tfgTextDate(cntFeed.acquired_at);
    }else{
      cntList.replaceChildren(node('p','empty','Nessun programma salvato disponibile.'));
      cntCount.textContent='Dati assenti';
      cntUpdated.textContent='';
      if(cntBookingRefresh)cntBookingRefresh(null);
    }
    if(!results.hidden&&!results.querySelector('.booking-vessel-acceptance'))results.hidden=true;
    cntAlert.dataset.state='warning';
    cntAlert.textContent='⚠ Nessuna connessione. CNT: dati non riconfermati, nessuna accettazione attuale confermata.';
  }else if(term==='tfg'){
    results.hidden=true; // Hide an old live detail result while disconnected.
    if(tfgFeed?.rows?.length){
      tfgFeed={...tfgFeed,live:false,live_failed:true};
      renderTfgFleet();
      tfgUpdated.textContent='Copia precedente non riconfermata · Acquisita: '+tfgTextDate(tfgFeed.acquired_at);
    }else{
      tfgList.replaceChildren(node('p','empty','Nessun programma salvato disponibile.'));
      tfgCount.textContent='Dati assenti';
      tfgUpdated.textContent='';
    }
    tfgAlert.dataset.state='warning';
    tfgAlert.textContent='⚠ Nessuna connessione. TFG: dati non riconfermati, nessuna accettazione attuale confermata.';
  }
}
function autoRefreshActiveTerminal(force=false){
  if(document.hidden)return;
  const term=selectedPort==='salerno'?'sct':
    (document.querySelector('input[name="napoli-terminal"]:checked')?.value==='tfg'?'tfg':'cnt');
  if(navigator.onLine===false){markOfflineTerminal(term);return;}
  const now=Date.now();
  if(!force && now-autoLastRead[term]<45000)return;
  autoLastRead[term]=now;
  if(term==='tfg')void refreshTfgShips(true);
  else if(term==='cnt')void refreshCntShips(true);
  else void refreshSctPicker(true);
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)autoRefreshActiveTerminal();
});
window.addEventListener('focus',()=>autoRefreshActiveTerminal());
window.addEventListener('online',()=>autoRefreshActiveTerminal(true));
window.setInterval(()=>autoRefreshActiveTerminal(),5*60*1000);
autoRefreshActiveTerminal(true);
