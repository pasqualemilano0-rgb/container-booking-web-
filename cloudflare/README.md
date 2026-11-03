# Cloudflare Workers — backend booking e monitor programmi navi

Backend esistente `container-booking-backend` con controllo separato delle tre fonti ufficiali. Il monitor effettua letture **programmate ogni 15 minuti (UTC)**, non un collegamento websocket o una garanzia al minuto. Cloudflare può ritardare l'esecuzione e le fonti possono essere indisponibili.

## Backend unico per GitHub Pages

GitHub Pages è il frontend; Cloudflare gestisce programmi, monitor H24 e ricerca booking TFG. Il Worker autorizza la sola origine `https://pasqualemilano0-rgb.github.io` tramite CORS.

`POST /api/tfg_booking` riceve solo JSON `{"booking":"..."}`, massimo 512 byte effettivi; niente query string, GET, campi aggiuntivi o salvataggio. Inoltra un POST HTTPS al modulo ufficiale TFG con `modo=2` e `bkk`, limita l'HTML a 100.000 byte e applica un timeout. `cloudflare/tfg_booking.mjs` usa HTMLRewriter e riconosce titolo, testo strutturato con esclusione delle sezioni esplicitamente nascoste, booking eventualmente ripetuto e coppia nave/viaggio univoca. Le risposte riportano sempre `booking_authorized:false`; non contengono una destinazione dedotta dal booking.

Il programma navi resta separato: `TERMINAL DI CONSEGNA` proviene solo dal programma ufficiale TFG. Il nuovo endpoint non scrive su Workers KV e non registra il booking nei log applicativi.

## Rilascio backend v0.54

Pubblicato il **1 novembre 2026 alle 12:39:35 UTC**, versione `5ca96100-81ee-424b-96a4-fb5ece79f947`, deployment `73ef4861-a230-4aa5-96cd-c801c773b79f`. Sorgente nel commit `93d5bb4dbdbe0b079e3d211f425c67b6954a325c`; cron e binding KV conservati.

Verifica reale completata: preflight 204, ricerca sintetica negativa HTTP 200 `not_found`, `booking_authorized:false`, risposta non memorizzabile e senza echo del codice. I casi positivi restano fixture; non sono una certificazione di booking reali. Il monitor mantiene le sei chiavi dei tre terminali.

## Monitor H24 in produzione

Il Worker è stato aggiornato il **1 novembre 2026 alle 07:47:12 UTC** alla versione **10**, ID `c08250ec-74b7-4e3d-8507-4b3dd0f5802f`, deployment `0d054915-836e-461f-a52e-9bc6cf225567`. Il nuovo codice comprende il fallback SCT v0.52 già presente su `main` (`58d9758ed9f3145fc35d32e998be57ba7eb74bd3`). I gestori `fetch` e `scheduled` sono installati; cron e binding KV preesistenti sono stati conservati.

