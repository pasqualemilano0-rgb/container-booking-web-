/** Public TFG vessel schedule. No booking is transmitted to TFG. */
function norm(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function localRome(now) {
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now);
  const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
}
export function tfgDateTime(text) {
  const m=String(text??'').match(/(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:\s+|,\s*)(\d{1,2}):(\d{2})/);
  if(!m)return null;
  const year=m[3].length===2?2000+Number(m[3]):Number(m[3]);
  const dt=new Date(Date.UTC(year,Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5])));
  if(dt.getUTCFullYear()!==year||dt.getUTCMonth()!==Number(m[2])-1||
      dt.getUTCDate()!==Number(m[1])||Number(m[4])>23||Number(m[5])>59)return null;
  return year+'-'+m[2]+'-'+m[1]+'T'+m[4].padStart(2,'0')+':'+m[5];
}
/** A recent acquisition verifies the current publication even when unchanged for days.
 * The official publication timestamp must still be valid and not future-dated. */
export function isTfgFeedFresh(feed,now=new Date(),minutes=90) {
  if(!feed||!Array.isArray(feed.rows)||feed.live_failed===true)return false;
  const acquired=Date.parse(feed.acquired_at);
  const published=Date.parse(feed.source_updated_at);
  return Number.isFinite(acquired)&&acquired<=now.getTime()+300000
    &&now.getTime()-acquired<=minutes*60000
    &&Number.isFinite(published)&&published<=now.getTime()+300000;
}
function sameVessel(a,b){
  const na=norm(a),nb=norm(b);
  if(!na||!nb)return false;
  if(na===nb)return true;
  // The booking may say SAGARMALA; schedule may say X PRESS SAGARMALA.
  return Math.min(na.length,nb.length)>=6&&(na.includes(nb)||nb.includes(na));
}
/** Match strictly by DEPT.VOY (departure voyage), not ARR.VOY. */
export function matchTfgVoyage(bookingResult,feed){
  if(!bookingResult?.usable || !Array.isArray(feed?.rows))return {kind:'unavailable',row:null};
  const departure=norm(bookingResult.voyage);
  if(!departure)return {kind:'unavailable',row:null};
  const exact=feed.rows.filter(row=>norm(row.departure_voyage)===departure && sameVessel(row.vessel,bookingResult.vessel));
  if(exact.length===1)return {kind:'match',row:exact[0]};
  if(exact.length>1)return {kind:'ambiguous',row:null};
  return {kind:'not-found',row:null};
}
/**
 * Vessel-only status published on the official TFG schedule.
 * "ACCETTA CARICO" is affirmative for that *vessel and voyage*,
 * but is not a verified individual booking or access authorisation.
 *
 * The affirmative badge requires a recent, successful direct read.
 * A publication unchanged for days can still be the official current schedule.
 * A snapshot or failed direct read never becomes green.
 */
export function evaluateTfgSchedule(row,feed,now=new Date()) {
  if(feed?.live_failed===true)return {
    kind:'unknown',label:'VERIFICA NON DISPONIBILE',
    reason:'La lettura diretta TFG non è riuscita. Gli stati precedenti richiedono conferma sul portale ufficiale.'
  };
  if(!row || typeof row!=='object')return {
    kind:'unknown',label:'STATO NON DISPONIBILE',
    reason:'Manca una nave/viaggio identificabile nel programma TFG.'
  };

  const raw=String(row.acceptance??'').replace(/\s+/g,' ').trim();
  const state=raw.toUpperCase();
  const officialUpdate=Date.parse(feed?.source_updated_at);
  const recentlyAcquired=isTfgFeedFresh(feed,now);
  const recentDirectRead=feed?.live===true&&recentlyAcquired;

  // Closed/expired statuses take priority over any positive published text.
  if(/NON ACCETTA CARICO|NAVE CHIUSA|IMBARCO CHIUSO|ANNULLAT|PARTIT|STOP/.test(state)){
    return {kind:'bad',label:'NON ACCETTA CARICO',
      reason:'TFG pubblica la nave come chiusa/non in accettazione. Controlla il programma ufficiale per variazioni.'};
  }
  const cutoffText=String(row.gate_cut_off??'').trim();
  const cutoff=tfgDateTime(cutoffText);
  if(cutoff&&cutoff<=localRome(now))return {
    kind:'bad',label:'CUT-OFF SCADUTO',
    reason:'Il cut-off generale di consegna riportato da TFG è trascorso.'
  };
  if(/\b(CLOSED|CHIUSO)\b/i.test(cutoffText))return {
    kind:'bad',label:'ACCETTAZIONE CHIUSA',
    reason:'Il termine generale di consegna è indicato come chiuso.'
  };

  // A snapshot or broken acquisition cannot support an affirmed open gate.
  // A prior publication date does not invalidate a new successful direct read.
  if(/^CARICO DAL\b/.test(state)){
    if(!recentlyAcquired)return {
      kind:'unknown',label:'PROGRAMMA NON AGGIORNATO',
      reason:'Il programma TFG non ha una lettura o un aggiornamento verificabile.'
    };
    const openAt=tfgDateTime(state);
    if(!openAt)return {kind:'unknown',label:'INIZIO CARICO NON LEGGIBILE',
      reason:'Non è possibile interpretare la data di apertura pubblicata.'};
    if(openAt>localRome(now))return {
      kind:recentlyAcquired?'bad':'warn',
      label:recentlyAcquired?'NON ANCORA APERTA':'CARICO PREVISTO',
      reason:'TFG indica l’apertura del carico a una data futura, non ancora operativa.'
    };
    if(recentDirectRead&&cutoff){
      return {kind:'good',label:'CARICO APERTO (NAVE)',
        reason:'TFG pubblica l’inizio del carico già avvenuto e un cut-off generale futuro. Non verifica il singolo booking.'};
    }
    return {kind:'warn',label:'CARICO DAL '+raw.replace(/^CARICO DAL\s*/i,''),
      reason:'TFG riporta la data di apertura, ma non una conferma attuale completa della nave/viaggio.'};
  }

  if(state==='ACCETTA CARICO'){
    if(recentDirectRead){
      return {kind:'good',label:'ACCETTA CARICO',
        reason:'Conferma dello stato “ACCETTA CARICO” pubblicato da TFG per questa nave e viaggio, letto ora. '+
          'Ultimo aggiornamento dichiarato dal terminal: '+
          new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(officialUpdate))+
          '. Non costituisce conferma del singolo booking, del luogo di consegna o di un cut-off generale non indicato.'};
    }
    if(feed?.live===true){
      return {kind:'warn',label:'ACCETTAZIONE DA RICONFERMARE',
        reason:'La lettura diretta TFG non è sufficientemente recente oppure i timestamp non sono verificabili.'};
    }
    return {kind:recentlyAcquired?'warn':'unknown',
      label:recentlyAcquired?'TFG PUBBLICA ACCETTA CARICO':'PROGRAMMA NON AGGIORNATO',
      reason:'È disponibile soltanto una copia del programma: lo stato pubblicato non è stato confermato da una lettura diretta riuscita.'};
  }

  return {kind:'unknown',
    label:recentDirectRead?'STATO DA RICONFERMARE':'PROGRAMMA NON AGGIORNATO',
    reason:'Non è disponibile uno stato ACCETTA CARICO interpretabile e verificato per questa nave/viaggio.'};
}
