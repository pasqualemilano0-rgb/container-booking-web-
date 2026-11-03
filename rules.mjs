export function normalizeName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function parseItalianDate(text) {
  const match = String(text ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, d, m, y, hh, mm] = match;
  const check = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm));
  if (check.getUTCFullYear() !== +y || check.getUTCMonth() !== +m - 1 || check.getUTCDate() !== +d || +hh > 23 || +mm > 59) return null;
  return `${y}-${m}-${d}T${hh.padStart(2, '0')}:${mm}`;
}

export function romeNowISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function isSnapshotRecent(updatedAt, now = new Date(), limitMinutes = 90) {
  const ts = Date.parse(updatedAt);
  return Number.isFinite(ts) && ts <= now.getTime() + 5 * 60_000 && now.getTime() - ts <= limitMinutes * 60_000;
}

/**
 * SCT publishes a dynamic HTML schedule but currently no terminal update
 * timestamp. Keep the acquisition time distinct from the declared source time.
 * When SCT starts publishing a timestamp, require it to be recent as well.
 */
export function isSctFeedRecent(feed, now=new Date()) {
  if(!feed || typeof feed!=='object'||feed.refresh_failed===true) return false;
  const acquired=feed.acquired_at ?? feed.updated_at;
  if(!isSnapshotRecent(acquired,now))return false;
  if(feed.source_updated_at !== undefined && feed.source_updated_at !== null) {
    if(!isSnapshotRecent(feed.source_updated_at,now))return false;
  }
  return true;
}


/**
 * Safety rules for SCT: no green result without fresh data, a known operative
 * vessel status, an unexpired closing time and a type-specific positive signal.
 * These checks refer to the vessel only, not to a driver's booking.
 */
const OPERATIVE_STATUSES = new Set([
  'PENDING','FORECAST','SCHEDULED','ARRIVED','BERTHED','IN PORT','WORKING','LOADING'
]);
const CLOSED_STATUSES = new Set([
  'DEPARTED','SAILED','CANCELLED','CANCELED','CLOSED','COMPLETED','TERMINATED'
]);

function normalizedCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g,' ');
}
function acceptanceCode(value) {
  const code = normalizedCode(value);
  if (code === 'CARGO ACCEPTED') return 'yes';
  if (['NOT ACCEPTED','CARGO NOT ACCEPTED','NOT ACCEPTING','CARGO REJECTED','REJECTED'].includes(code)) return 'no';
  return 'unknown';
}
function unknown(label, reason) { return {kind:'unknown', label, reason}; }
function bad(label, reason) { return {kind:'bad', label, reason}; }
function guardSct(row, updatedAt, now) {
  const fresh=typeof updatedAt==='object' && updatedAt!==null
    ?isSctFeedRecent(updatedAt,now)
    :isSnapshotRecent(updatedAt,now);
  if (!fresh) {
    return unknown('DATI DA AGGIORNARE','La copia del programma navi non è abbastanza recente per confermare l’accettazione.');
  }
  if (!row || typeof row !== 'object') {
    return unknown('DATI INCOMPLETI','Non sono disponibili informazioni valide sulla nave.');
  }
  const status = normalizedCode(row.status);
  if (CLOSED_STATUSES.has(status)) {
    return bad(status === 'CANCELLED' || status === 'CANCELED' ? 'NAVE ANNULLATA' : 'NAVE NON OPERATIVA',
      'Il programma navi riporta uno stato che non permette di considerare aperta l’accettazione.');
  }
  const closingRaw = normalizedCode(row.closing);
  const closing = parseItalianDate(closingRaw);
  if (/\b(CLOSED|CHIUSO|SUSPENDED|STOPPED)\b/.test(closingRaw)) {
    return bad('ACCETTAZIONE CHIUSA','Il terminal indica espressamente che l’accettazione è chiusa o sospesa.');
  }
  const localNow=romeNowISO(now);
  if (closing && closing <= localNow) {
    return bad('TERMINE ACCETTAZIONE SCADUTO','L’orario previsto per consegnare il carico è già trascorso.');
  }
  if (!closing) {
    return unknown('CHIUSURA DA VERIFICARE','Non è possibile leggere una data valida di chiusura dell’accettazione.');
  }
  if (!OPERATIVE_STATUSES.has(status)) {
    return unknown('STATO NAVE DA VERIFICARE','Lo stato della nave non è riconosciuto: non è sicuro confermare l’accettazione.');
  }
  const eta=parseItalianDate(row.eta);
  if (!eta) {
    return unknown('ARRIVO DA VERIFICARE','La data di arrivo della nave è assente o non valida.');
  }
  if (['PENDING','FORECAST','SCHEDULED'].includes(status)) {
    // Both ISO timestamps represent the same local wall-clock time zone.
    const hoursOverdue=(Date.parse(localNow+':00Z')-Date.parse(eta+':00Z'))/3600000;
    if (hoursOverdue > 24) {
      return unknown('PROGRAMMA DA CONFERMARE','La nave è ancora indicata come prevista, ma l’ETA risale a oltre 24 ore fa.');
    }
  }
  return null;
}