- **Operatività H24:** Cloudflare avvia il controllo ai minuti **00, 15, 30 e 45 di ogni ora, tutti i giorni**, anche con app chiusa e telefono o PC spenti. L'esecuzione e l'aggiornamento delle fonti possono avere ritardi.
- **CNT e TFG:** il monitor legge i programmi ufficiali e conserva le copie valide in Workers KV. Per TFG mantiene distinta la lettura recente dall'ora dell'ultima pubblicazione del terminal.
- **SCT:** quando la lettura ufficiale da Cloudflare non riesce, importa lo snapshot verificato da GitHub Actions, conservando `acquired_at`. In questo caso stato e provenienza indicano esplicitamente il fallback.
- **Stato pubblico:** [monitor di produzione](https://container-booking-backend.pasqualemilano0.workers.dev/api/monitor/status). Contiene esiti, ultimi tentativi e successi, acquisizioni e numero di righe; non contiene booking.

Il calendario server H24 è indipendente dal browser. La raccolta della copia GitHub usata da SCT dipende dalla pianificazione GitHub Actions, che può subire ritardi: una copia vecchia viene marcata `stale` e non riceve un nuovo timestamp artificiale.

### Primo ciclo automatico verificato

Alle **08:00:17.099 UTC del 1 novembre 2026** il Worker ha eseguito autonomamente il primo ciclo successivo al rilascio; verifica HTTPS completata alle 08:00:27 UTC.

| Terminal | Stato monitor | Viaggi | Origine e aggiornamento |
| --- | --- | --- | --- |
| CNT | `ok` | 37 | Lettura ufficiale Cloudflare delle 08:00:17 UTC |
| TFG | `stale` | 20 | Lettura riuscita alle 08:00:17 UTC; pubblicazione del terminal ancora del 31 ottobre alle 11:40:26 UTC |
| SCT | `fallback` | 24 | Copia GitHub acquisita alle 07:29:39.044611 UTC, conservata senza riscriverne il timestamp |

Tutti e tre i terminal hanno `last_attempt_at` e `last_success_at` alle 08:00:17.099 UTC. `/api/sct` restituisce ora `mode:github_verified_fallback`: righe e ora di acquisizione coincidono con lo snapshot pubblico GitHub. Il codice di errore della lettura ufficiale resta visibile anche quando il fallback riesce.

La verifica indipendente tramite API amministrativa alle **08:00:40 UTC** conferma sei chiavi KV: `schedule:cnt`, `schedule:tfg`, `schedule:sct` e i tre rispettivi stati. Il fallback SCT è quindi archiviato dal cron effettivo.

## Architettura

- **CO.NA.TE.CO.**: `GET /ConatecoServicesApi/BerthForecast?stato=...` per PRESENTI, PREVISTE, ORMEGGIATE e PARTITE. Sono dati relativi alla nave, non al booking.
- **TFG**: HTML ufficiale `/&#64;/TFGW_TP_ETA`, parser conservativo di `TERMINAL DI CONSEGNA`, viaggi e aggiornamento dichiarato. Un certificato TLS non valido o un cambiamento HTML produce errore, senza aggirare la sicurezza.
- **SCT**: il sito ufficiale blocca Cloudflare con HTTP 403; la lettura diretta fallisce quindi senza aggirare la protezione. In quel caso il Worker importa il file JSON già verificato e pubblicato da GitHub Actions, preserva l'ora originale e indica esplicitamente \`mode:github_verified_fallback\`. La tabella HTML pubblica `/ca/an/vessel_schedule.php` con intestazioni verificate, valori Dry/Reefer separati, senza dedurre un aggiornamento che il terminal non dichiara.
- **Workers KV**: una copia `schedule:cnt|tfg|sct` per terminale e uno stato `status:cnt|tfg|sct`. Un errore aggiorna solo lo stato; **non** sovrascrive la copia valida.
- I dati sono considerati **copia periodica**, mai verifica in tempo reale del singolo booking. Per TFG la vecchia data di aggiornamento del terminal resta visibile e il feed è segnalato `stale` anche se Cloudflare l'ha letto da pochi minuti.
- I booking numerici non vengono mai inviati al monitor, né salvati su KV.

CORS permette soltanto l'origine di produzione **GitHub Pages**; richieste da origini sconosciute non ricevono autorizzazione CORS e le ricerche booking vengono rifiutate.

## Rotte

| GET | Descrizione |
| --- | --- |
| `/api/health` | Disponibilità del servizio, senza dichiarare che i terminal siano raggiungibili |
| `/api/monitor/status` | Stato, ultimo tentativo, ultimo successo, ultima lettura e numero righe per terminal |
| `/api/cnt` | Ultima copia CNT validata |
| `/api/tfg/snapshot` | Ultima copia TFG validata |
| `/api/sct` | Ultima copia SCT validata |
| `/api/tfg` | Lettura diretta TFG su richiesta, rigorosamente distinta dalla copia periodica |

La ricerca booking usa invece **POST `/api/tfg_booking`**, con preflight OPTIONS e `Content-Type: application/json`; non è una rotta del monitor.

Se KV è ancora vuoto, le tre rotte snapshot possono temporaneamente servire la copia pubblica GitHub con `mode:periodic_snapshot`. Questa non viene spacciata per lettura live Cloudflare.

## Deploy

Configurazione: `cloudflare/wrangler.jsonc`, con binding `SCHEDULES_KV` e `triggers.crons: ["*/15 * * * *"]`.

Test: `node --test tests/cloudflare_worker.test.mjs tests/cloudflare_monitor.test.mjs`. Dopo la pubblicazione verificare `/api/health`, `/api/monitor/status` e le tre rotte snapshot. Le modifiche ai sorgenti possono essere pubblicate tramite `.github/workflows/deploy-cloudflare.yml` soltanto se sono disponibili i segreti GitHub Actions Cloudflare e `CLOUDFLARE_DEPLOY_ENABLED=true`; il cron funziona indipendentemente da GitHub Actions una volta pubblicato il Worker.

Non usare mai `verify=false` o una risposta HTTP 200 come prova che un booking accetti carico.

## Verifica fallback SCT

Lettura diretta ufficiale dal Worker: possibile `SOURCE_HTTP` per il blocco HTTP 403. Il Worker tenta `raw.githubusercontent.com/.../data/sct.json` e accetta il JSON solo se `source`, `acquired_at` e schema hanno valori validi. Se importato, `/api/monitor/status` mostra `state:fallback` e `/api/sct` mostra `mode:github_verified_fallback`. Quando l'acquisizione supera 45 minuti `state:stale`. Nessuna nuova acquisizione viene inventata, e il vecchio dato non certifica l'accettazione.
