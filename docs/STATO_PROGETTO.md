# Passaggio di consegne — Container Booking Web

Aggiornamento del 2 novembre 2026. Leggere insieme ad `docs/LINEE_GUIDA_TECNICHE.md`; il ramo main riceve snapshot automatici, quindi verificare sempre SHA e stato installato prima di modificare o pubblicare.

## Correzione SCT — 2 novembre 2026 (PR #12)

**Problema:** `SCT_NO_VALID_ROWS` sul Worker Cloudflare, mentre il parser Python GitHub riconosceva il programma SCT e il frontend usava `github_verified_fallback`.

**Causa concreta nel parser:** l'iframe SCT presenta una prima coppia di intestazioni `ACCEPTANCE DRY / REEF` prima di `STATUS`, e un'altra coppia finale operativa dopo `STATUS`. La funzione `sctHeader()` in `cloudflare/monitor.mjs` usava `indexOf`, selezionando la prima coppia e rifiutando la tabella. Il parser Python `scripts/fetch_sct.py` già selezionava l'ultima coppia.

**Correzione:** `lastIndexOf` sulle colonne finali DRY/REEF, con supporto `ACCEPTANCE REEFER`; test di regressione sulla tabella di 14 colonne in `tests/cloudflare_monitor.test.mjs`, e trigger QA Cloudflare anche per pull request.

**GitHub:** PR #12 `https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/12`, unita a `main` con commit `77354d297cb052ca5fa522aa97df13b863242e28`. Workflow QA Cloudflare PR run `41417952959`: **success**, sintassi/test e dry-run Wrangler superati.

**Cloudflare:** versione `cc72577d-d2a3-4fd3-87b5-f92e5eab7ce0` distribuita il 2 novembre 2026 alle **09:09:34 UTC**, deployment `d632dc92-dd89-478a-a711-59c5006a25a1`, traffico 100%; mantenuti binding `SCHEDULES_KV` e cron `*/15 * * * *`. Nessuna modifica ai booking o ai terminal CNT/TFG.

**Verifica ancora aperta:** il ciclo del monitor delle **09:00:16 UTC** era precedente al deploy e mostrava ancora `SCT_NO_VALID_ROWS`, quindi non vale come prova del nuovo parser. Osservare il **primo cron successivo** al deploy e controllare che SCT cambi da `fallback` a `ok`, con `monitor_origin=cloudflare_official_read` e una nuova `acquired_at`. Se persiste `SCT_NO_VALID_ROWS`, la risposta HTML ricevuta da Cloudflare potrebbe essere differente o filtrata dalla fonte: non forzare falsi dati live e mantenere fallback Github con timestamp originario.

**Ripristino diretto KV del 2 novembre:** la copia SCT verificata da GitHub (`data/sct.json`, acquisita `2026-11-02T09:11:22.365268+00:00`, **25 viaggi**) è stata trasferita nel solo `schedule:sct` di Workers KV perché lo snapshot presente risaliva alle `06:27:37 UTC` (24 viaggi). Il valore in KV conserva esattamente `acquired_at`, `source_updated_at:null` e `monitor_origin:github_verified_fallback`, con `live:false` e `booking_verified:false`. Nessuna falsificazione del timestamp o dell'origine; CNT/TFG e cron invariati. **Collaudo in produzione superato:** il cron successivo al deployment (2 novembre 2026 alle `09:15:16.730 UTC`) ha acquisito **25 viaggi SCT direttamente dalla fonte ufficiale** tramite il Worker aggiornato: `schedule:sct.monitor_origin=cloudflare_official_read`, `schedule:sct.acquired_at=2026-11-02T09:15:16.730Z`, `status:sct.state=ok`, `last_error_code=null`, `last_success_at=2026-11-02T09:15:16.730Z`. Verificati il binding KV e il cron ogni 15 minuti. La correzione del parser è confermata dai test e dal primo ciclo reale, non soltanto dal ripristino manuale.

## TFG v0.62 — pubblicazione invariata e lettura riuscita (2 novembre 2026)

- **Regola confermata dal proprietario:** TFG cambia data di pubblicazione soltanto quando modifica navi/programmi. L'età di `source_updated_at` non rende automaticamente obsoleta una nuova lettura ufficiale riuscita.
- **Frontend:** `tfg_schedule.mjs` e `delivery_location.mjs` richiedono acquisizione diretta recente (entro 90 minuti) e timestamp validi/non futuri, senza scadenza di 48h della pubblicazione. Nave chiusa, non accettazione, cut-off generale scaduto e data apertura futura restano prioritarie. Copie senza lettura diretta non danno verde. `app.js`, `driver-ui.css`, `index.html`: data della fonte e data della lettura distinte, avviso evidente sui luoghi non riconfermati, nome terminal invariato. Versione `v0.62`.
- **Cloudflare:** `cloudflare/monitor.mjs` non classifica più `source_stale` per la sola vecchia data di pubblicazione; mantiene controlli sui timestamp invalidi e sulle acquisizioni scadute. Cron e KV invariati.
- **GitHub:** PR **#13** `https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/13` unita a `main` il 2 novembre 2026, commit merge **`30bf85cbf189bfc3f07adee2da6d163a8a2b7c55`**. QA PR Cloudflare **`41421315541`** conclusa `success`; QA browser Chromium Android **`41421315290`** conclusa `success` (include suite Node unit).
- **Cloudflare produzione:** versione Worker **`b3101379-3bf9-4499-a8e9-2810a89ab8fd`**, deployment **`24948f2e-4e1f-44b2-8e75-470d3ecc9fff`**, traffico **100%**, installato **2026-11-02 09:34:17 UTC**. Cron `*/15 * * * *`, binding `SCHEDULES_KV` mantenuti.
- **Limiti della verifica:** le richieste browser dirette ai domini pubblici non erano accessibili dal browser di controllo di questa sessione. GitHub `main` e deployment Cloudflare risultano corretti tramite API dei rispettivi account, ma non vanno spacciati per una sessione completa sul telefono Android. Il valore `status:tfg=source_stale` letto alle 09:34 UTC era stato scritto dal **cron delle 09:30 UTC precedente al deploy**: richiedere conferma del prossimo ciclo cron, previsto alle 09:45 UTC. Non riscrivere artificialmente timestamp o stato.

