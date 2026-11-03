# Linee guida tecniche — Container Booking Web

Queste istruzioni valgono per l'intero repository. **Leggi prima `docs/STATO_PROGETTO.md`** e poi `README.md`, senza presumere che l'ultima versione del codice sia già distribuita su Cloudflare e GitHub Pages. Se lo stato è cambiato, verifica e aggiorna il passaggio di consegne.

## Missione non negoziabile

Mantenere e perfezionare **Container Booking Web**, app mobile in italiano per autisti container nei porti di Napoli e Salerno, **solo** con tre terminal:
- **CO.NA.TE.CO. (CNT, Napoli):** l'autista cerca il **booking**; il risultato principale è **nome nave + stato di accettazione del carico dal Berth Forecast**, entrambi subito visibili. L'ETA resta un dettaglio. Per lo stato nave usare una corrispondenza univoca per nome esatto normalizzato nel programma corrente, usando l'ETA quando risolve il viaggio. ETA mancante o discordante non nasconde la nave; più viaggi possibili danno esito da verificare. Non confondere stato nave con autorizzazione del booking. ETA con data e orari invalidi non può incrociare un viaggio; anche con nome/giorno coincidenti richiedere ID viaggio leggibile e riga non contraddittoria. Se resta solo la corrispondenza per nome, mostrare nella schermata principale l'avviso visibile «VIAGGIO DEL BOOKING NON CONFERMATO», senza eliminare lo stato della nave richiesto dal proprietario.
- **Terminal Flavio Gioia (TFG, Napoli):** l'autista cerca il **booking**; backend Cloudflare legge il modulo ufficiale Export Booking e applica un parser prudente. Nel programma, per richiesta esplicita del proprietario che indica aggiornamenti ogni 24–48 ore o al cambio programma, mostrare **ACCETTA CARICO** in verde con lettura diretta recente e condizioni operative valide, anche se l'ultima modifica ufficiale è di giorni prima; nessun suffisso «DATO VECCHIO». Date di acquisizione e pubblicazione restano nei dettagli. Conservare priorità di chiusure, non accettazione e cut-off generale scaduto, con freschezza del luogo distinta.
- **Salerno Container Terminal (SCT, Salerno):** l'autista inserisce **nome della nave**, non booking; mostra Dry/Reefer, ETA, closing e stato del programma ufficiale.

Obiettivo di prodotto: un'interfaccia semplice, chiara, veloce su Android (320–432 px), aggiornamenti automatici senza interventi manuali né PC acceso, pochi tocchi. Non aggiungere terminali, pubblicità, paywall o servizi a pagamento senza richiesta.

**Architettura richiesta dal proprietario: GitHub Pages + backend Cloudflare.** Tutte le funzioni backend dell'app devono usare Cloudflare; conservare GitHub per sorgente, frontend e snapshot di riserva. Non aggiungere altri servizi di hosting o backend. Le funzioni server precedenti e le relative configurazioni sono rimosse; gli script Python rimasti servono a GitHub per snapshot e QA.

## Sicurezza operativa — priorità assoluta

1. **Non inventare disponibilità di booking, autorizzazione di consegna, luogo, closing, apertura o stato live.** `ACCETTA CARICO` riguarda la nave/viaggio: non certifica il singolo booking.
2. **TFG:** il luogo va ricavato **solo** dalla colonna ufficiale `TERMINAL DI CONSEGNA`, mai da testi arbitrari, da parole come `DRYPORT` fuori dalla colonna né dal booking non corrispondente. Per richiesta esplicita del proprietario mostra il solo valore pubblicato, per esempio **INTERNO PORTO**, senza suffissi. Conserva `source_updated_at` come data di modifica del programma e `acquired_at` come data di lettura. Una pubblicazione invariata da giorni non è automaticamente vecchia; controlla invece acquisizione recente, timestamp validi, live riuscito e assenza di chiusure/cut-off scaduti. Se il luogo è ricavato da una copia, mostra un avviso visibile senza cambiare il nome pubblicato; date e note nei dettagli «Fonte e aggiornamento».
3. **CNT:** per richiesta esplicita del proprietario, `accettazioneesterni=S` recente mostra **DEPOT ESTERNI: OK** e le due opzioni **INTERNO PORTO / DRYPORT**, con la stessa grafica del riquadro TFG. Sono opzioni della nave univoca nel programma corrente, non l'indirizzo di un deposito né l'autorizzazione del booking. Conservare fonte, date e natura indicativa nei dettagli apribili. `N` o assente mantengono la precedente indicazione presunta `INTERNO PORTO`, mai conferma del booking; dati vecchi, contraddittori o non interpretabili lasciano il luogo da verificare. Per attribuire viaggio e destinazione al booking richiedere nave + ETA compatibile e corrispondenza univoca. Stato e opzioni della sola nave possono usare il nome esatto normalizzato quando identifica un'unica riga corrente; mantenere freschezza, blocchi, chiusure e ambiguità, senza certificare il viaggio del booking.
4. **SCT:** distinguere **Dry e Reefer**, non confondere un'acquisizione recente con l'ultimo aggiornamento interno del terminal (spesso non pubblicato).
5. **Protezione API TFG:** usare i rate-limit binding nativi `BOOKING_CLIENT_LIMIT`, `BOOKING_GLOBAL_LIMIT`, `TFG_CLIENT_LIMIT`, `TFG_GLOBAL_LIMIT` secondo `cloudflare/wrangler.jsonc`; nessun booking/IP in KV, niente log sensibili o header `X-Forwarded-For` come identità. Limiti approssimativi per sede Cloudflare, risposte 429 con `Retry-After` e mancata chiamata upstream, fail-closed 503 se binding non disponibile; controllare costi/piano prima di cambiare risorse. Nessuna nuova infrastruttura a pagamento senza autorizzazione.
5. Nessun booking reale nei test, nei log persistenti, negli URL GET del nostro backend, in Workers KV o nei file JSON. Non disabilitare HTTPS/TLS; non aggirare autenticazioni/CAPTCHA. Gestire errori con esito **non verificato**, non falsi positivi.
6. Cloudflare, GitHub e le copie KV non sono fonti ufficiali: indicare chiaramente origine, data, eventuale fallback e staleness.

