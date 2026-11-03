import unittest
from pathlib import Path
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
class ConatecoFleetMarkupTests(unittest.TestCase):
    def test_terminal_switch_and_fleet_controls_on_both_pages(self):
        for name in ('index.html','salerno-v03.html'):
            soup=BeautifulSoup((ROOT/name).read_text(encoding='utf-8'),'html.parser')
            switch=soup.find(id='napoli-terminal-switch')
            self.assertIsNotNone(switch)
            tabs=switch.find_all('input',{'name':'napoli-terminal'})
            self.assertEqual({i.get('value') for i in tabs},{'cnt','tfg'})
            self.assertEqual(len([i for i in tabs if i.has_attr('checked')]),1)
            fleet=soup.find(id='cnt-fleet')
            self.assertIsNotNone(fleet)
            for ident in ('cnt-feed-alert','cnt-vessel-list','cnt-ship-filter','cnt-vessel-count',
                          'cnt-show-more','cnt-feed-updated','cnt-reload'):
                self.assertIsNotNone(fleet.find(id=ident),ident)
            if name=='index.html':
                self.assertIsNotNone(fleet.find(id='cnt-archive-toggle'))
            self.assertEqual(fleet.find('a',class_='tfg-direct-link').get('href'),
              'https://www.conateco.it/berth-forecast/')
            self.assertTrue(soup.find(id='tfg-fleet').has_attr('hidden'))
            self.assertIn('https://raw.githubusercontent.com',
              soup.find('meta',attrs={'http-equiv':'Content-Security-Policy'}).get('content'))
    def test_app_uses_verified_public_data_and_disambiguates_booking(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        for marker in (
          "import {evaluateConateco,isConatecoRecent}",
          "function renderCntShipDetails(row,feed)",
          "function renderCntFleet()",
          "async function refreshCntShips(force=false)",
          "raw.githubusercontent.com/pasqualemilano0-rgb/container-booking-web-/main/data/conateco.json",
          "byId('cnt-fleet').hidden=salerno||napoliTerminal!=='cnt'",
          "Il Berth Forecast segnala lo stato della nave",
          "stop_cargo",
          "evaluateConateco(row,cntFeed)",
        ):
            self.assertIn(marker,app)
        self.assertNotIn("localStorage",app)
        self.assertNotIn("fetch(urls.cntBooking",app)
    def test_workflow_every_fifteen_minutes_and_no_private_bookings(self):
        wf=(ROOT/'.github/workflows/pages.yml').read_text(encoding='utf-8')
        self.assertIn("22,37,52 * * * *",wf)
        self.assertIn("scripts.fetch_conateco",wf)
        self.assertIn("data/conateco.json",wf)
        script=(ROOT/'scripts/fetch_conateco.py').read_text(encoding='utf-8')
        self.assertIn('FORECAST_URL',script)
        self.assertNotIn('BOOKING_URL',script)
        self.assertNotIn('id_booking',script)