## Cloudflare v0.63 — protezione rate limit nativa (2 novembre 2026)

- **GitHub:** PR **#14** `https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/14`, integrata su `main` (commit `17315aa28e08d46ec7a8f748c5d09f2d820d8a61`). Frontend `v0.63`, cache-buster `app.js` e modulo booking aggiornati.
- **Codice:** `cloudflare/rate_limit.mjs` protegge `POST /api/tfg_booking` e `GET /api/tfg` con contatori nativi, per client e per sede Cloudflare. Prima di chiamare l'upstream usa `CF-Connecting-IP` gestito da Cloudflare, mai `X-Forwarded-For`; risposte 429 `RATE_LIMITED`, `Retry-After:60`, `no-store`, senza booking o identificatori in KV/log. L'assenza o il fallimento dei binding in produzione blocca queste sole rotte con 503. Frontend: mostra `TROPPE RICHIESTE` senza ritentare in automatico.
- **Soglie native (per 60 s):** `BOOKING_CLIENT_LIMIT=20`, `BOOKING_GLOBAL_LIMIT=180`, `TFG_CLIENT_LIMIT=45`, `TFG_GLOBAL_LIMIT=300`. Le soglie globali sono **per località Cloudflare**, non un limite globale rigoroso: contatori approssimativi e IP condivisi su reti mobili sono limiti noti.
- **Collaudo:** workflow QA Cloudflare run `41423040358` **success**; QA Chromium Android run `41423040380` **success**. Nuovo test `tests/cloudflare_rate_limit.test.mjs`, coverage 429/503, privacy booking e spoofing XFF.
- **Cloudflare produzione:** Worker versione `4d7fbd0e-3e14-4ec1-9c10-197e8c8fd5a8`, deployment `d488e264-2e1c-4437-9780-903d7cdc6f19`, traffico **100%**, installata il **2026-11-02 09:48:15 UTC**. Connettore account conferma tutti i 4 binding `ratelimit`, `SCHEDULES_KV` e cron `*/15 * * * *`.
- **Verifica residua:** dall'ambiente di controllo il GET HTTP pubblico del Worker `/api/health` e `/api/monitor/status` non è accessibile; **non dichiarare eseguito un test live di 429**. Confermare disponibilità delle rotte senza booking reali e prossimi cicli del monitor. Non eseguire stress test pubblici né richiedere booking reali per validare il rate limiter.
- **Limiti:** CORS non è autenticazione, la rate limiting nativa non è un limite mondiale rigoroso, e non fornisce certezza assoluta contro attacchi distribuiti. Non sono stati aggiunti Durable Objects o altri servizi backend; controllare gli effettivi limiti di quota/consumo del piano Cloudflare se aumentano le richieste.

## CNT v0.64 — incrocio booking/nave più prudente (2 novembre 2026)

- **GitHub:** PR #15 `https://github.com/pasqualemilano0-rgb/container-booking-web-/pull/15` integrata in `main` con merge commit `606fefc4e24bbff975ebb8f99afb0d7e1525eea1`.
- **Correzione ETA:** `conateco_booking.mjs` rifiuta ora ETA testuali con suffissi arbitrari, ore/minuti/secondi impossibili. Il confronto avviene su nave e giorno ETA solo se entrambi sono interpretati correttamente.
- **Abbinamento prudente:** se il Berth Forecast non ha un identificativo viaggio leggibile, la riga è conflittuale o esistono più righe con stessa nave/giorno ETA, il viaggio resta **non verificato**. Il solo nome nave univoco continua a permettere l'indicazione di **stato nave** (secondo requisito utente), mai il viaggio del booking.
- **UI:** `app.js` mostra subito nel riquadro principale, anche a dettagli chiusi, `⚠ VIAGGIO DEL BOOKING NON CONFERMATO` quando la selezione è basata sul solo nome. Stile `driver-ui.css`. `index.html` v0.64 con cache-buster aggiornati.
- **QA:** workflow Chromium Android PR #15 run `41424499049`: **success**. Include `node --test tests/*.test.mjs` **success** e test browser CNT/TFG/SCT. Nuovi test unitari in `tests/conateco_booking.test.mjs`, assert visivi in `tests/qa_booking_search.cjs`.
- **Produzione:** modifica esclusivamente frontend GitHub Pages; **non** richiede deploy Cloudflare e non altera Worker, KV o cron. GitHub `main` verificato con v0.64. L'URL GitHub Pages non è raggiungibile dall'ambiente di controllo per una verifica HTTP end-to-end: non dichiarare che la pagina pubblica sia stata certificata al 100%, né che vi sia stato un test su Android fisico.

## Architettura richiesta dal proprietario

**GitHub Pages per il frontend, Cloudflare come unico backend.** Sono rimossi il vecchio adattatore server Python, la configurazione di hosting e i relativi test. Gli script Python di raccolta ufficiale rimangono necessari a GitHub Actions.

| Parte | Ubicazione |
| --- | --- |
| Repository | `pasqualemilano0-rgb/container-booking-web-`, branch `main` |
| Sito | https://pasqualemilano0-rgb.github.io/container-booking-web-/ |
| Backend | https://container-booking-backend.pasqualemilano0.workers.dev |
| Stato monitor | `/api/monitor/status` |
| Cron installato | `*/15 * * * *` in UTC, H24 |
| Archivio | `SCHEDULES_KV`, namespace `0f3ce70b4e934cb3b8d78083a2ef5f23` |

Il proprietario richiede esattamente CNT e TFG a Napoli, SCT a Salerno; interfaccia compatta su Android, automazione senza PC acceso, niente nuovi terminali o servizi a pagamento non richiesti.

## Flussi da conservare

