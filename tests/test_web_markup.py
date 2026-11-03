"""Verifica i controlli mobili e i collegamenti della ricerca Salerno."""
import unittest
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]

class WebMarkupTests(unittest.TestCase):
    def test_single_visible_napoli_terminal_selector(self):
        soup=BeautifulSoup((ROOT/'index.html').read_text(encoding='utf-8'),'html.parser')
        panel=soup.find(id='napoli-terminal-switch')
        self.assertTrue(panel.has_attr('hidden'))
        buttons=soup.select('#napoli-shortcuts button[data-open-terminal]')
        self.assertEqual(len(buttons),2)
        self.assertEqual([b.get('aria-pressed') for b in buttons],['true','false'])
        self.assertEqual([b.get('data-open-terminal') for b in buttons],['cnt','tfg'])

    def test_csp_meta_excludes_unsupported_frame_ancestors(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        soup=BeautifulSoup(html,'html.parser')
        meta=soup.find('meta',attrs={'http-equiv':'Content-Security-Policy'})
        self.assertIsNotNone(meta)
        csp=meta.get('content','')
        self.assertIn("default-src 'self'",csp)
        self.assertIn("object-src 'none'",csp)
        self.assertNotIn("frame-ancestors",csp)

    def test_ports_and_ship_list(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        soup=BeautifulSoup(html,'html.parser')
        ports=soup.find_all('input',{'name':'port'})
        self.assertEqual({p.get('value') for p in ports},{'napoli','salerno'})
        picker=soup.find(id='sct-picker')
        self.assertIsNotNone(picker)
        self.assertTrue(picker.has_attr('hidden'))
        for ident in ('sct-vessel-list','sct-vessel-count','sct-alert','sct-show-more',
                      'sct-filter','sct-type','sct-only-open','reload-sct'):
            self.assertIsNotNone(picker.find(id=ident),ident)
        self.assertIsNone(picker.find(id='sct-vessel-select'))
        booking=soup.find(id='napoli-booking-controls')
        self.assertIsNotNone(booking.find('input',id='query'))
        self.assertIsNone(picker.find('input',id='query'))
        self.assertEqual(
            {o.get('value') for o in soup.find(id='sct-type').find_all('option')},
            {'all','dry','reefer'}
        )
        self.assertEqual(soup.find('meta',attrs={'name':'theme-color'}).get('content'),'#006f89')
        self.assertIsNotNone(soup.find('img',class_='lts-brand-logo'))

    def test_js_uses_vessel_cards_and_alerts(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        for required in (
            "sctVesselList.addEventListener('click'",
            "button.dataset.vesselIndex=String(choice.index)",
            "renderSct(choice.row.vessel,chosenSctIndex)",
            "sctType.addEventListener('change'",
            "sctOnlyOpen.addEventListener('change'",
            "selectedTypeVerdict(choice.row,sctCache).kind==='good'",
            "sctAlert.dataset.state='warning'",
            "evaluateSctType(rowData,schedule,type)",
            "requestId!==sctRequestId",
            "./data/sct.json",
            "byId('napoli-booking-controls').hidden=salerno",
            "query.disabled=salerno",
        ):
            self.assertIn(required,app)
        self.assertNotIn("sctSelect",app)

    def test_booking_workflow_is_explicit_and_privacy_respecting(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        css=(ROOT/'driver-ui.css').read_text(encoding='utf-8')
        helper=(ROOT/'booking_search.mjs').read_text(encoding='utf-8')
        self.assertIn("validateBooking(query.value)",app)
        self.assertIn("chooseBookingTerminal",app)
        self.assertIn("void renderTfgBooking(result.booking)",app)
        self.assertIn("void renderConatecoBooking(result.booking)",app)
        self.assertIn("↗ APRI RICERCA BOOKING UFFICIALE",app)
        self.assertIn("Booking Export",app)
        self.assertIn("booking-feedback",html)
        self.assertIn('data-booking-target="cnt"',html)
        self.assertIn('data-booking-target="tfg"',html)
        self.assertIn("booking-quick-options",css)
        self.assertIn("booking-postcheck",css)
        self.assertIn("CERCA BOOKING CNT",html)
        self.assertIn(".booking-method[hidden]",css)
        self.assertIn("normalizeBooking(value)",helper)
        self.assertNotIn("fetch(urls.cntBooking",app)
        self.assertNotIn("fetch(urls.tfgBooking",app)
        self.assertNotIn("localStorage",app)

    def test_cnt_official_booking_is_direct_and_fail_closed(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        module=(ROOT/'conateco_booking.mjs').read_text(encoding='utf-8')
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        for marker in (
            "void renderConatecoBooking(result.booking)",
            "lookupConatecoBooking(booking,undefined,controller.signal)",
            "showConatecoVesselContext(data,requestId,forecastDetails,acceptance,deliveryOutput)",
            "DATI BOOKING RILEVATI",
            "BOOKING NON CONFERMATO",
            "SERVIZIO NON DISPONIBILE",
            "PROGRAMMA NAVE",
        ):
            self.assertIn(marker,app)
        self.assertIn("https://api.conateco.it/ConatecoServicesApi/Booking",module)
        self.assertIn("id_booking",module)
        self.assertIn("ReturnCode",module)
        self.assertIn("B_NOMNAVE",module)
        self.assertIn("B_ETA",module)
        self.assertIn("https://api.conateco.it",html)
        self.assertNotIn("fetch(urls.cntBooking",app)

    def test_tfg_form_posts_only_to_official_terminal(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        for required in ("submitTfgOfficialForm(booking)","form.method='POST'",
                         "form.action=urls.tfgBooking","['modo','2']","['bkk',checked.booking]"):
            self.assertIn(required,app)
        self.assertIn("form-action 'self' https://tfg.bucci.it",html)
        self.assertIn("CERCA BOOKING TFG",app)

    def test_tfg_booking_direct_backend_fail_closed(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        module=(ROOT/'tfg_booking.mjs').read_text(encoding='utf-8')
        api=(ROOT/'cloudflare/index.mjs').read_text(encoding='utf-8')
        parser=(ROOT/'cloudflare/tfg_booking.mjs').read_text(encoding='utf-8')
        for marker in ("void renderTfgBooking(result.booking)","lookupTfgBooking(booking,undefined,controller.signal)",
                       "showTfgVesselContext(data,requestId,context,details)","matchTfgVoyage","tfgScheduleDelivery",
                       "BOOKING NON CONFERMATO","SERVIZIO NON DISPONIBILE"):
            self.assertIn(marker,app)
        self.assertIn("https://container-booking-backend.pasqualemilano0.workers.dev/api/tfg_booking",module)
        self.assertIn("/api/tfg_booking",api)
        self.assertIn("booking_authorized",parser)
        self.assertNotIn("verify=False",parser)

    def test_cloudflare_monitored_feeds_with_safety_fallback(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        for required in (
            "cloudflareMonitorUrl('/api/cnt')",
            "cloudflareMonitorUrl('/api/sct')",
            "cloudflareMonitorUrl('/api/tfg/snapshot')",
            "mode==='cloudflare_scheduled'",
            "publicCntSnapshot+'?t='",
            "publicSctSnapshot+'?t='",
            "publicTfgSnapshot+'?t='"
        ):
            self.assertIn(required,app)
        self.assertIn("Controlla",app)
        self.assertNotIn("fetch(cloudflareTfgApiOrigin+'/api/booking'",app)

    def test_tfg_import_is_client_side_and_uncertainty_explicit(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        for word in (
            "import {parseTfgBookingResult} from './tfg.mjs?v=20261031-v41'",
            "buildTfgImporter(booking)",
            "navigator.clipboard.readText()",
            "showTfgExtracted(area.value,booking,output)",
            "values.push(['Terminal di consegna','Da verificare nel programma TFG'])",
            "ACCETTAZIONE NON CONFERMATA",
            "urls.tfgSchedule"
        ):
            self.assertIn(word,app)
        self.assertNotIn('localStorage',app)
        self.assertNotIn('fetch(urls.tfgBooking',app)
        self.assertNotIn('GET /api/booking',app)

    def test_napoli_compact_result_and_notice(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        css=(ROOT/'styles.css').read_text(encoding='utf-8')+(ROOT/'driver-ui.css').read_text(encoding='utf-8')
        for required in (
            "function renderNapoli(booking,terminal)",
            "napoli-reference",
            "booking-action-panel",
            "booking-external-link",
            "booking-postcheck",
            "RISULTATO SUL SITO TFG",
            "La risposta del modulo TFG rimane sul sito ufficiale",
        ):
            self.assertIn(required,app)
        for required in ('.napoli-reference', '.booking-action-panel', '.booking-postcheck', '.booking-quick-options'):
            self.assertIn(required,css)
        self.assertNotIn("results.append(facts([['Porto','Napoli']",app)

    def test_tfg_on_demand_backend_never_disguises_snapshot_as_live(self):
        js=(ROOT/"app.js").read_text(encoding="utf-8")
        api=(ROOT/"cloudflare/index.mjs").read_text(encoding="utf-8")
        for token in (
            "hasOnDemandTfgBackend()",
            "fetch(liveEndpoint",
            "direct?.live!==true",
            "direct.source!==urls.tfgSchedule",
            "live:false,live_failed:liveRequested",
            "tfgFeed.live_failed",
            "Copia del programma TFG acquisita periodicamente",
            "Lettura diretta effettuata: ",
            "Verifica ora",
        ):
            self.assertIn(token,js)
        self.assertIn("parseTfgHtml",api)
        self.assertIn("TFG_BAD_SCHEMA",api)
        self.assertIn("booking_verified",api)
        self.assertIn("no-store, max-age=0",api)
        self.assertNotIn("verify=False",api)

    def test_github_pages_uses_live_tfg_api_with_restricted_cors(self):
        app=(ROOT/"app.js").read_text(encoding="utf-8")
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        backend=(ROOT/"cloudflare/index.mjs").read_text(encoding="utf-8")
        self.assertIn("host==='pasqualemilano0-rgb.github.io'",app)
        self.assertIn("cloudflareMonitorUrl('/api/tfg')",app)
        self.assertIn("const liveEndpoints=tfgOnDemandUrls()",app)
        self.assertIn("for(const liveEndpoint of liveEndpoints)",app)
        self.assertIn("https://container-booking-backend.pasqualemilano0.workers.dev;",html)
        self.assertIn("fetch(liveEndpoint",app)
        self.assertIn("const WEB='https://pasqualemilano0-rgb.github.io'",backend)
        self.assertIn("Access-Control-Allow-Origin",backend)
        self.assertIn("live:false,live_failed:liveRequested",app)
        self.assertNotIn("fetch('/api/tfg-booking'",app)

    def test_tfg_live_failed_is_unknown_and_preserves_previous_rows(self):
        js=(ROOT/'app.js').read_text(encoding='utf-8')
        tfg=(ROOT/'tfg_schedule.mjs').read_text(encoding='utf-8')
        self.assertIn("if(feed?.live_failed===true)",tfg)
        self.assertIn("label:'VERIFICA NON DISPONIBILE'",tfg)
        self.assertIn("tfgFeed={...previous,live:false,live_failed:true}",js)
        self.assertIn("const previous=tfgFeed?.rows?.length?tfgFeed:null",js)

    def test_delivery_location_is_highlighted_without_guessing_cnt_booking(self):
        js=(ROOT/'app.js').read_text(encoding='utf-8')
        css=(ROOT/'driver-ui.css').read_text(encoding='utf-8')
        helper=(ROOT/'delivery_location.mjs').read_text(encoding='utf-8')
        self.assertIn("deliveryChip(tfgScheduleDelivery(row,tfgFeed))",js)
        self.assertIn("deliveryChip(conatecoForecastDelivery(row,cntFeed))",js)
        self.assertIn("depotAcceptancePanel(conatecoDepotAcceptance(row,feed))",js)
        self.assertIn("DESTINAZIONE INDICATIVA",js)
        self.assertIn(".delivery-spot-indicative",css)
        self.assertIn("v0.40 — Tipografia compatta",css)
        self.assertIn("font-size:clamp(19px,4.7vw,22px)",css)
        self.assertIn("ACCETTAZIONE SU DEPOSITI ESTERNI",js)
        self.assertIn(".depot-acceptance-chip",css)
        self.assertIn("deliveryPanel(tfgScheduleDelivery(row,feed))",js)
        self.assertIn("deliveryPanel(conatecoForecastDelivery(row,feed))",js)
        self.assertNotIn("tfgBookingDelivery",js)
        self.assertNotIn("data.destination",js)
        self.assertIn("TERMINAL DI CONSEGNA del programma ufficiale TFG",js)
        self.assertIn(".delivery-chip",css)
        self.assertIn(".delivery-chip-label",css)
        self.assertIn(".delivery-chip-value",css)
        self.assertIn("delivery-chip-external-notice",js)
        self.assertIn("delivery-spot-external-notice",js)
        self.assertIn(".delivery-spot-value",css)
        self.assertIn("LUOGO DA VERIFICARE",helper)
        self.assertIn("external_depot",helper)

    def test_tfg_publication_age_is_not_falsely_classified_stale(self):
        app=(ROOT/"app.js").read_text(encoding="utf-8")
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        rules=(ROOT/"tfg_schedule.mjs").read_text(encoding="utf-8")
        css=(ROOT/"driver-ui.css").read_text(encoding="utf-8")
        self.assertIn("TFG pubblica: ",app)
        self.assertIn("tfg-published-state",app)
        self.assertIn("tfg-published-state",css)
        self.assertIn("recentDirectRead=feed?.live===true&&recentlyAcquired",rules)
        self.assertIn("isTfgFeedFresh(feed,now)",rules)
        self.assertNotIn("updatedWithinWindow",rules)
        self.assertIn("label:'ACCETTA CARICO'",rules)
        self.assertNotIn("officialAge<=48*60*60000",rules)
        self.assertRegex(html,r'app[.]js[?]v=20[0-9]{6}-v[0-9]+')
        self.assertRegex(html,r'driver-ui[.]css[?]v=20[0-9]{6}-v[0-9]+')
    def test_tfg_forecast_crosscheck_and_no_live_claim(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        workflow=(ROOT/'.github/workflows/pages.yml').read_text(encoding='utf-8')
        for marker in (
            "matchTfgVoyage(data,feed)",
            "evaluateTfgSchedule(info,feed)",
            "loadTfgSnapshot()",
            "DATI NON AGGIORNATI",
            "Viaggio di partenza",
            "void checkPublicTfgSchedule(data,host)"
        ):
            self.assertIn(marker,app)
        self.assertIn("scripts.fetch_tfg_schedule",workflow)
        self.assertIn("node --test tests/*.test.mjs",workflow)
        self.assertNotIn("verify=False",workflow)

    def test_no_duplicate_vessel_controls(self):
        for path in ('index.html','salerno-v03.html'):
            soup=BeautifulSoup((ROOT/path).read_text(encoding='utf-8'),'html.parser')
            self.assertEqual(len(soup.find_all('input',id='query')),1)
            self.assertEqual(len(soup.find_all('input',id='sct-filter')),1)
            self.assertEqual(len(soup.find_all(id='sct-vessel-list')),1)
            self.assertEqual(len(soup.find_all(id='sct-alert')),1)
            self.assertIsNone(soup.find('select',id='sct-vessel-select'))
            self.assertIsNone(soup.find(id='sct-picker').find(id='query'))
            self.assertIsNone(soup.find(id='sct-picker').find(id='search-btn'))
            self.assertIsNotNone(soup.find('details',class_='sources'))
            self.assertIsNotNone(soup.find(id='results'))

    def test_lts_logo_and_palette(self):
        import json
        manifest=json.loads((ROOT/'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['theme_color'],'#006f89')
        self.assertEqual(manifest['background_color'],'#f3f7f9')
        for path in ('index.html','salerno-v03.html'):
            soup=BeautifulSoup((ROOT/path).read_text(encoding='utf-8'),'html.parser')
            img=soup.find('img',class_='lts-brand-logo')
            self.assertIsNotNone(img)
            self.assertEqual(img.get('src'),'assets/lts-logo.png')
            self.assertTrue((ROOT/'assets/lts-logo.png').is_file())
            self.assertEqual(soup.find('meta',attrs={'name':'theme-color'}).get('content'),'#006f89')
            self.assertEqual(soup.find('h1').get_text(strip=True),'Container Booking')

    def test_app_refresh_cache_scoped_to_this_repository(self):
        js=(ROOT/'app.js').read_text(encoding='utf-8')
        for expected in (
            "function refreshContainerBooking()",
            "new URL('./',window.location.href).pathname",
            "scope.pathname.startsWith(sitePath)",
            "u.origin===window.location.origin && u.pathname.startsWith(sitePath)",
            "window.location.replace(freshUrl.toString())",
            "searchParams.set('aggiorna',String(Date.now()))",
            "addEventListener('click',refreshContainerBooking)",
            "./rules.mjs?v=20261102-v65",
            "./tfg.mjs?v=20261031-v41",
            "./tfg_schedule.mjs?v=20261102-v62",
        ):
            self.assertIn(expected,js)
        for page in ('index.html','salerno-v03.html'):
            html=(ROOT/page).read_text(encoding='utf-8')
            soup=BeautifulSoup(html,'html.parser')
            button=soup.find('button',id='refresh-app')
            self.assertIsNotNone(button)
            self.assertIn('app.js?v=20' if page=='index.html' else 'v61',
                          soup.find('script',attrs={'type':'module'}).get('src'))
            self.assertIn('v17',soup.find('link',rel='stylesheet').get('href'))
            if page=='index.html':
                self.assertTrue(button.has_attr('hidden'))
                self.assertIsNotNone(soup.find(id='auto-update-status'))
                self.assertIn('auto-update.mjs?v=20261031-v27',html)
            else:
                self.assertFalse(button.has_attr('hidden'))

    def test_tfg_fleet_and_accessible_fallback(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        soup=BeautifulSoup(html,'html.parser')
        fleet=soup.find(id='tfg-fleet')
        self.assertIsNotNone(fleet)
        for field in ('tfg-ship-filter','tfg-vessel-list','tfg-vessel-count','tfg-feed-alert','tfg-feed-updated','tfg-show-more','tfg-reload'):
            self.assertIsNotNone(fleet.find(id=field),field)
        self.assertEqual(fleet.find('a',class_='tfg-direct-link').get('href'),'https://tfg.bucci.it/@/TFGW_TP_ETA')
        self.assertEqual(soup.find(id='sct-picker').has_attr('hidden'),True)
        js=(ROOT/'app.js').read_text(encoding='utf-8')
        self.assertIn("byId('tfg-fleet').hidden=salerno||napoliTerminal!=='tfg'",js)
        self.assertIn("evaluateTfgSchedule(row,tfgFeed)",js)
        self.assertIn("if(current!==tfgRequest||selectedPort!=='napoli')return;",js)

    def test_sct_source_caching_and_freshness_are_explicit(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        script=(ROOT/'scripts/fetch_sct.py').read_text(encoding='utf-8')
        for token in (
            'publicSctSnapshot', 'raw.githubusercontent.com',
            'isSctFeedRecent(data)', 'isSctFeedRecent(sctCache)',
            'evaluateSctType(row,data,sctType.value)',
            "void refreshSctPicker(true);",
            'Aggiornamento ufficiale SCT:', 'Il terminal non indica l’ora',
        ):
            self.assertIn(token,app)
        for token in (
            'source_updated_at', 'data_changed_at', 'acquired_at',
            'schedule_columns', 'ACCEPTANCE REEF', 'ACCEPTANCE DRY',
        ):
            self.assertIn(token,script)
        self.assertNotIn('verify=False',script)

    def test_style_and_version(self):
        css=(ROOT/'styles.css').read_text(encoding='utf-8')
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        self.assertIn('.sct-picker[hidden]{display:none}',css)
        self.assertIn('.vessel-row',css)
        self.assertIn('.ops-alert[data-state="warning"]',css)
        self.assertIn('#napoli-booking-controls[hidden]{display:none}',css)
        self.assertRegex(html,r'Container Booking Web · v0\.\d+')
        self.assertRegex(html,r'driver-ui\.css\?v=20\d{6}-v\d+')
        self.assertIn('driver-ui.mjs?v=20261031-v44',html)
        self.assertRegex(html,r'app\.js\?v=20\d{6}-v\d+')
        self.assertIn('styles.css?v=20261031-lts-v17',html)

if __name__=='__main__':
    unittest.main()
