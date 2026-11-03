/**
 * Importa un risultato TFG copiato dall'utente dal portale ufficiale.
 * Non comunica con TFG, non conserva booking e non presume accettazione.
 * Se il booking nel testo differisce da quello cercato, blocca l'esito.
 */
import {normalizeBooking} from './booking_search.mjs';

export function parseTfgBookingResult(raw, searchedBooking='') {
  const input = String(raw ?? '').slice(0,16000)
    .replace(/\u00a0/g,' ')
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .trim();
  const expected=normalizeBooking(searchedBooking);
  const bookingRegex=/(?:^|\n)\s*BOOKING(?:\s*(?:NUMERO|N[.°º]?|NR\.?))?\s*[:#-]?\s*([A-Z0-9/-]{4,50})\b/gi;
  const bookingCodes=[...input.matchAll(bookingRegex)].map(m=>normalizeBooking(m[1]));
  const unique=[...new Set(bookingCodes)];
  const found=unique.length===1?unique[0]:null;
  const bookingMatch=Boolean(found && expected && found===expected);
  const bookingState=unique.length>1?'ambiguous':
    found?(expected&&!bookingMatch?'mismatch':'match'):'not-present';

  // Il portale riporta un'intestazione del tipo:
  // "MV SAGARMALA 05/11/26 Voy: 645W Armatore MSK"
  const vesselMatch=input.match(/\b(?:MV|M\/V|NAVE)\s+([A-Z][A-Z0-9\s.'-]{2,70}?)\s+(\d{2}\/\d{2}\/\d{2,4})\s+Voy(?:age|aggio)?\.?\s*:?\s*([A-Z0-9./-]{1,20})\b/i);
  let vessel=vesselMatch?.[1]?.trim().replace(/\s+/g,' ')||null;
  let vesselDate=vesselMatch?.[2]||null;
  let voyage=vesselMatch?.[3]?.trim().toUpperCase()||null;
  if(vessel && /\b(?:BOOKING|SCARICARE PRESSO|CNTRS ENTRATI)\b/i.test(vessel)) {
    vessel=null;vesselDate=null;voyage=null;
  }
  const carrierMatch=input.match(/\bArmatore\s*[:\-]?\s*([A-Z0-9][A-Z0-9.-]{1,25})\b/i);
  const carrier=carrierMatch?.[1]?.trim().toUpperCase()||null;
  // Il risultato booking identifica nave e viaggio, non il luogo di scarico.
  const hasContent=Boolean(vessel||voyage);
  const usable=bookingState==='match' && Boolean(vessel && voyage);
  let reason='';
  if(bookingState==='ambiguous')reason='Nel testo sono presenti più codici booking differenti: impossibile identificare con certezza quello cercato.';
  else if(bookingState==='mismatch')reason='Il booking riportato dal sito è diverso da quello inserito. Non utilizzare questo risultato.';
  else if(bookingState==='not-present')reason='Numero booking non presente nel testo: non è possibile collegare con certezza i dati alla ricerca.';
  else if(!vessel||!voyage)reason='Mancano nave o viaggio nel testo copiato.';
  else reason='Nave e viaggio letti dal testo copiato. Il luogo viene letto solo dalla colonna TERMINAL DI CONSEGNA del programma ufficiale TFG.';
  return {booking:found,bookingState,bookingMatch,vessel,vesselDate,voyage,carrier,hasContent,usable,reason};
}