- **CNT:** browser → Booking Export ufficiale → nome nave → stato di accettazione dal Berth Forecast. Richiedere HTTP/JSON valido e nome nave verificabile; non imporre `ReturnCode=0`. Il JavaScript ufficiale legge direttamente `B_NOMNAVE` e `B_ETA` senza controllare quel codice. Se presente e non nullo il codice deve comunque avere un tipo numerico intero sicuro; un negativo resta errore per prudenza. Per stato e opzioni della nave usare prima l'eventuale match ETA, altrimenti l'unica riga corrente con nome esatto normalizzato; con più candidati restare da verificare. Per richiesta esplicita del proprietario, depot esterni «OK» (`accettazioneesterni=S`) mostra **INTERNO PORTO / DRYPORT** nella nuova grafica condivisa con TFG. Per attribuire viaggio e destinazione del booking restano necessari stesso giorno ETA e un'unica riga. Le opzioni restano della nave, mai autorizzazione del booking.
- **TFG booking:** browser → `POST /api/tfg_booking` Cloudflare → form ufficiale TFG (`modo=2`, `bkk`). Il Worker restituisce `found`, `not_found` o `unverified`; sempre `booking_authorized:false`. Il risultato positivo significa soltanto nave/viaggio riconosciuti.
- **TFG programma:** `/api/tfg` per lettura diretta; `/api/tfg/snapshot` e copie GitHub se necessario. Il luogo proviene soltanto da `TERMINAL DI CONSEGNA`, con match nave e viaggio di partenza; non da parole arbitrarie nel booking.
- **SCT:** ricerca nave, viaggi distinti e Dry/Reefer separati. Il portale può bloccare Cloudflare: il monitor importa allora lo snapshot GitHub verificato e ne conserva l'acquisizione originale, con `github_verified_fallback`.

Nessun booking reale nei test, URL GET del backend, file JSON, KV o log. Non disabilitare TLS e non aggirare login/CAPTCHA. Le fonti e gli orari devono restare espliciti; un'acquisizione recente non implica pubblicazione recente. Nessun esito dell'app autorizza ingresso o consegna.

## Mappa del codice

- `index.html`, `app.js`, `driver-ui.*`, `auto-update.mjs`: frontend statico, selezione porto/terminale e aggiornamento sicuro.
- `tfg_booking.mjs`, `conateco_booking.mjs`, `booking_search.mjs`: client e validazione booking.
- `cloudflare/index.mjs`: rotte HTTP e handler programmato.
- `cloudflare/tfg_booking.mjs`: richiesta TFG, limiti effettivi 512 byte JSON/100 kB HTML, timeout, decodifica ISO-8859-1 e parser HTMLRewriter prudente.
- `cloudflare/monitor.mjs`, `cloudflare/parse_tfg.mjs`, `cloudflare/wrangler.jsonc`: raccolta programmi, KV, cron e parser.
- `rules.mjs`, `tfg_schedule.mjs`, `conateco_rules.mjs`, `delivery_location.mjs`: freschezza, chiusure e regole operative.
- `scripts/fetch_*.py`, `scripts/publish_snapshots.py`, `data/*.json`: raccolta GitHub e pubblicazione senza regressione dei timestamp.
- `tests/cloudflare_tfg_booking.test.mjs`: casi positivi sintetici, negativi, input errati, HTML nascosto, limiti, origine, errori e privacy.

## Rilascio v0.61 distribuito — CONATECO: INTERNO PORTO / DRYPORT

Richiesta del proprietario: applicare anche a CONATECO la grafica di consegna TFG; quando i depot esterni sono «OK», il container può essere scaricato sia **INTERNO PORTO** che **DRYPORT**. Alla ripresa del 2 novembre il testo è **INTERNO PORTO / DRYPORT**. La regola visualizza entrambe le opzioni senza selezionarne una. Il risultato CNT mostra nave grande, stato nave separato e riquadro navy «OPZIONI DI CONSEGNA · NAVE», con «DEPOT ESTERNI: OK» e fonte/date/note nei dettagli nativi inizialmente chiusi.

Il riquadro usa la stessa riga corrente univoca selezionata per lo stato della nave. Un'ETA assente o discordante non nasconde le opzioni della nave; il viaggio del booking resta non verificato. Dati oltre 45 minuti, contraddittori, ambigui o nave chiusa non producono le due opzioni nella ricerca booking. L'helper conserva `known:false` e `scope:vessel`; nessuna autorizzazione o deposito specifico viene ricavato dal booking. `N`/vuoto conservano la precedente indicazione presunta di INTERNO PORTO, senza promuoverla a conferma.

Verifica locale: **163 test JavaScript e 78 Python**, otto suite Chromium con fixture: booking 320/390/432/768 px con dodici richieste CNT sintetiche esplicite, liste 320–1280 px, dati vecchi 320/390/432 px, failover/accettazione TFG, archivio CNT, SCT e aggiornamenti concorrenti. Controllati fonte apribile, doppia opzione, mismatch ETA, nave chiusa, ambiguità, privacy e regressioni TFG. Preview esclusivamente sintetica, review indipendente senza blocchi. Corretto il pannello fonte che si richiudeva al controllo automatico: a 31 secondi apertura, focus e nodo invariato restano conservati. Alla ripresa, **23 test mirati** e le tre suite booking/liste/dati vecchi sono nuovamente passati con la dicitura finale con barra e la regressione clock/focus.

Codice **`f80e51e5b346e6507a90b4193cd2359f2e0de7cb`**, fix apertura/focus **`15306b4a7370682756a2b702b997254bcbe33419`**, dicitura finale **`5986303c4fd6ee5da38a1130feddf73598b5b48e`**. PR **#11**, merge **`1cbf973ec8ca5d21534109a2d93b961b159528e2`**. CI Node/Python **`41387909520` success**, con 163 JS e 78 Python; Chromium **`41387909515` success**, incluse le otto suite con fixture e la navigazione pubblica. Pages **`41387943105` success** sullo snapshot successivo **`78d849ed2a9dc42c09b97a09c6401f3320936729`**, che conserva le modifiche ai programmi automatici. La prima build Pages sul merge è stata sostituita da quella dello snapshot.