export function evaluateSctType(row, updatedAt, type, now=new Date()) {
  const gate=guardSct(row,updatedAt,now);
  if (gate) return gate;
  if (type !== 'dry' && type !== 'reefer') {
    return unknown('TIPO CONTAINER DA SCEGLIERE','Indica se il container è standard o refrigerato.');
  }
  const label=type==='dry'?'STANDARD':'REFRIGERATI';
  const code=acceptanceCode(type==='dry'?row.acceptance_dry:row.acceptance_reef);
  if (code==='yes') {
    return {kind:'good', label:'ACCETTA '+label, reason:'Accettazione della nave confermata per questa tipologia; verificare comunque il singolo container.'};
  }
  if (code==='no') {
    return bad('NON ACCETTA '+label,'Il programma navi indica che questa tipologia di container non è in accettazione.');
  }
  return unknown(label+' DA VERIFICARE','Per questa tipologia non è disponibile una conferma esplicita di accettazione.');
}
export function evaluateSct(row, updatedAt, now=new Date()) {
  const gate=guardSct(row,updatedAt,now);
  if(gate) return gate;
  const dry=acceptanceCode(row.acceptance_dry);
  const reefer=acceptanceCode(row.acceptance_reef);
  if(dry==='yes' && reefer==='yes') {
    return {kind:'good',label:'ACCETTA ENTRAMBI I TIPI',reason:'Accettazione confermata a livello nave per standard e refrigerati. Il singolo booking resta da verificare.'};
  }
  if(dry==='no' && reefer==='no') {
    return bad('NON ACCETTA CARICO','Il programma navi nega esplicitamente l’accettazione per entrambe le tipologie.');
  }
  if(dry==='yes' || reefer==='yes') {
    return {kind:'warn',label:dry==='yes'?'SOLO STANDARD CONFERMATO':'SOLO REFRIGERATI CONFERMATI',reason:'La nave accetta almeno una tipologia. Scegli il tipo di container per una risposta precisa.'};
  }
  return unknown('ACCETTAZIONE DA VERIFICARE','Mancano indicazioni esplicite sufficienti per confermare l’accettazione.');
}

export function findSctVessels(rows, query) {
  const n = normalizeName(query);
  if (n.length < 3) return [];
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const v = normalizeName(row.vessel);
    return v.length >= 3 && (v.includes(n) || n.includes(v));
  });
}

/** Each scheduled voyage stays selectable separately, even for repeated vessel names. */
export function listSctVoyages(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => ({row, index}))
    .filter(({row}) => normalizeName(row?.vessel).length >= 3)
    .sort((a, b) => String(a.row.vessel).localeCompare(String(b.row.vessel), 'it', {sensitivity:'base'})
      || String(parseItalianDate(a.row.eta) || '9999').localeCompare(String(parseItalianDate(b.row.eta) || '9999'))
      || String(a.row.voyage || '').localeCompare(String(b.row.voyage || '')));
}

/**
 * Traduzioni delle diciture pubblicate dal terminal SCT.
 * I valori originali rimangono invariati nei dati per non alterare
 * l’interpretazione delle informazioni operative.
 */
export function describeAcceptance(value) {
  const code=acceptanceCode(value);
  if(code==='yes') return 'ACCETTA CARICO';
  if(code==='no') return 'NON ACCETTA CARICO';
  return 'DA VERIFICARE';
}

export function describeVesselStatus(value) {
  const code = String(value ?? '').trim().toUpperCase();
  const names = {
    PENDING: 'PREVISTA', FORECAST: 'PREVISTA', SCHEDULED: 'PROGRAMMATA',
    ARRIVED: 'ARRIVATA', BERTHED: 'ORMEGGIATA', 'IN PORT': 'IN PORTO',
    WORKING: 'IN LAVORAZIONE', LOADING: 'IN CARICAZIONE',
    DEPARTED: 'PARTITA', SAILED: 'PARTITA', CLOSED: 'CHIUSA',
    CANCELLED: 'ANNULLATA', CANCELED: 'ANNULLATA'
  };
  return names[code] ?? 'DA VERIFICARE';
}

export function describeClosing(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'DA VERIFICARE';
  // Mantiene la data e l’ora originali, traducendo solo la dicitura inglese.
  return raw.replace(/\bCLOSED\b/gi,'CHIUSO').replace(/\bOPEN\b/gi,'APERTO');
}
