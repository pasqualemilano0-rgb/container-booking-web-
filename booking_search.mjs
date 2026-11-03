/** Normalize formatting only; never infer the number, terminal or ship.
 * Booking stays client-side until the user explicitly opens the official site. */
export function normalizeBooking(value){
  return String(value??'').normalize('NFKC')
    .trim().toUpperCase().replace(/[\s\u00a0]+/g,'');
}
export function validateBooking(value){
  const raw=String(value??'');
  if(/[\u0000-\u001f\u007f]/.test(raw))
    return {valid:false,booking:'',reason:'Il campo contiene caratteri di controllo o più righe: inserisci un solo booking.'};
  const booking=normalizeBooking(raw);
  if(!booking)return {valid:false,booking:'',reason:'Inserisci il numero di booking.'};
  if(booking.length<4)return {valid:false,booking,reason:'Il numero booking deve contenere almeno 4 caratteri.'};
  if(booking.length>50)return {valid:false,booking,reason:'Numero booking troppo lungo: massimo 50 caratteri.'};
  if(!/^[A-Z0-9][A-Z0-9/-]*$/.test(booking))
    return {valid:false,booking,reason:'Usa solo lettere, numeri, trattino o barra. Controlla il numero sul documento.'};
  return {valid:true,booking,reason:''};
}
export function bookingTerminal(value){
  return value==='tfg'?'tfg':'cnt';
}