Verifica pubblica **2 novembre 2026, 04:21 UTC**: HTTP 200, v0.61, `index.html`, JavaScript, helper consegna e CSS identici ai file collaudati. Browser pubblico a 390 px, programma CNT reale senza booking: una riga con depot esterni OK mostra **INTERNO PORTO / DRYPORT**, `scope=vessel`, entrambe le scelte e fonte apribile/richiudibile. Nessun overflow, eccezione o richiesta booking. Passata anche la navigazione pubblica tra CNT, TFG e SCT; i risultati booking di questa tranche sono verificati con fixture sintetiche, non dichiarati come nuove prove positive reali.

Backend invariato, verificato il **2 novembre alle 04:19:34 UTC**: versione Worker **`5ca96100-81ee-424b-96a4-fb5ece79f947`**, deployment **`73ef4861-a230-4aa5-96cd-c801c773b79f`**, traffico 100%, cron `*/15 * * * *`, binding corretto e sei chiavi KV. Ciclo **04:15:16.909 UTC**: CNT `ok` (36), TFG `stale` (20, pubblicazione ancora 31/10 11:40:26 UTC), SCT `stale` (24, copia acquisita 01/11 23:58:13.207880 UTC, `SCT_NO_VALID_ROWS`). Non confondere l'esecuzione regolare del monitor con una nuova pubblicazione del terminal. Il server locale di QA è stato arrestato a fine verifica.

## Rilascio v0.60 distribuito — luogo TFG senza suffisso e nuova grafica del risultato

Il proprietario richiede di lasciare solo **INTERNO PORTO**, togliere il suffisso di riconferma e cambiare la grafica. Il valore TFG ora è sempre il nome canonico della colonna ufficiale, senza suffissi anche quando la pubblicazione è precedente. `known` e i controlli di freschezza restano invariati: metadata di fonte, date e note si consultano nel pannello nativo «Fonte e aggiornamento», inizialmente chiuso. Il valore mancante/non interpretabile resta `LUOGO DA VERIFICARE`. Nessun dato ricavato da booking, note arbitrarie o segnalazioni CNT.

Nuovo risultato TFG: nome nave grande, viaggio in una pill, stato nave e riquadro navy con pin decorativo per il terminal. Le informazioni dettagliate del booking si aprono separatamente. Fonte, acquisizione, pubblicazione e nota di validità restano nel DOM e consultabili; il solo testo del luogo non viene promosso a conferma del booking. Stessa presentazione del nome del luogo nei chip delle liste. CNT e relativi avvisi restano invariati.

Lavorazione `tfg-delivery-design`, iniziato su `de897f8081e5d6897ab3699288ea928cdeb629a0` e ripreso il 1 novembre alle 23:15 UTC sulla base aggiornata `5938869452346328f1b606474b850d1901af32bb` (solo snapshot bot). Versione/cache-buster v0.60. **161 test JavaScript e 78 Python superati**; QA Chromium booking a **320/390/432/768 px**, accettazione TFG a 390 px e dati vecchi a **320/390/432 px**, tutte superate. Verificati luogo esatto, fonte/date/note conservate e dettagli chiusi/apribili; CNT, 11 ricerche CNT esplicite e 3 POST TFG con privacy invariati. Preview sintetica a 390 px ispezionata; review indipendente con contrasto del valore 13,91:1, summary da 44 px e nessun overflow. Corretta anche la disposizione di badge lunghi a 320 px. Nessun booking o risultato reale aggiunto a codice, fixture o file. Backend `5ca96100-81ee-424b-96a4-fb5ece79f947`, cron ogni 15 minuti e sei chiavi KV confermati. Il ciclo 23:15:16.643 UTC riporta CNT `ok` (36), TFG `stale` (20), SCT `stale` (24, riserva GitHub).

Codice **`1faaeb0cdeb917584a7d58934e4722e066f89ff2`** e fix dei badge **`bce3539bd4c7ca0b602df853d3b605769481a6f4`**, PR **#10**, merge **`7325ec9343f0bafedc15f4d8c35b2e0e1518e854`**. Test di navigazione generale aggiornato nel commit **`214aecdc5088951029667dbfd36e1e60002c1a11`** per verificare la nota nella nuova posizione chiusa/aperta/richiusa, con cinque viewport 320–1280 px. CI finale **Node/Python `41362105479` success**, **Chromium `41362105446` success**; Pages **`41362130828` success** sul successivo snapshot **`37f4119cf5f626cdf0c08c297cc98b61e81d4502`**.

Verifica pubblica del 1 novembre, 23:23–23:29 UTC: HTTP 200, v0.60, JavaScript/helper consegna/CSS identici ai sorgenti collaudati. Prova manuale nel browser pubblico a 390 px con il booking già autorizzato dal proprietario: risultato trovato, valore esatto `INTERNO PORTO`, nuova scheda navy e stato `ACCETTA CARICO` verde. Fonte inizialmente chiusa, apribile e richiudibile, entrambe le date presenti; dettagli booking separati. Un solo POST booking, zero identificativi nella query string, zero eccezioni e overflow. Nessun identificativo, nave/viaggio, screenshot o payload del risultato reale salvato nei file o nei test. Il server locale di QA è stato arrestato a fine verifica.

## Rilascio v0.59 distribuito — TFG «ACCETTA CARICO» verde nella finestra di 48 ore

Il proprietario richiede di togliere «ACCETTA CARICO · DATO VECCHIO» e conservare il verde, spiegando che TFG aggiorna il programma ogni 24–48 ore oppure quando cambia. La policy frontend ora usa una finestra di pubblicazione **48 ore inclusive** con lettura diretta riuscita acquisita entro 90 minuti. L'etichetta positiva è esattamente **ACCETTA CARICO**. La tolleranza preesistente di 5 minuti sugli orologi è conservata; data mancante/illeggibile, futura oltre tale tolleranza o oltre 48 ore richiede riconferma, senza il vecchio suffisso. Date reali di fonte e acquisizione restano consultabili; la frequenza indicata è un requisito del proprietario, non una garanzia del terminal.

