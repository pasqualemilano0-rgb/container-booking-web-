/** Safety-first evaluation of the public CO.NA.TE.CO. Berth Forecast.

Acceptance refers to the vessel; it NEVER verifies a booking or the driver's
right to enter the port. Source does not publish an official update timestamp:
we use the acquisition time, labeling it as such.
*/
export function isConatecoRecent(feed,now=new Date(),limitMinutes=45){
  if(feed?.refresh_failed===true)return false;
  const ts=Date.parse(feed?.acquired_at);
  return Array.isArray(feed?.rows)&&Number.isFinite(ts)&&ts<=now.getTime()+300000
    &&now.getTime()-ts<=limitMinutes*60000;
}
function romeNow(now){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now);
  const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
function validDate(value){
  const s=String(value??'');
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if(!m)return null;
  const y=Number(m[1]),month=Number(m[2]),d=Number(m[3]),h=Number(m[4]),minute=Number(m[5]);
  const dt=new Date(Date.UTC(y,month-1,d,h,minute));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===month-1&&dt.getUTCDate()===d
    &&h<=23&&minute<=59?s:null;
}
const closedStop=new Set(['S','SI','YES','Y','1','TRUE','STOP','STOPPED']);
const openStop=new Set(['','N','NO','0','FALSE']);
const activeStates=new Set(['ARR','PRE']);
export function evaluateConateco(row,feed,now=new Date()){
  if(!isConatecoRecent(feed,now))return {
    kind:'unknown',label:'DATI DA AGGIORNARE',
    reason:'Il programma CO.NA.TE.CO. non è stato acquisito abbastanza recentemente per confermare l’accettazione.'
  };
  if(!row||typeof row!=='object'||row.source_conflict)return{
    kind:'unknown',label:'DATI CONTRADDITTORI',
    reason:'Le fonti del programma non sono coerenti. Controlla il terminal.'
  };
  if(String(row.category).toUpperCase()==='PARTITE'
    ||String(row.vessel_status).toUpperCase()==='CHI'
    ||String(row.acceptance_icon).toUpperCase()==='CHIUSA'){
    return{kind:'bad',label:'NAVE CHIUSA O PARTITA',
      reason:'Il programma indica una nave chiusa o partita.'};
  }
  if(closedStop.has(String(row.stop_cargo??'').trim().toUpperCase())){
    return{kind:'bad',label:'CARICO BLOCCATO',
      reason:'Il terminal segnala un blocco del carico.'};
  }
  if(String(row.acceptance_flag)==='0'
    ||String(row.acceptance_icon).toUpperCase()==='NO_ACCETTA_CARICO'){
    return{kind:'bad',label:'NON ACCETTA CARICO',
      reason:'Il terminal segnala che la nave non accetta carico.'};
  }
  if(!openStop.has(String(row.stop_cargo??'').trim().toUpperCase())){
    return{kind:'unknown',label:'BLOCCO CARICO DA VERIFICARE',
      reason:'Il campo di blocco non è riconosciuto.'};
  }
  if(String(row.acceptance_flag)!=='1'
    ||String(row.acceptance_icon).toUpperCase()!=='ACCETTA_CARICO'
    ||!activeStates.has(String(row.vessel_status).toUpperCase())){
    return{kind:'unknown',label:'ACCETTAZIONE DA VERIFICARE',
      reason:'Stato e accettazione non sono entrambi positivi e riconoscibili.'};
  }
  const opening=validDate(row.opening),closing=validDate(row.closing);
  const localNow=romeNow(now);
  if(opening&&opening>localNow)return{
    kind:'bad',label:'NON ANCORA IN ACCETTAZIONE',
    reason:'La data di apertura pubblicata dal terminal non è ancora arrivata.'
  };
  if(!closing)return{kind:'warn',label:'CHIUSURA DA CONFERMARE',
    reason:'Il terminal indica accettazione, ma non è disponibile un termine valido di chiusura.'};
  if(closing<=localNow)return{kind:'bad',label:'CUT-OFF SCADUTO',
    reason:'Il termine per la consegna del carico è passato.'};
  if(!validDate(row.eta))return{kind:'unknown',label:'ETA DA VERIFICARE',
    reason:'La data prevista della nave è assente o non valida.'};
  return{kind:'good',label:'NAVE IN ACCETTAZIONE',
    reason:'Accettazione segnalata per la nave e cut-off futuro nella copia pubblica. Il singolo booking e l’ingresso non sono autorizzati dall’app.'};
}
