import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, parseItalianDate, findSctVessels, evaluateSct,
  evaluateSctType, isSnapshotRecent, isSctFeedRecent, listSctVoyages,
  describeAcceptance, describeVesselStatus, describeClosing
} from '../rules.mjs';

const now=new Date('2026-10-31T08:00:00Z'); // 09:00 Europe/Rome
const recent='2026-10-31T07:45:00Z';
const base={
  vessel:'MSC CHIARA X', voyage:'CD644A', eta:'01/11/2026 14:00',
  closing:'01/11/2026 10:00', status:'PENDING',
  acceptance_dry:'CARGO ACCEPTED', acceptance_reef:'CARGO ACCEPTED'
};
const verdict=(row,updated=recent)=>evaluateSct(row,updated,now);
const byType=(row,type,updated=recent)=>evaluateSctType(row,updated,type,now);
test('normalizzazione nave ignora spazi e punteggiatura',()=>{
  assert.equal(normalizeName('MSCCHIARAX'),normalizeName('MSC CHIARA X'));
});
test('date locali valide e invalide',()=>{
  assert.equal(parseItalianDate('31/10/2026 10:00 CLOSED'),'2026-10-31T10:00');
  assert.equal(parseItalianDate('31/02/2026 17:00'),null);
  assert.equal(parseItalianDate('01/11/2026 25:00'),null);
});
test('ricerca tollera nome senza spazi',()=>assert.equal(findSctVessels([base],'MSCCHIARAX').length,1));
test('dati non disponibili o troppo vecchi bloccano il verde',()=>{
  assert.equal(verdict(base,null).kind,'unknown');
  assert.equal(isSnapshotRecent('2026-10-29T00:00:00Z',now),false);
});
test('chiusura scaduta prevale su CARGO ACCEPTED',()=>{
  assert.equal(verdict({...base,closing:'30/10/2026 17:00 CLOSED'}).kind,'bad');
  assert.equal(verdict({...base,closing:'31/10/2026 08:00'}).label,'TERMINE ACCETTAZIONE SCADUTO');
});
test('nave partita e annullata mai in accettazione',()=>{
  for(const status of ['DEPARTED','SAILED','CANCELLED','CANCELED','CLOSED']){
    assert.equal(verdict({...base,status}).kind,'bad',status);
  }
});
test('stato nave sconosciuto o mancante non conferma accettazione',()=>{
  for(const status of ['','OTHER','DELAYED','MISSING']){
    assert.equal(verdict({...base,status}).kind,'unknown',status);
  }
});
test('prevista con ETA scaduta da oltre 24h non conferma',()=>{
  assert.equal(verdict({...base,eta:'29/10/2026 07:00'}).label,'PROGRAMMA DA CONFERMARE');
});
test('ETA invalida non produce accettazione positiva',()=>{
  assert.equal(verdict({...base,eta:'-'}).kind,'unknown');
});
test('se manca orario chiusura non dichiara positivo',()=>{
  assert.equal(verdict({...base,closing:'-'}).kind,'unknown');
});
test('accettazione positiva è a livello nave, non per singolo booking',()=>{
  assert.equal(verdict(base).label,'ACCETTA ENTRAMBI I TIPI');
  assert.equal(byType(base,'dry').label,'ACCETTA STANDARD');
  assert.equal(byType(base,'reefer').label,'ACCETTA REFRIGERATI');
});
test('standard positivo non deve far risultare positivo refrigerato',()=>{
  const row={...base,acceptance_reef:'NOT ACCEPTED'};
  assert.equal(verdict(row).kind,'warn');
  assert.equal(byType(row,'dry').kind,'good');
  assert.equal(byType(row,'reefer').kind,'bad');
});
test('refrigerato positivo non deve far risultare positivo standard',()=>{
  const row={...base,acceptance_dry:'NOT ACCEPTED'};
  assert.equal(verdict(row).kind,'warn');
  assert.equal(byType(row,'dry').kind,'bad');
  assert.equal(byType(row,'reefer').kind,'good');
});
test('due tipologie rifiutate risultano non accettate',()=>{
  assert.equal(verdict({...base,acceptance_dry:'NOT ACCEPTED',acceptance_reef:'CARGO NOT ACCEPTED'}).kind,'bad');
});
test('codici accettazione sconosciuti non autorizzano',()=>{
  assert.equal(verdict({...base,acceptance_dry:'UNKNOWN',acceptance_reef:''}).kind,'unknown');
  assert.equal(byType({...base,acceptance_dry:''},'dry').kind,'unknown');
});
test('scelta tipologia non valida non produce esito positivo',()=>{
  assert.equal(byType(base,'unknown').kind,'unknown');
});
test('lista conserva viaggi distinti anche per la stessa nave',()=>{
  const rows=[
    {vessel:'MSC GIOIA',voyage:'002A',eta:'10/11/2026 14:00'},
    {vessel:'MSC GIOIA',voyage:'001A',eta:'01/11/2026 09:00'},
    {vessel:'ANCONA',voyage:'101',eta:'02/11/2026 12:00'}
  ];
  const choices=listSctVoyages(rows);
  assert.equal(choices.length,3);
  assert.equal(choices[0].row.vessel,'ANCONA');
  assert.deepEqual(new Set(choices.filter(x=>x.row.vessel==='MSC GIOIA').map(x=>x.row.voyage)),new Set(['001A','002A']));
  assert.ok(choices.every(x=>rows[x.index]===x.row));
});
test('senza navi non genera opzioni',()=>{
  assert.deepEqual(listSctVoyages(null),[]);
  assert.deepEqual(listSctVoyages([{vessel:''},{vessel:'X'}]),[]);
});
test('testi operativi italiani senza alterare dati di origine',()=>{
  assert.equal(describeAcceptance('CARGO ACCEPTED'),'ACCETTA CARICO');
  assert.equal(describeAcceptance('CARGO NOT ACCEPTED'),'NON ACCETTA CARICO');
  assert.equal(describeAcceptance('unknown'),'DA VERIFICARE');
  assert.equal(describeVesselStatus('PENDING'),'PREVISTA');
  assert.equal(describeVesselStatus('DEPARTED'),'PARTITA');
  assert.equal(describeClosing('01/11/2026 10:00 CLOSED'),'01/11/2026 10:00 CHIUSO');
});