La finestra condivisa vale anche per valutare «CARICO DAL», mantenendone le etichette specifiche. Chiusure, NON ACCETTA CARICO e cut-off generale scaduto prevalgono; errore di lettura, sole riserve e acquisizioni non recenti non diventano verdi. `isTfgFeedFresh` e la regola di freschezza del luogo rimangono 90 minuti: questa modifica riguarda lo stato nave, non il terminal di consegna o l'autorizzazione del booking. Backend, monitor e cron non modificati.

Lavorazione `tfg-48h-acceptance`, base `ce65a297123b6adf7feb601c94e5b2a3b3dceb94`; versione/cache-buster v0.59. Nessun booking o risultato reale aggiunto a codice o fixture. **159 test JavaScript e 78 Python superati**, inclusi 30h, 47h59m, 48h esatte e 48h+1ms, metadati di data invalidi, lettura vecchia/fallita e precedenza chiusure/cut-off. QA Chromium: stato verde TFG con fonte di 30 ore a 390 px, booking a 320/390/432/768 px, luogo ancora da riconfermare, CNT e privacy invariati; fallback 503 verificato senza badge verde. Review indipendente completata. Backend `5ca96100-81ee-424b-96a4-fb5ece79f947`, cron e sei chiavi KV confermati invariati. Ciclo delle 18:00:17.021 UTC: CNT `ok` (37), TFG `stale` (20, metadato del monitor distinto dalla policy del badge), SCT `fallback` (24).

Codice **`ed5476b1b63c348708a3893dd4ff175638f94b55`**, PR **#9**, merge **`17f96bb4fd5a48bc2e2d3499682bc7222fd94837`**. CI **Node/Python `41335400356` success**, **Chromium `41335400280` success**. Pages **`41335430656` success** sul successivo snapshot **`e0ad980baf36c55d1de101e40005aa211af1a5b5`**. Verifica pubblica delle 18:14 UTC: HTTP 200, v0.59, JavaScript e modulo TFG identici ai sorgenti collaudati. Prova manuale nel browser pubblico a 390 px con il booking già autorizzato dal proprietario: risultato trovato, etichetta esatta `ACCETTA CARICO`, classe `result-label good`, suffisso precedente assente; luogo ancora da riconfermare. Un solo POST booking, zero identificativi nella query string, zero eccezioni e overflow. Nessun numero, nave/viaggio, screenshot o payload del risultato reale salvato in file/test/KV.

## Collaudo positivo reale TFG — 1 novembre 2026, 18:00–18:01 UTC

Su richiesta esplicita del proprietario è stato provato manualmente un booking reale, senza salvarne identificativo o risultato nei file, nei test, in KV o negli URL. La chiamata POST JSON al Worker ha restituito HTTP 200 `found`, nave e viaggio. Il programma ufficiale letto nello stesso momento ha fornito una corrispondenza univoca per nave compatibile e viaggio di partenza.

La verifica è stata ripetuta nel browser pubblico GitHub Pages **v0.58** a 390 px: **Pages → POST Cloudflare → modulo TFG → nave/viaggio → programma**. Mostrati correttamente `DATI BOOKING RILEVATI`, accettazione del booking `NON CONFERMATA`, stato nave con indicazione di dato vecchio e luogo `DA RICONFERMARE`: il programma riporta pubblicazione **2026-10-31T11:40:26Z**, pur acquisita il 1 novembre alle 18:00 UTC. Zero eccezioni, zero overflow e nessun booking nella query string; la singola ricerca browser ha effettuato un solo POST booking. Nessuno screenshot o fixture del risultato reale è stato conservato.

Questo completa il primo caso positivo reale del parser TFG e del percorso pubblico; la QA automatica continua a usare esclusivamente dati sintetici. La verifica non autorizza il singolo booking né l'ingresso. Backend ancora versione `5ca96100-81ee-424b-96a4-fb5ece79f947`, cron ogni 15 minuti e sei chiavi KV confermati; nessuna modifica al codice o al deployment in questa tranche.

## Rilascio v0.58 distribuito — risposta Booking Export senza requisito artificiale ReturnCode zero

Uno screenshot del proprietario mostra «Codice inatteso del terminal», che impedisce di proseguire da booking a nave. L'assunzione `ReturnCode=0` delle versioni precedenti era supportata soltanto dalle fixture, non dal contratto del portale. Il messaggio da solo non prova il segno o il valore del codice ricevuto: veniva usato anche come fallback per un negativo senza messaggio.

