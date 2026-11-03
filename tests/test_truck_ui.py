"""Functional markup checks for the driver-first interface, versions 0.17/0.18."""
import unittest
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]

class DriverFirstInterfaceTests(unittest.TestCase):
    def test_port_and_ship_lists_prioritized_on_both_pages(self):
        for name in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/name).read_text(encoding="utf-8"),"html.parser")
            main=soup.find("main")
            self.assertIsNotNone(main)
            self.assertIsNone(main.find("section",class_="hero"))
            self.assertIsNotNone(main.find("p",class_="driver-notice"))
            self.assertIn("veicolo fermo",main.find("p",class_="driver-notice").get_text())
            self.assertEqual(main.find("h2",id="search-title").get_text(strip=True),"Dove devi consegnare?")
            fieldset=soup.find("fieldset",class_="ports")
            self.assertEqual({x.get("value") for x in fieldset.find_all("input",{"name":"port"})},{"napoli","salerno"})
            self.assertEqual(len(soup.find_all(id="query")),1)
            self.assertEqual(len(soup.find_all(id="sct-filter")),1)
            self.assertEqual(len(soup.find_all(id="tfg-ship-filter")),1)
            self.assertEqual(len(soup.find_all(id="cnt-ship-filter")),1)
            self.assertRegex(soup.get_text(),r'Container Booking Web · v0\.\d+' if name=='index.html' else r'v0\.17')
    def test_booking_directly_available_on_main_page(self):
        for name in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/name).read_text(encoding="utf-8"),"html.parser")
            details=soup.find("details",id="napoli-booking-details")
            self.assertIsNotNone(details)
            self.assertEqual(details.has_attr("open"),name=="index.html")
            self.assertEqual(details.find("summary").find(class_="booking-summary-title").get_text(strip=True),"Verifica un booking")
            self.assertIsNotNone(details.find(id="napoli-booking-controls"))
            self.assertIsNotNone(details.find("input",id="query"))
            self.assertIsNotNone(details.find("button",id="search-btn"))
            self.assertIsNotNone(soup.find("form",id="search-form").find(id="napoli-booking-details"))
    def test_salerno_vessel_search_and_container_type_remain_available(self):
        for name in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/name).read_text(encoding="utf-8"),"html.parser")
            picker=soup.find(id="sct-picker")
            self.assertIsNotNone(picker.find("input",id="sct-filter"))
            container_type=picker.find("select",id="sct-type")
            self.assertIsNotNone(container_type)
            self.assertEqual({x.get("value") for x in container_type.find_all("option")},{"all","dry","reefer"})
            if name=="index.html":
                self.assertIsNotNone(container_type.find_parent("details",class_="driver-extra"))
                self.assertIsNotNone(picker.find(id="sct-search-btn"))
                self.assertFalse(picker.find(id="sct-vessel-results").has_attr("hidden"))
                extra=picker.find("details",class_="driver-extra")
            else:
                self.assertIsNone(container_type.find_parent("details"))
                extra=picker.find("details",id="sct-extra-filters")
            self.assertIsNotNone(extra)
            self.assertFalse(extra.has_attr("open"))
            self.assertIsNotNone(extra.find("input",id="sct-only-open"))
            self.assertIsNotNone(picker.find(id="sct-alert"))
            self.assertIsNotNone(picker.find(id="sct-vessel-list"))
    def test_tfg_terminal_reachable_from_home_with_one_tap(self):
        home=BeautifulSoup((ROOT/"index.html").read_text(encoding="utf-8"),"html.parser")
        panel=home.find(id="napoli-shortcuts")
        self.assertIsNotNone(panel)
        buttons=panel.select("button[data-open-terminal]")
        self.assertEqual({b["data-open-terminal"] for b in buttons},{"cnt","tfg"})
        for button in buttons:
            self.assertEqual(button.get("type"),"button")
            self.assertEqual(button.get("aria-controls"),"napoli-advanced")
        js=(ROOT/"driver-ui.mjs").read_text(encoding="utf-8")
        self.assertIn("advanced.open=true",js)
        self.assertIn("radio.dispatchEvent(new Event('change'",js)
        self.assertIn("targetPanel.scrollIntoView",js)
        self.assertIsNotNone(home.find(id="tfg-feed-alert"))
        self.assertIsNotNone(home.find(id="tfg-vessel-list"))

    def test_tfg_and_cnt_panels_are_mutually_exclusive(self):
        js=(ROOT/"driver-ui.mjs").read_text(encoding="utf-8")
        css=(ROOT/"driver-ui.css").read_text(encoding="utf-8")
        self.assertIn("function syncNapoliTerminalPanels()",js)
        self.assertIn("tfgPanel.hidden=!napoli||selected!=='tfg'",js)
        self.assertIn("cntPanel.hidden=!napoli||selected!=='cnt'",js)
        self.assertIn("addEventListener('change',syncNapoliTerminalPanels)",js)
        self.assertIn("syncNapoliTerminalPanels();",js)
        self.assertIn('#cnt-fleet[hidden], #tfg-fleet[hidden]',css)
        self.assertIn(':has(input[name="napoli-terminal"][value="tfg"]:checked) #cnt-fleet',css)
        self.assertIn(':has(input[name="napoli-terminal"][value="cnt"]:checked) #tfg-fleet',css)

    def test_automatic_terminal_refresh_has_single_scheduler(self):
        js=(ROOT/"app.js").read_text(encoding="utf-8")
        self.assertIn("function autoRefreshActiveTerminal(force=false)",js)
        self.assertIn("window.setInterval(()=>autoRefreshActiveTerminal(),5*60*1000)",js)
        self.assertIn("window.addEventListener('online'",js)
        self.assertIn("document.addEventListener('visibilitychange'",js)
        self.assertIn("navigator.onLine===false",js)
        self.assertIn("autoRefreshActiveTerminal(true);",js)
        self.assertNotIn("void refreshTfgShips();",js)
        self.assertNotIn("void refreshCntShips();",js)

    def test_tfg_shortcut_forces_new_live_read(self):
        js=(ROOT/"driver-ui.mjs").read_text(encoding="utf-8")
        self.assertIn("if(alreadySelected)get(terminal==='tfg'?'tfg-reload':'cnt-reload').click()",js)
        app=(ROOT/"app.js").read_text(encoding="utf-8")
        self.assertIn("if(force||!next)",app)
        self.assertIn("tfgFeed=next; // Older overlapping requests cannot replace the newer feed.",app)
        self.assertIn("fetch(liveEndpoint",app)

    def test_tfg_booking_assisted_flow_only_not_fake_direct_api(self):
        js=(ROOT/"app.js").read_text(encoding="utf-8")
        self.assertIn("COPIA BOOKING",js)
        self.assertIn("↗ APRI RICERCA BOOKING UFFICIALE",js)
        self.assertIn("3. Incolla e controlla il risultato TFG",js)
        self.assertIn("INCOLLA E LEGGI",js)
        self.assertIn("showTfgExtracted(value,booking,output)",js)
        self.assertIn("navigator.clipboard?.readText",js)
        self.assertIn("navigator.clipboard?.writeText",js)
        self.assertIn("RISULTATO SUL SITO TFG",js)
        self.assertIn("void renderTfgBooking(result.booking)",js)
        self.assertIn("parseTfgBookingResult(out,booking)",js)
        self.assertNotIn("fetch('/api/tfg-booking'",js)

    def test_salerno_shows_ships_without_typing_or_pressing_search(self):
        html=BeautifulSoup((ROOT/"index.html").read_text(encoding="utf-8"),"html.parser")
        ship_list=html.find(id="sct-vessel-results")
        self.assertIsNotNone(ship_list)
        self.assertFalse(ship_list.has_attr("hidden"))
        self.assertIsNotNone(ship_list.find(id="sct-vessel-list"))
        self.assertIsNotNone(ship_list.find(id="sct-show-more"))
        script=(ROOT/"driver-ui.mjs").read_text(encoding="utf-8")
        self.assertIn("found.hidden=false",script)
        self.assertNotIn("found.hidden=true",script)
        self.assertIn("input.addEventListener('input',syncSearchLabel)",script)
        self.assertIn("button.disabled=false",script)
        app=(ROOT/"app.js").read_text(encoding="utf-8")
        self.assertIn("sctChoices=listSctVoyages(data.rows)",app)
        self.assertIn("renderPickerOptions();",app)
    def test_port_switch_keeps_all_functional_controls(self):
        app=(ROOT/"app.js").read_text(encoding="utf-8")
        for required in (
            "byId('napoli-booking-details').hidden=salerno",
            "byId('napoli-booking-controls').hidden=salerno",
            "query.disabled=salerno",
            "query.required=!salerno",
            "if(salerno)byId('napoli-booking-details').open=false",
            "autoRefreshActiveTerminal(true);",
            "if(term==='tfg')void refreshTfgShips(true)",
            "else if(term==='cnt')void refreshCntShips(true)",
            "else void refreshSctPicker(true)",
            "isSctFeedRecent(sctCache)",
            "normalizeName(choice.row.voyage).includes(filter)",
        ):
            self.assertIn(required,app)
        self.assertNotIn("localStorage",app)
    def test_accessibility_and_safety_kept(self):
        css=(ROOT/"styles.css").read_text(encoding="utf-8")
        for required in (
            ".booking-collapsible[hidden]",
            ".truck-top",
            ".driver-notice",
            ".extra-filters",
            ".vessel-list .vessel-row",
            "font-size:16px",
            "min-height:56px",
            ".sr-only",
        ):
            self.assertIn(required,css)
        for name in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/name).read_text(encoding="utf-8"),"html.parser")
            self.assertEqual(len(soup.find_all("img",class_="terminal-logo")),4 if name=="index.html" else 8)
            self.assertIn("autorizzazione",soup.get_text().lower())
            self.assertIsNotNone(soup.find("details",class_="sources"))
        doc=(ROOT/"README.md").read_text(encoding="utf-8")
        self.assertIn("veicolo fermo",doc)
        self.assertIn("senza affiliazione",doc.lower())
