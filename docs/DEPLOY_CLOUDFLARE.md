# Distribuzione automatica Cloudflare Worker

## Backend esistente
- Worker: `container-booking-backend`
- Repository GitHub: `pasqualemilano0-rgb/container-booking-web-`
- Branch di produzione: `main`
- Configurazione Wrangler: `cloudflare/wrangler.jsonc`
- Trigger cron del Worker: ogni 15 minuti (`*/15 * * * *`)
- Binding da preservare: `SCHEDULES_KV` e i quattro limiti nativi di richiesta

## Soluzione consigliata: Cloudflare Workers Builds
Collegare il Worker **già esistente**, senza crearne uno nuovo, al repository GitHub da **Workers & Pages > container-booking-backend > Settings > Builds > Connect > GitHub**.

Configurazione:

| Impostazione | Valore |
|---|---|
| Repository | `pasqualemilano0-rgb/container-booking-web-` |
| Production branch | `main` |
| Root directory | `cloudflare` |
| Build command | `for file in *.mjs; do node --check "$file" || exit 1; done && node --test ../tests/cloudflare_*.test.mjs` |
| Deploy command | `npx --yes wrangler@4.156.0 deploy --config wrangler.jsonc` |
| Preview builds | Disabilitati, se non necessari |
| Build watch paths (include) | `cloudflare/**`, `tests/cloudflare_*.test.mjs` |

La connessione alla repo GitHub è stata registrata su Cloudflare, ma **la configurazione Builds e il token di build devono essere completati nel dashboard**. Il dashboard può creare la credenziale automaticamente quando si salva il collegamento. Non pubblicare token nei file del repository o nei log.

## GitHub Actions: protezione contro deploy doppi
Il workflow `.github/workflows/deploy-cloudflare.yml` verifica sempre la sintassi e i test del backend. Il suo job di deploy è volutamente disattivato finché non viene impostata la variabile `CLOUDFLARE_DEPLOY_ENABLED=true` e non vengono configurati entrambi i segreti GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**Se si usa Workers Builds, lasciare questo job GitHub Actions disattivato** per evitare due processi di deploy sulla stessa produzione. Non occorre ricreare i segreti GitHub in questo caso.

## Verifiche dopo il collegamento
1. Effettuare un commit di modifica sotto `cloudflare/` e verificare l'esito del build e deploy Cloudflare.
2. Verificare `/api/health` e `/api/monitor/status` sul dominio del Worker.
3. Verificare che il KV, i limiti di richiesta e il cron ogni 15 minuti siano rimasti configurati.
4. Verificare che aggiornamenti dei soli snapshot `data/*.json` **non** avviino un deploy del Worker.
5. Controllare i test della web app e l'assenza di false conferme positive in caso di sorgenti indisponibili.

Il collegamento del repository al Worker non elimina né sostituisce il Worker esistente finché non avviene un deploy riuscito.