Prova ufficiale recuperata dai log storici: [run 41229392583, job 124620192346](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41229392583/job/124620192346), step 5, HTML HTTPS di 18.332 byte acquisito il 31 ottobre alle 18:26 UTC. Il gestore Vue `getDataContainer` imposta `vm.risultato="OK"`, `vm.eta=response.data.B_ETA` e `vm.nave=response.data.B_NOMNAVE` nel ramo `.then`; `.catch` imposta `KO`. Non legge `ReturnCode` né `ReturnMessage`. Lo stesso gestore è confermato dal [run 41193792518, job 124515770818](https://github.com/pasqualemilano0-rgb/container-booking-web-/actions/runs/41193792518/job/124515770818) delle 10:42 UTC. Nessuna evidenza che 0, 1 o un altro positivo costituiscano un particolare codice di successo. Il caso negativo registrato dalla diagnostica ha codice -1 e campi dati nulli. L'HTML odierno rimane non raggiungibile da questo ambiente per errore TLS upstream: sono prove storiche esplicite, non una nuova lettura live.

Il parser ora usa un nome nave valido come requisito essenziale, senza il vincolo allo zero. `ReturnCode` può mancare o essere nullo; se valorizzato resta soggetto ai controlli di tipo/intero sicuro. Un negativo continua a essere rifiutato anche con nave popolata per prudenza. Un codice non negativo, da solo, non produce mai una nave né conferma accettazione o destinazione. Se un negativo manca di messaggio, l'errore mostra il codice non sensibile. Le fixture browser usano 1 come semplice valore sintetico prima rifiutato, senza dichiararlo un contratto numerico ufficiale.

Lavorazione `cnt-response-contract`, base `5590b6be70386c8dcde8c08269433d5747f747d6`, frontend/cache-buster v0.58. Backend, cron, matcher nave e regole di accettazione restano invariati. Nessun dato reale aggiunto a test o file. Review indipendente completata: esclusi anche placeholder esatti come `UNKNOWN` e `NON DISPONIBILE`, senza modificare il normalizzatore globale. **155 test JavaScript e 78 Python superati**; QA Chromium booking a **320/390/432/768 px** con 11 ricerche CNT esplicite: metadato positivo nonzero + nave valida → nome/stato; positivo senza nave → non confermato; negativo senza messaggio → codice visibile. Refresh programmi senza reinvio booking, TFG e privacy invariati. Controllo infrastruttura conferma Worker `5ca96100-81ee-424b-96a4-fb5ece79f947`, cron ogni 15 minuti e sei chiavi KV; il ciclo delle 17:30:16.723 UTC ha CNT `ok` (37), TFG `stale` (20), SCT `stale` (24, copia GitHub).

Codice **`f3c00007ec5673e4aa1c92bc520a24befb301ca4`**, PR **#8**, merge **`237bc573f96bd992d0e0840b358cafc7b9bb8371`**. CI **Node/Python `41333272895` success**, **Chromium `41333272901` success**. Pages **`41333303102` success** sul successivo snapshot **`4c623b94b29eba3283368b1066c102ae34737fc6`**. Verifica pubblica delle 17:49 UTC: HTTP 200, v0.58, `app.js` e modulo CNT identici al codice collaudato; browser pubblico 390 px senza overflow/eccezioni. Ripetuta sul frontend realmente distribuito l'intera QA booking a 320/390/432/768 px con le risposte dei servizi simulate, compresi metadato nonzero e percorso nave→stato carico: tutti i casi superati. Il booking reale non è stato riprovato da questo ambiente a causa del problema TLS upstream; non dichiararne la verifica live.

## Rilascio v0.57 distribuito — booking CNT → nave → accettazione dal Berth Forecast

Il proprietario richiede ora che la ricerca booking mostri subito **nome nave e stato accetta carico** dal programma pubblico. Il nuovo `matchConatecoVesselToForecast` è distinto dal matcher rigoroso per viaggio/destinazione: prima conserva match e ambiguità ETA, altrimenti cerca il nome esatto normalizzato e una sola riga corrente, preferendola agli archivi. Due righe correnti possibili, anche sconosciute o contraddittorie, restano ambigue. Una riga storica esattamente identificata non viene sostituita con una nuova favorevole. Nessun fuzzy matching.

La scheda di stato nave è visibile fuori dai dettagli. Usa `evaluateConateco`: vecchie acquisizioni, blocchi, chiusure, dati mancanti o contraddizioni non diventano verdi. Mostra fonte, origine della copia e acquisizione. Il solo nome non certifica il viaggio o la destinazione del booking. ETA e dettagli restano secondari.

Nuove copie pubbliche aggiornano anche il risultato aperto, senza nuove chiamate booking; il timer locale di 30 secondi rivaluta età e cut-off. I callback rispettano sequenza della ricerca, terminal e presenza della scheda; cancellazione/navigazione annullano il ciclo e copie più vecchie non fanno regredire il risultato. Aprire una scheda CNT cancella la ricerca precedente: la review ha riprodotto e corretto una risposta ritardata che sovrascriveva la nave scelta. Timeout di 7 secondi su tutte le fonti CNT, comprese le riserve, per evitare attese indefinite.

Endpoint individuati nell'integrazione: `GET https://api.conateco.it/ConatecoServicesApi/Booking?id_booking=CODICE_BOOKING` (`ReturnCode`, `B_NOMNAVE`, `B_ETA`) e `GET https://api.conateco.it/ConatecoServicesApi/BerthForecast`. Verifica diretta del 1 novembre 2026: entrambi restituiscono HTTP 503 da questo ambiente; anche il lettore web non accede al portale. Nessuna disabilitazione TLS né booking reale nei test. La fonte pubblica è invece acquisita dal Worker: ciclo **17:15:16.898 UTC**, CNT `ok` 37, TFG `stale` 20, SCT `stale` 24 (riserva GitHub acquisita 16:28:39 UTC). Worker, cron e sei chiavi KV confermati invariati.

Lavorazione `cnt-booking-acceptance`, base iniziale `987a6be3b4b5b33500035bd5a1390a1da38728c5`; preservare gli snapshot bot successivi. **151 test JavaScript e 78 Python superati**, QA Chromium booking a 320/390/432/768 px con fixture positive/negative, ETA discordante/mancante, nave assente, ambiguità, copie vecchie e fonti assenti; stato subito visibile, TFG e privacy invariati. Verificati aggiornamento positivo→negativo→positivo senza nuove chiamate booking e senza duplicare dettagli; prova aggiuntiva a 390 px con orologio simulato: dopo 46 minuti la stessa acquisizione diventa `DATI DA AGGIORNARE`, senza cambiarne il timestamp. Preview a 390 px ispezionata. Review indipendente matcher e race di navigazione completata.

Codice **`7086850ca4d7addbae37dda60400a4bfe23ba102`**, PR **#7**, merge **`044f5b79e0d8d1304e44a2160b20ad0f0a01e2b0`**. CI **Node/Python `41332175858` success**, **Chromium `41332175915` success**. Pages **`41332201950` success** sul successivo snapshot **`fac0e357a9c95478b7e53cc16f8564b1f4d11bde`**. Verifica pubblica delle 17:36 UTC: HTTP 200, v0.57, JavaScript/modulo CNT/CSS identici ai sorgenti collaudati. Browser pubblico a 390 px senza overflow/eccezioni; ripetuta sul frontend realmente servito anche la QA booking a 320/390/432/768 px con le sole risposte dei servizi simulate, inclusi i cambi di stato senza reinvio del booking. Tutti i casi superati. Nessuna prova di booking reale dichiarata: l'API diretta resta non raggiungibile da questo ambiente.

## Rilascio v0.56 distribuito — nome nave CNT in primo piano

Il proprietario ha chiarito che gli interessa il **nome nave associato al booking**, non l'ETA. Il risultato CNT ora presenta una scheda con il nome nave in evidenza. ETA, messaggio del terminal, accettazione non verificata e contesto Berth Forecast si consultano in «Dettagli del terminal», inizialmente chiusi. Il nome nave resta visibile anche con ETA mancante o discordante. Aggiornata anche la preferenza permanente in `docs/LINEE_GUIDA_TECNICHE.md`.

Modifica solo frontend, lavorazione `cnt-vessel-first`, base `91601aa15873cd0fd325246c6713605a2780493d`; versione e cache-buster v0.56. Parser, criteri di abbinamento, TFG, SCT, backend Cloudflare e cron invariati. Nessun booking o risultato reale aggiunto al repository. **145 test JavaScript e 78 Python superati**; QA Chromium booking a **320/390/432/768 px** con fixture sintetiche: nome subito visibile, dettagli chiusi inizialmente e riapribili, ETA valida/mancante/discordante, TFG e privacy invariati. Preview a 390 px ispezionata senza overflow.

Codice **`6811c315929dd9dc14568128dc365fc3acccd2f2`**, PR **#6**, merge **`d1142852822345f76c3db148a89d12250f80f5a1`**. CI **Node/Python `41330248268` success**, **Chromium `41330248243` success**. Pages **`41330279274` success** sul successivo snapshot **`d59b0f6e17b86311d9cba68a750cc3c0633a4381`**. Verifica pubblica delle 17:13 UTC: HTTP 200, v0.56, JavaScript e CSS serviti identici ai sorgenti collaudati; browser pubblico 390 px senza overflow/eccezioni. Ripetuta la QA booking sul frontend realmente distribuito a 320/390/432/768 px con sole risposte dei servizi simulate: tutti i casi superati. Nessun booking reale inviato nelle verifiche automatiche.

Controllo infrastruttura del 1 novembre 2026: versione Worker `5ca96100-81ee-424b-96a4-fb5ece79f947` al 100%, cron ogni 15 minuti e sei chiavi KV. Ciclo **17:00:17.014 UTC**: CNT `ok` (37), TFG `stale` (20), SCT `fallback` (24). HTTPS e tutti gli snapshot pubblici verificati.

## Rilascio v0.55 distribuito — ETA compatta CNT

Lavorazione `cnt-compact-eta`, base `d8397e345a55f24d9ec3293b296475781396972c`. Booking Export può pubblicare `B_ETA` come `YYYYMMDDHHmmss`: il client ora valida calendario e orario, mostra `DD/MM/YYYY HH:mm` (con secondi se presenti) e conserva l'orario dichiarato senza conversioni di fuso. Supportati stringa e numero intero sicuro. Un valore compatto invalido resta `Non indicata` e non produce abbinamenti.

Il confronto continua a richiedere nave normalizzata, stesso giorno ETA e un'unica riga. Nessuna tolleranza di un giorno: se booking e programma divergono, il luogo resta da verificare. Lo screenshot fornito dal proprietario dimostra il formato del portale, non una risposta API acquisita da questo ambiente: il collegamento a Booking Export ha incontrato un errore TLS upstream, senza disabilitare le verifiche. Nessun booking o risultato reale salvato in repository/test/KV.

Verifiche locali del 1 novembre 2026: **145 test JavaScript e 78 Python superati**; QA Chromium booking a **320/390/432/768 px** con fixture sintetiche (ETA compatta leggibile, match unico e data discordante senza luogo). Review indipendente senza blocchi. Versione frontend/cache-buster `v0.55`; backend e cron non modificati.

Codice nel commit **`494ae28067474d7a1669a49e188bb290ea954381`**, PR **#5** integrata con merge **`dd0fdd31f3cbc32136cb92f252f591362108ed11`**. GitHub Actions **Node/Python `41312065111` success**, **Chromium `41312065194` success**. Pages **`41312089018` success** sullo snapshot bot successivo **`426b6d7e180c97f14cf06f2bab903376ef6f8a0c`**. Verifica pubblica delle 13:37 UTC: HTTP 200, frontend v0.55, `app.js` e `conateco_booking.mjs` distribuiti identici ai sorgenti collaudati; browser pubblico a 390 px senza overflow/eccezioni. Ripetuta sul codice realmente servito da Pages anche la QA booking a 320/390/432/768 px, mantenendo simulate soltanto le risposte dei servizi: ETA compatta, mismatch e privacy tutti superati. Nessuna verifica automatica ha inviato booking reali.

Controllo infrastruttura delle 13:35 UTC: Worker ancora versione `5ca96100-81ee-424b-96a4-fb5ece79f947`, traffico 100%, cron ogni 15 minuti e sei chiavi KV. Il ciclo delle **13:30:17.207 UTC** riporta CNT `ok` (37), TFG `stale` (20) e SCT `fallback` (24). Il programma pubblico CNT è consultabile; una lettura del programma non conferma il singolo booking.

## Rilascio v0.54 distribuito — GitHub Pages + Cloudflare

Lavorazione `github-cloudflare-backend`, base iniziale `ebb808307cfb190098771d714332c5939cf38cf7`; i nuovi commit dati su main vanno conservati. La v0.54 migra completamente TFG su Cloudflare, rimuove l'integrazione server precedente e incorpora il fix CNT senza risultati della PR #3. Aggiornati versione, cache-buster, markup e QA/CI.

La review ha riprodotto e corretto un caso di nave letta solo da HTML esplicitamente nascosto; il parser esclude tali sottostrutture. Non calcola il CSS esterno come un browser: il caso positivo reale TFG resta da certificare e il parser deve fallire prudentemente in caso di formato sconosciuto.

Codice della migrazione nel commit **`93d5bb4dbdbe0b079e3d211f425c67b6954a325c`**. Verifiche locali: **142 test JavaScript e 78 Python superati**, otto script Chromium su fixture (viewport 320–1280 px), nessun host non previsto; 20 casi aggiuntivi con HTMLRewriter reale per sezioni nascoste anche su `html` e `body`. Bundle Wrangler 4.156.0: 39,11 KiB, gzip 11,63 KiB.

**Backend distribuito il 1 novembre 2026 alle 12:39:35.086722 UTC**, versione `5ca96100-81ee-424b-96a4-fb5ece79f947`, deployment `73ef4861-a230-4aa5-96cd-c801c773b79f`, traffico 100%. Cron e binding conservati; sei chiavi KV presenti. La prova reale `scripts.qa_tfg_booking_live_backend` ha restituito preflight 204 e POST 200 `not_found` con codice sintetico inesistente, senza echo, cache o autorizzazione del booking. La PR **#4** è stata integrata su main nel commit **`52a9f0fc002953b0728a1c1458f306176e3f6e09`**. Pages ha pubblicato **v0.54** con HTTP 200; deploy **`41307712393`** riuscito sul successivo snapshot dati `380a5fc9f9e1d64b0e2ae04395dfa669681823a3`.

Verifica browser pubblica riuscita a 390 px senza overflow o eccezioni: **GitHub Pages v0.54 → POST Cloudflare → modulo ufficiale TFG → `not_found`** per un codice sintetico inesistente. Gli unici host contattati sono Pages, il Worker e raw GitHub. Nessun booking reale utilizzato.

GitHub Actions sul commit di merge: **Chromium `41307686823` success**, **Node/Python e snapshot `41307686957` success**, **QA Worker `41307686918` success**, **API TFG `41307686912` success**, **monitor produzione `41307686909` success**, **booking sintetico `41307686812` success**. Il job deploy Worker `41307686811` è skipped; il Worker è stato realmente pubblicato tramite connessione Cloudflare come indicato sopra.

Il repository non contiene più configurazione, endpoint o documentazione operativa del precedente hosting. **Il proprietario ne ha completato la cancellazione**, verificata il **1 novembre 2026 alle 12:49 UTC**: l'API del progetto restituisce 404 `Project not found` e la ricerca nello stesso team restituisce zero progetti corrispondenti. La dismissione è completata; lo stack operativo è soltanto GitHub Pages + Cloudflare.

Il primo ciclo osservato dopo la migrazione del backend è quello delle **12:45:16.883 UTC**: CNT `ok` (37), TFG `stale` (20, fonte ancora del 31/10) e SCT `fallback` (24, copia GitHub acquisita alle **12:41:39.317615 UTC**). Tutti i terminali hanno nuovo tentativo e successo dopo il rilascio; il cron H24 resta operativo nella nuova versione.

## Monitor H24 già verificato

Rilascio del 1 novembre 2026 alle **07:47:12.203029 UTC**: Worker versione **10**, `c08250ec-74b7-4e3d-8507-4b3dd0f5802f`, deployment `0d054915-836e-461f-a52e-9bc6cf225567`, traffico 100%. Cron e binding conservati.

Il ciclo reale delle **08:00:17.099 UTC** ha prodotto CNT `ok` (37 righe), TFG `stale` (20 righe, fonte del 31/10 alle 11:40:26 UTC) e SCT `fallback` (24 righe). Verifica indipendente delle **08:00:40 UTC**: sei chiavi KV, inclusa `schedule:sct`; tutte le righe SCT e `acquired_at=2026-11-01T07:29:39.044611+00:00` coincidevano con GitHub. È una prova del cron effettivo, non soltanto di una rotta HTTP.

## Verifiche e distribuzione

```bash
python -m pip install -r requirements.txt
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
npx --yes wrangler@4.156.0 deploy --dry-run --config cloudflare/wrangler.jsonc
```

QA browser in `.github/workflows/qa-main-browser.yml`, 320–1280 px con fixture. QA live nei moduli `scripts.qa_tfg_public_backend`, `scripts.qa_tfg_booking_live_backend`, `scripts.qa_cloudflare_monitor_public`. Il controllo booking live usa soltanto un codice sintetico inesistente e non stampa il numero.

Il job Worker richiede `CLOUDFLARE_DEPLOY_ENABLED=true`; può risultare skipped. Il push o una QA verde non dimostrano il deploy: controllare versione installata, cron, binding, API e comportamento. Non cambiare segreti, protezioni, permessi o piani senza richiesta. Preparare ripristino e verificare l'esatto account/progetto prima delle mutazioni.

## Rischi residui

1. Un caso positivo reale TFG verificato manualmente, oltre alle fixture; i cambi di formato del portale possono richiedere nuovi controlli. Nessuna autorizzazione operativa certificata.
2. CORS non autentica client server-to-server; manca una limitazione persistente delle chiamate booking.
3. SCT frontend usa 90 minuti, monitor 45; il frontend non espone gli errori di `/api/monitor/status`. Soglie da allineare separatamente.
4. TFG può mostrare verde nave con lettura diretta recente e pubblicazione entro 48 ore, secondo la policy richiesta dal proprietario. La freschezza del luogo resta distinta a 90 minuti, con testo principale privo di suffissi e informazioni di validità nei dettagli. Non unificare arbitrariamente i due significati.
5. GitHub può ritardare gli snapshot; Pages non attende necessariamente Chromium. Android fisico non collaudato.
6. In caso di fallimento totale delle fonti CNT il frontend azzera l'elenco in memoria; non dichiarare conservazione universale dell'ultimo elenco.

Rispondere al proprietario in italiano distinguendo codice corretto, fixture, prove reali e distribuzione. Non chiedere configurazioni manuali già automatizzabili e non dichiarare verificato ciò che è soltanto proposto.