## Architettura e strumenti

- Frontend statico GitHub Pages: `index.html`, `app.js`, `driver-ui.mjs`, `driver-ui.css`, `auto-update.mjs`, moduli `*_booking.mjs`, `*_rules.mjs`, `delivery_location.mjs`.
- Cloudflare Workers: `cloudflare/index.mjs`, `cloudflare/monitor.mjs`, `cloudflare/parse_tfg.mjs`, `cloudflare/wrangler.jsonc`. Cron `*/15 * * * *`, Workers KV `SCHEDULES_KV`; verificare che il codice **distribuito** corrisponda al repository. Cloudflare può essere bloccato dal sito SCT con 403: fallback verificato allo snapshot GitHub senza cambiare artificiosamente `acquired_at`.
- Booking TFG: `cloudflare/tfg_booking.mjs`, rotta `POST /api/tfg_booking` in `cloudflare/index.mjs`, client `tfg_booking.mjs`, test JS e browser; non fondere ricerca booking con l'API pubblica dei programmi navi. Nessun booking salvato in KV o incluso nei log.
- Snapshot pubblici: `scripts/fetch_conateco.py`, `scripts/fetch_tfg_schedule.py`, `scripts/fetch_sct.py`, `data/*.json`; GitHub Actions `.github/workflows/pages.yml` (circa 15 min ma non garantiti), `qa-main-browser.yml`, `qa-cloudflare.yml`.
- Test locali: `node --test tests/*.test.mjs`, `python -m unittest discover -s tests -p 'test_*.py'` (dipendenze Python `requests` e `beautifulsoup4`). QA browser: Playwright Chromium in GitHub Actions; non confondere viewport Android con telefono Android fisico.

## Metodo obbligatorio

- **Leggi lo stato remoto prima di scrivere**: branch `main`, Actions, GitHub Pages, Worker/Cron/KV. Verifica che non ci siano snapshot bot concorrenti.
- Procedi per piccoli commit, test con fixture + casi limite + browser 320/390/432 px, controllo HTTP pubblico; confronta **test, sorgente, deployment**. Niente “10/10” o “tutto funziona” senza prove reali.
- Mantieni invariato il comportamento dei terminali non interessati; conserva backup e fallback, senza sovrascrivere una copia valida con dati vuoti/invalidi.
- Quando modifichi `index.html` / frontend, aggiorna cache-buster versione, test di markup e note release. Non interrompere ricerca booking o auto-update mentre risolvi il monitor.
- **Non attivare direttamente deploy non collaudati**, né cambiare permessi, segreti, abbonamenti, domini, protezioni o costi senza autorizzazione esplicita dell'utente. Per il Worker, il job `deploy-cloudflare.yml` può essere `skipped`: il successo della QA non costituisce deploy.
- Aggiorna `docs/STATO_PROGETTO.md` al termine di ogni tranche: commit, date, test, cosa è davvero online, bug aperti e prossima azione. Prima di qualsiasi cambio ad alto rischio, spiega l'impatto.

## Procedura di ripresa

Apri `docs/STATO_PROGETTO.md` e tratta la sezione **P0 — ripresa immediata** come backlog prioritario. La checklist non autorizza a inventare risultati operativi.
