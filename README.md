# Container Booking Web — versione 0.65

Web app mobile in italiano per autisti container nei porti di Napoli e Salerno. Consultare a veicolo fermo. Gli stati dei programmi navi non autorizzano il singolo booking o l'ingresso al terminal.

I loghi e i marchi appartengono ai rispettivi titolari e sono usati soltanto per identificare i terminal, senza affiliazione né autorizzazioni d'ingresso. Le fonti dei file locali sono documentate in [assets/terminal-logos/SOURCES.md](assets/terminal-logos/SOURCES.md).

## Stato del progetto — 2 novembre 2026

**Versione frontend: v0.65 (GitHub Pages). Backend: Cloudflare Worker v0.63.** L'app è destinata agli autisti container di Napoli e Salerno e non richiede un PC acceso per aggiornare i programmi.

| Verifica | Risultato documentato |
| --- | --- |
| GitHub Pages | v0.65 pubblicata; HTTP 200 reale da GitHub Actions |
| Cloudflare | Worker v0.63 attivo al 100%; cron `*/15 * * * *` e binding KV mantenuti |
| Monitor ufficiale | Ultima lettura verificata **2 novembre 2026, 10:45:16 UTC**: CNT **36**, TFG **20**, SCT **25** viaggi, tutti `ok` |
| Backup GitHub | Nuovi snapshot intorno alle **10:51 UTC**, pubblicati dal job `refresh` |
| QA automatica | Python, JavaScript, Chromium Android e navigazione del sito pubblico **superati** |
| QA HTTP/429 | Health, monitor e snapshot HTTP 200; blocco nativo **429 alla 22ª richiesta** di prova con booking vuoto |
| Android fisico | **6 prove funzionali su 6 dichiarate OK dall'utilizzatore**, compresi offline e ripristino rete; non è un test eseguito dall'automazione |
| Da completare | Confronto con booking operativi reali e **monitoraggio continuativo documentato di 24 ore** |