test('SCT 2 timestamp: lettura nuova e aggiornamento sorgente vecchio bloccano il verde',()=>{
  const feed={updated_at:recent,acquired_at:recent,source_updated_at:'2026-10-30T10:00:00Z',rows:[base]};
  assert.equal(isSctFeedRecent(feed,now),false);
  assert.equal(evaluateSct(base,feed,now).kind,'unknown');
  assert.equal(evaluateSctType(base,feed,'dry',now).kind,'unknown');
});
test('SCT senza data ufficiale dichiarata distingue lettura da modifica precedente',()=>{
  const feed={updated_at:recent,acquired_at:recent,source_updated_at:null,
    data_changed_at:'2026-10-20T10:00:00Z',rows:[base]};
  assert.equal(isSctFeedRecent(feed,now),true);
  assert.equal(evaluateSctType(base,feed,'dry',now).kind,'good');
});
test('SCT acquisizione precedente troppo vecchia non si salva con updated_at recente',()=>{
  const feed={updated_at:recent,acquired_at:'2026-10-30T08:00:00Z',
    source_updated_at:null,rows:[base]};
  assert.equal(isSctFeedRecent(feed,now),false);
  assert.equal(evaluateSct(base,feed,now).kind,'unknown');
});
test('SCT fonte invalida o futura non certifica accettazione',()=>{
  for(const stamp of ['invalid','2026-11-01T12:00:00Z']){
    assert.equal(isSctFeedRecent({acquired_at:recent,source_updated_at:stamp},now),false);
  }
});

test('SCT: errore di refresh invalida la conferma pur conservando righe e orari',()=>{
 const saved={acquired_at:recent,source_updated_at:null,rows:[base]};
 assert.equal(evaluateSct(base,saved,now).kind,'good');
 const failed={...saved,refresh_failed:true};
 assert.equal(isSctFeedRecent(failed,now),false);
 assert.equal(evaluateSct(base,failed,now).kind,'unknown');
 assert.equal(evaluateSctType(base,failed,'dry',now).kind,'unknown');
 assert.equal(evaluateSct(base,{...failed,refresh_failed:false},now).kind,'good');
});
