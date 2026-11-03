# Cloudflare monitor — Container Booking

Il Worker Cloudflare gestisce il controllo continuo dei programmi nave ufficiali con frequenza programmata **ogni 15 minuti** e archiviazione Workers KV. Non serve tenere acceso il telefono o un PC.

Indirizzo: https://container-booking-backend.pasqualemilano0.workers.dev

- `/api/monitor/status` mostra per ogni terminale l'ultimo controllo e l'ultimo successo; `state=error` significa che la sorgente non è stata letta correttamente.
- `/api/cnt`, `/api/tfg/snapshot` e `/api/sct` forniscono la copia periodica più recente disponibile, preservando quelle precedenti se l'aggiornamento fallisce.
- `/api/tfg` resta il controllo TFG diretto su richiesta, senza rendere automaticamente confermato il singolo booking.

**Fondamentale:** se TFG non pubblica nuovi dati, Cloudflare non può inventarli: il timestamp ufficiale viene conservato e l'app deve mostrare un avviso. Anche SCT non pubblica necessariamente l'ora dell'ultimo aggiornamento.

La pubblicazione del codice del Worker tramite GitHub Actions è facoltativa e richiede `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_DEPLOY_ENABLED=true`. La pianificazione già installata in Cloudflare non dipende da GitHub Actions.

La verifica del booking e la conferma della consegna restano responsabilità dei sistemi ufficiali. Il monitor legge soltanto dati pubblici di navi.

SCT può restituire HTTP 403 alle richieste Cloudflare. In questo caso il cron utilizza automaticamente lo snapshot SCT verificato dal processo GitHub. La risposta Cloudflare rimane una copia differita, identificata come `github_verified_fallback`; verifica `/api/monitor/status` e `/api/sct`.