I dati della tabella sono **un'istantanea del collaudo**, non uno stato live permanente. Per lo stato attuale usare l'[API monitor](https://container-booking-backend.pasqualemilano0.workers.dev/api/monitor/status). Il [verbale dei test HTTP/429](docs/QA_LIVE_HTTP_429_2026-11-02.md) contiene richieste, risultati e limiti effettivi.

## Interventi completati — novembre 2026

| Intervento | Correzione e risultato | Evidenza |
| --- | --- | --- |
| **SCT — parser Cloudflare** | Risolto `SCT_NO_VALID_ROWS`: le colonne operative Dry/Reefer sono quelle successive a `STATUS`; lettura ufficiale riuscita, 25 righe | [PR #12](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/12) |
| **TFG — date e freschezza, v0.62** | Una pubblicazione invariata per giorni non rende obsoleta una lettura diretta recente. `acquired_at` e `source_updated_at` restano distinti; fallback e cut-off conservano gli avvisi | [PR #13](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/13) |
| **Sicurezza API, v0.63** | Rate limiting Cloudflare nativo per ricerca booking e lettura TFG diretta; `429`, `Retry-After`, nessun booking in KV; errore `503` se binding mancante | [PR #14](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/14) |
| **CNT — abbinamento nave/viaggio, v0.64** | ETA/orari validati; ID viaggio richiesto per l'incrocio; avviso visibile **VIAGGIO DEL BOOKING NON CONFERMATO** quando si identifica soltanto la nave | [PR #15](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/15) |
| **Backup GitHub affidabile** | Ripristinati i test Python; separati i job `verify` e `refresh`, così un errore di test UI non ferma gli aggiornamenti dei programmi | [PR #16](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/16) |
| **Errori rete e offline, v0.65** | CNT/SCT mantengono le navi consultabili quando la lettura fallisce, ma **nessuna vecchia conferma verde**; TFG indica mancanza di lettura live; ripresa dopo riconnessione | [PR #17](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/17) |
| **Verifica pubblica e 429 reale** | HTTP 200 per Pages, health, monitor e snapshot; `429 RATE_LIMITED` reale su payload non valido, senza booking o chiamate TFG; test successivi solo manuali | [PR #18](https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/18) |

Le versioni **v0.54–v0.61** sono documentate nella cronologia sotto. Alcune regole storiche (per esempio la soglia TFG basata su 48 ore dalla pubblicazione) sono state **sostituite**: fanno fede le sezioni *Regole operative* e *Novità v0.62–v0.65*.

## GitHub + Cloudflare

| Componente | Servizio |
| --- | --- |
| Repository e frontend | GitHub e [GitHub Pages](https://pasqualemilano0-rgb.github.io/container-booking-web-/) |
| Backend | Cloudflare Worker `container-booking-backend` |
| Programmi navi H24 | Cloudflare Cron ogni 15 minuti e Workers KV |
| Copie pubbliche di riserva | GitHub Actions e `data/*.json`; job `refresh` indipendente dalla QA |

Il frontend usa un solo backend Cloudflare. Le vecchie funzioni server e la relativa configurazione di hosting sono state rimosse. Gli script Python rimasti raccolgono i programmi pubblici e svolgono QA su GitHub.

## Percorsi dell'autista

| Terminal | Ricerca | Fonte e risultato |
| --- | --- | --- |
| CO.NA.TE.CO., Napoli | Numero booking | Booking Export → nome nave → stato di accettazione carico dal Berth Forecast |
| Terminal Flavio Gioia, Napoli | Numero booking | POST al Worker, quindi al modulo ufficiale TFG; nave/viaggio solo quando riconoscibili senza ambiguità |
| SCT, Salerno | Nome nave o viaggio | Vessel Schedule ufficiale, ETA, closing e accettazioni Dry/Reefer distinte |

La ricerca CNT invia il booking direttamente al terminal ufficiale. La ricerca TFG lo invia al Worker soltanto dopo il tocco dell'autista e lo inoltra con POST al modulo ufficiale. Nessun booking viene salvato su KV, nei file dei programmi, negli URL del backend o nei log applicativi.

L'integrazione CNT usa `GET https://api.conateco.it/ConatecoServicesApi/Booking?id_booking=CODICE_BOOKING` per leggere e validare `B_NOMNAVE` dalla risposta JSON ufficiale. Il codice `ReturnCode` non è vincolato al solo zero: il JavaScript ufficiale mostra nave ed ETA dopo il successo HTTP; un codice numerico negativo resta un errore per prudenza; il programma pubblico proviene da `GET https://api.conateco.it/ConatecoServicesApi/BerthForecast`. La ricerca booking non è effettuata dal monitor H24. Il programma è acquisito da Cloudflare e conservato anche nelle copie di riserva GitHub.

## Monitor H24

Il cron server `*/15 * * * *` controlla CNT, TFG e SCT ai minuti 00, 15, 30 e 45 di ogni ora, anche con app chiusa e telefono/PC spenti. Non è streaming e non garantisce che i terminal pubblichino nuovi dati a ogni controllo.

[Stato pubblico del monitor](https://container-booking-backend.pasqualemilano0.workers.dev/api/monitor/status): esiti, tentativi, successi, acquisizioni e numero di righe, senza booking.

- CNT e TFG vengono letti dalle fonti ufficiali; una copia valida resta disponibile se una successiva lettura fallisce.
- SCT può bloccare la lettura da Cloudflare. Il Worker usa allora lo snapshot verificato da GitHub Actions, marcato `github_verified_fallback`, conservando `acquired_at` originale.
- L'acquisizione recente non equivale a un aggiornamento recente del terminal. In particolare TFG conserva separatamente `source_updated_at`.
- Il frontend confronta le copie disponibili e usa la più recente valida; per TFG preferisce una lettura diretta riuscita. Una riserva non diventa una lettura live.

Cloudflare esegue il monitor ai minuti 00/15/30/45. In parallelo, GitHub Actions ha cron indicativi ai minuti **07/22/37/52**: scarica e pubblica gli snapshot di riserva, ma GitHub può ritardare le esecuzioni. Il job `refresh` è indipendente da `verify` (PR #16). Le copie precedenti sono conservate se una lettura non è verificabile; l'orario `acquired_at` **non deve essere inventato o rinnovato artificialmente**.

Il primo ciclo H24 verificato il 1 novembre 2026 alle 08:00:17 UTC ha archiviato CNT, TFG e SCT in KV. Il ripristino successivo del parser SCT, del monitor TFG e degli snapshot GitHub è documentato in [docs/STATO_PROGETTO.md](docs/STATO_PROGETTO.md).

## Backend Cloudflare

| Metodo e rotta | Scopo |
| --- | --- |
| GET `/api/health` | Disponibilità del Worker e presenza del binding KV |
| GET `/api/monitor/status` | Stato dei tre controlli programmati |
| GET `/api/cnt` | Copia CNT archiviata |
| GET `/api/sct` | Copia SCT archiviata, con provenienza esplicita |
| GET `/api/tfg/snapshot` | Copia TFG archiviata |
| GET `/api/tfg` | Lettura diretta del programma TFG su richiesta |
| POST `/api/tfg_booking` | Ricerca booking TFG esplicita, separata dal monitor |

Origine frontend autorizzata: `https://pasqualemilano0-rgb.github.io`. Il POST booking accetta solo JSON con il campo `booking`, massimo 512 byte effettivi. La risposta HTML ufficiale è limitata a 100 kB e il collegamento ha un timeout. Non si disabilita TLS e non si aggirano login o CAPTCHA.

Il parser booking richiede il titolo `EXPORT BOOKING`, controlla il codice eventualmente riportato e accetta solo una coppia nave/viaggio. Risposte ambigue o non riconosciute restano `unverified`. Ogni esito ha `booking_authorized:false`; il luogo di consegna proviene soltanto dal programma navi ufficiale TFG.

### Protezione antiabuso TFG

| Percorso | Limite per client/IP | Limite aggregato per sede Cloudflare |
| --- | ---: | ---: |
| `POST /api/tfg_booking` | 20 richieste / 60 s | 180 richieste / 60 s |
| `GET /api/tfg` | 45 richieste / 60 s | 300 richieste / 60 s |

I quattro binding sono definiti in [cloudflare/wrangler.jsonc](cloudflare/wrangler.jsonc), utilizzano `CF-Connecting-IP` (non `X-Forwarded-For`) e **non salvano booking/IP nei programmi KV**. Le richieste eccessive ricevono `429 RATE_LIMITED` con `Retry-After: 60`; se il limitatore non è disponibile le rotte protette rispondono `503` senza interrogare TFG.

I limiti sono **approssimativi, per sede Cloudflare e a consistenza eventuale**, non un tetto mondiale rigido. La prima prova da runner con **26 richieste in rapida successione** non aveva prodotto `429`; la prova successiva, distanziata di circa 550 ms, ha ottenuto il **429 alla richiesta 22**. Ogni prova ha usato esclusivamente `{"booking":""}`, rifiutato dal Worker prima di contattare il terminal ufficiale. Vedi [report completo](docs/QA_LIVE_HTTP_429_2026-11-02.md).

La verifica 429 in `.github/workflows/qa-live-gateway.yml` è **solo manuale**: non va ripetuta a ogni push.

## Regole operative

- **CNT:** stato e opzioni della nave usano il nome esatto normalizzato e una riga corrente univoca; l'ETA ha priorità quando identifica un solo viaggio. Con depot esterni «OK» si mostrano **INTERNO PORTO / DRYPORT**, secondo la regola del proprietario. Più corrispondenze o dati vecchi restano da verificare. Per attribuire viaggio e destinazione al booking servono invece anche giorno ETA coincidente e un'unica riga; le opzioni della nave non certificano il singolo booking.
- **TFG:** `TERMINAL DI CONSEGNA` è l'unica fonte del luogo. Il testo principale mostra il solo valore pubblicato; una lettura diretta riuscita entro 90 minuti ne conferma l'attuale pubblicazione anche se l'ultima modifica dichiarata dal terminal risale a giorni prima. Copie e letture non riuscite richiedono un avviso visibile, senza cambiare il nome del luogo. Lo stato nave `ACCETTA CARICO` ha regole distinte e non autorizza il booking.
- **SCT:** Dry e Reefer restano separati; stato operativo, ETA e closing devono essere leggibili. L'acquisizione non sostituisce un orario ufficiale di aggiornamento non pubblicato.
- **Guasti di rete:** un errore di aggiornamento mantiene la copia precedente consultabile, ma `refresh_failed:true` rende i verdetti CNT/SCT non confermati. Per TFG `live:false` e `live_failed:true` impediscono conferme live. La successiva lettura riuscita ripristina la valutazione ordinaria, senza sostituire artificialmente le date delle copie.
- Dati mancanti, vecchi o contraddittori non producono autorizzazioni inventate. Il portale ufficiale resta il riferimento prima della consegna.

## Novità v0.65 — Errori di rete, recupero dati e segnalazioni affidabili

- Se la lettura aggiornata **CNT o SCT** fallisce, l'app mantiene consultabile l'ultimo elenco già caricato, senza cancellare le navi né alterare `acquired_at`. La copia viene contrassegnata in memoria con `refresh_failed`: **non compaiono conferme verdi** fino alla lettura successiva riuscita.
- Senza connessione, tutti e tre i terminal mostrano subito un avviso esplicito. CNT/SCT rendono consultabili le copie precedenti con verdetti non confermati; TFG mantiene le navi ma disabilita la conferma live (`live:false`, `live_failed:true`). Nessuna richiesta a siti esterni mentre il browser è offline.
- Alla nuova lettura riuscita si rimuove il flag di errore e si rivalutano gli stati usando le regole operative esistenti. I dettagli del booking CNT non devono continuare a mostrare il verde dopo il fallimento di una lettura del Berth Forecast.
- Test unitari delle regole e regressione browser `tests/qa_network_recovery.cjs`: fallimento dei tre provider di copia CNT/SCT, recupero, modalità offline, nessuna richiesta di rete offline. Dati sintetici: nessun booking reale.
- Le copie di riserva TFG e SCT da GitHub e GitHub Pages hanno un timeout massimo di 10 secondi a tentativo (Cloudflare 7 secondi), per evitare schermate bloccate in caso di rete lenta o server irraggiungibile.
- I test Python della versione ora validano la struttura del numero di versione e dei cache-buster, invece di richiedere una stringa fissa a ogni rilascio. Nessuna modifica a Worker, Cloudflare KV, cron, Booking Export o parser delle navi.

## Novità v0.64 — Incrocio sicuro booking/nave CNT

- Il Booking Export CNT continua a mostrare **la nave individuata**, anche se l'ETA non è disponibile o discordante: lo stato del Berth Forecast è uno **stato della nave**, non autorizzazione del singolo booking.
- Gli ETA testuali ora devono avere data/orario validi per consentire un incrocio nave + giorno ETA: suffix arbitrari, ore impossibili e minuti/secondi invalidi non possono generare una corrispondenza.
- Per parlare di viaggio incrociato deve esistere una riga univoca con **identificativo di viaggio pubblicato** e priva di conflitti. Duplicati, ETA non interpretabili o viaggi sconosciuti restano non verificati.
- Se la selezione avviene **solo tramite nome nave**, il riquadro principale mostra **«VIAGGIO DEL BOOKING NON CONFERMATO»**, visibile anche con i dettagli chiusi, e le opzioni restano esplicitamente riferite alla nave.
- Non vengono modificati TFG, SCT, cron Cloudflare, KV o archiviazione dati booking.

## Novità v0.63 — Protezione API Cloudflare

- Cloudflare Workers usa **quattro rate-limit binding nativi** senza registrare booking o client in KV: POST TFG per client 20/min e per sede Cloudflare 180/min; GET TFG diretto per client 45/min e per sede Cloudflare 300/min. I contatori sono approssimativi e distinti per sede; non sono un blocco globale assoluto.
- Il client è identificato da `CF-Connecting-IP` impostato da Cloudflare, mai da `X-Forwarded-For`. Il limite per IP è volutamente generoso per le connessioni mobili condivise.
- Risposta 429 `RATE_LIMITED` con `Retry-After: 60`, CORS e `no-store`; nessun fetch a TFG quando il limite è superato. Se i binding nativi mancano o falliscono in produzione, le sole rotte costose TFG restituiscono 503 senza contattare il terminal. Il client mostra un avviso per attendere.
- Limitazioni: CORS non è autenticazione, e i rate limit nativi Cloudflare sono locali e approssimativi. Non sono stati aggiunti account, Durable Objects, database, log o servizi di terze parti. CNT, SCT, cron e KV restano invariati.

## Novità v0.62

- Corretto TFG: una nuova lettura diretta riuscita è valida anche se `source_updated_at` non cambia da giorni. Nessuna scadenza fissa di 48 ore sulla pubblicazione.
- `source_updated_at` e `acquired_at` restano separati; il secondo determina la freschezza della lettura. Dati invalidi o futuri, fallback, cut-off e nave chiusa rimangono protetti.
- Il luogo pubblicato in copia non riconfermata mantiene il nome originale e mostra un avviso visibile; nessuna autorizzazione del booking viene attribuita.
- Monitor Cloudflare distingue lettura riuscita da nuova pubblicazione; test e QA browser aggiornati.

## Novità v0.61

- CONATECO usa la stessa grafica del riquadro consegna TFG, con nome nave e opzioni in evidenza e fonte/date nei dettagli apribili.
- Con depot esterni «OK» (`accettazioneesterni=S`) il riquadro mostra **INTERNO PORTO / DRYPORT**, secondo la regola operativa indicata dal proprietario.
- Le opzioni sono riferite alla nave univoca nel programma corrente. Freschezza, stato del carico e verifica del viaggio del booking mantengono controlli separati; dati vecchi o ambigui non producono opzioni di consegna.

## Novità v0.60

- Grafica del risultato TFG rinnovata: nome nave grande, viaggio compatto, stato nave e riquadro blu scuro per il terminal di consegna.
- Il luogo mostra il valore pubblicato, per esempio «INTERNO PORTO», senza suffissi. Fonte, data di lettura, aggiornamento e note si aprono da «Fonte e aggiornamento».
- Le informazioni del booking si consultano in un pannello separato. Riconoscimento nave/viaggio, controlli di freschezza e provenienza del luogo rimangono distinti.

## Novità v0.59 — storico, superato dalla v0.62

**Nota:** la regola delle 48 ore descritta sotto è storica e **non è più in vigore**. Dalla v0.62 conta una nuova lettura diretta riuscita, anche con pubblicazione ufficiale invariata da giorni.

- La v0.59 mostrava «ACCETTA CARICO» in verde con lettura diretta recente e pubblicazione del programma entro 48 ore; tale soglia è stata poi rimossa.
- Rimosso il suffisso «DATO VECCHIO» dal badge TFG. La data ufficiale resta visibile nei dettagli; oltre la finestra, con date mancanti o senza lettura diretta lo stato richiede riconferma.
- Restano prioritari nave chiusa, non accettazione e cut-off generale scaduto. Il luogo di consegna mantiene i controlli di freschezza distinti.

## Novità v0.58

- Corretto il blocco «Codice inatteso del terminal»: l'app imponeva `ReturnCode=0`, requisito non presente nel JavaScript del portale ufficiale.
- Una risposta JSON con nome nave valido permette di proseguire al Berth Forecast anche con un codice non negativo diverso da zero. Il codice da solo non dimostra mai che esista una nave.
- `ReturnCode` può mancare o essere nullo; quando valorizzato deve essere un intero sicuro. Errori numerici negativi e campi nave mancanti o non validi restano non confermati. L'errore senza messaggio mostra il codice per facilitare la diagnosi.

## Novità v0.57

- Dopo il booking, nome nave e «ACCETTA CARICO (NAVE)» / «NON ACCETTA CARICO» sono subito visibili, con fonte e acquisizione del Berth Forecast. Stati incerti restano da verificare.
- Una nave corrente univoca permette di consultarne lo stato anche con ETA del booking mancante o diversa. Nessuna scelta arbitraria fra più viaggi e nessuna destinazione attribuita al booking dal solo nome.
- I nuovi programmi aggiornano lo stato della ricerca aperta senza inviare nuovamente il booking. Freschezza e cut-off sono rivalutati ogni 30 secondi; copie più vecchie non sostituiscono una già più recente.
- Timeout anche sulle fonti di riserva; aprire una scheda nave annulla eventuali ricerche booking precedenti.

## Novità v0.56

- Il risultato CNT mette subito in evidenza il nome nave restituito dal Booking Export ufficiale.
- ETA, messaggio del terminal e programma nave restano consultabili in «Dettagli del terminal», inizialmente chiusi.
- Un'ETA mancante o discordante non nasconde il nome nave. Restano invariati i controlli per associare i dati del programma navi.

## Novità v0.55

- ETA Booking Export CNT in formato `YYYYMMDDHHmmss` resa leggibile come `DD/MM/YYYY HH:mm`, mantenendo l'orario pubblicato dal terminal.
- Date e orari compatti invalidi non producono abbinamenti al programma navi. Restano necessari nave normalizzata, stesso giorno ETA e un'unica riga.
- Un'ETA discordante fra booking e programma lascia il luogo di consegna da verificare.

## Novità v0.54

- Backend TFG completamente su Cloudflare, con monitor H24 e copie GitHub conservati.
- Rimossi gli endpoint server precedenti e le relative configurazioni, test e istruzioni obsolete.
- Corretto il filtro CNT senza risultati: messaggio, contatore e paginazione si aggiornano; cancellando il filtro torna l'elenco.
- Versione e cache-buster aggiornati; QA browser verifica anche assenza di richieste verso il precedente hosting.

## Test e sviluppo

Requisiti: Node.js 22+, Python 3.12+ e dipendenze in `requirements.txt`.

```bash
python -m pip install -r requirements.txt
node --check app.js
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python -m http.server 8765 --bind 127.0.0.1
```

La QA Chromium è in `.github/workflows/qa-main-browser.yml` e usa fixture sintetiche: prova le larghezze Android **320, 390, 432 px** (e schermi più grandi), ricerche booking senza codici reali, ritorno offline e recupero della rete. Sono inclusi `tests/qa_network_recovery.cjs` e `tests/qa_public_site.cjs`. Il monitor GitHub `.github/workflows/pages.yml` usa job separati `verify` e `refresh`: anche con problemi di QA dei testi, la raccolta navi non viene bloccata.

I controlli pubblici aggiuntivi sono `scripts/qa_tfg_public_backend.py`, `scripts/qa_tfg_booking_live_backend.py`, `scripts/qa_cloudflare_monitor_public.py`. Il workflow `.github/workflows/qa-cloudflare.yml` controlla sintassi, API, parser e build del Worker. L'ulteriore test `tests/qa_live_gateway.cjs` verifica HTTP Pages, health, monitor e `429`, ma la sua esecuzione **deve rimanere su avvio manuale**.

```bash
npx --yes wrangler@4.156.0 deploy --dry-run --config cloudflare/wrangler.jsonc
```

Il workflow di deploy Worker è subordinato a `CLOUDFLARE_DEPLOY_ENABLED`. Il successo dei test o del deploy Pages non prova che il Worker sia stato aggiornato: verificare sempre versione installata, cron, binding e HTTPS.

## Collaudi e risultati verificati

| Prova | Evidenza | Esito |
| --- | --- | --- |
| Regole Python, JavaScript e parsing | Job `verify` e QA Cloudflare; regressioni CNT/TFG/SCT | **Superato** |
| Browser Chromium Android | Percorsi dei tre terminal e fixture, anche 320–432 px | **Superato** |
| Interruzione e ripristino rete simulati | `tests/qa_network_recovery.cjs`: copie conservate, niente verde senza nuova lettura | **Superato** |
| Pubblicazione e browser del sito reale | GitHub Pages HTTP 200, v0.65, nessun errore JS rilevato nel test | **Superato** |
| API reali Cloudflare e CORS | `/api/health`, `/api/monitor/status`, snapshot CNT/TFG/SCT HTTP 200 | **Superato** |
| Rate limit reale TFG | `429` alla 22ª richiesta con booking vuoto; `Retry-After:60`; health disponibile | **Superato**, con limiti approssimativi |
| Verifica pratica su telefono Android | **6/6 controlli comunicati come OK dall'utilizzatore**: apertura, CNT, TFG, SCT Dry/Reefer, offline senza verde, ripristino online | **Completato dall'utilizzatore** |
| Booking operativi reali CNT/TFG confrontati con portali | Non ancora documentato un collaudo conclusivo per questa versione | **Aperto** |
| 24 ore consecutive di aggiornamenti e pubblicazioni | Non ancora certificato un intervallo completo di 24 ore | **Aperto** |

**Evidenze:**
- [QA browser Android di produzione su v0.65](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41432093115)
- [QA refresh/verify e snapshot su `main`](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41432093051)
- [Ultimo deployment Pages verificato per v0.65](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41432123567)
- [Test live API e 429, run riuscita](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41431650511)
- [Report tecnico HTTP e 429](docs/QA_LIVE_HTTP_429_2026-11-02.md) e [handoff tecnico](docs/STATO_PROGETTO.md)

La prova Android è **dichiarata dall'utilizzatore**, non raccolta da telemetria o strumenti di accesso remoto. I test Chromium e la prova sul telefono sono dunque evidenze diverse: non equivalgono a garanzia di correttezza di ogni booking.

## Controlli ancora aperti e limiti

1. **Booking reali CNT e TFG:** confrontare, con i portali ufficiali e senza pubblicare codici riservati, nave, viaggio, ETA, accettazione e luogo. Lo stato `ACCETTA CARICO` riguarda la nave, **non** l'autorizzazione del singolo booking.
2. **Monitoraggio 24 ore:** controllare ripetutamente cron Cloudflare, stato `ok`/errori, `acquired_at` e pubblicazioni GitHub; non scambiare il successo di alcuni cicli con 24 ore consecutive di disponibilità.
3. **Cambi reali di programma e cut-off:** osservare nell'uso operativo come l'app tratta chiusure, viaggi modificati, mancate letture e fallback.
4. **Diversità di soglie:** il monitor marca copie vecchie oltre 45 minuti mentre alcune verifiche frontend usano 90 minuti. Va valutata e documentata un'eventuale armonizzazione, senza introdurre falsi `ok`.
5. **Limiti della sicurezza:** CORS non autentica i client, gli IP mobili possono essere condivisi e i limiti nativi Cloudflare non sono perfettamente rigorosi nelle raffiche; non dichiarare protezione totale contro DDoS.

**Stato del rilascio:** v0.65 funzionante e verificata per le prove elencate. Le verifiche ancora aperte non richiedono di modificare le regole operative attualmente pubblicate.

## Fonti ufficiali

- [CO.NA.TE.CO. Booking Export](https://www.conateco.it/booking-export/)
- [CO.NA.TE.CO. Berth Forecast](https://www.conateco.it/berth-forecast/)
- [TFG Export Booking](https://tfg.bucci.it/@/TFGW_WW_BKK)
- [TFG Programma Navi](https://tfg.bucci.it/@/TFGW_TP_ETA)
- [SCT Vessel Schedule](https://www.salernocontainerterminal.com/vessel-schedule/)
