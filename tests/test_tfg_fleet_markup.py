import unittest
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]

class TfgFleetMarkupTests(unittest.TestCase):
    def test_napoli_fleet_present_in_both_pages(self):
        for name in ('index.html','salerno-v03.html'):
            soup=BeautifulSoup((ROOT/name).read_text(encoding='utf-8'),'html.parser')
            fleet=soup.find(id='tfg-fleet')
            self.assertIsNotNone(fleet)
            for field in ('tfg-feed-alert','tfg-vessel-list','tfg-ship-filter',
                          'tfg-vessel-count','tfg-show-more','tfg-feed-updated','tfg-reload'):
                self.assertIsNotNone(fleet.find(id=field),field)
            self.assertTrue(fleet.find('a',href='https://tfg.bucci.it/@/TFGW_TP_ETA'))
            self.assertIn('Container Booking Web · v0.' if name=='index.html' else 'v0.17',
                          soup.get_text())
            script=soup.find('script',type='module').get('src')
            if name=='index.html':
                self.assertTrue(script.startswith('app.js?v=20'),script)
            else:
                self.assertIn('20261101-v61',script)

    def test_napoli_and_salerno_switch_safe(self):
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        for fragment in (
            "byId('tfg-fleet').hidden=salerno||napoliTerminal!=='tfg'",
            "autoRefreshActiveTerminal(true);",
            "if(term==='tfg')void refreshTfgShips(true);",
            "if(selectedPort!=='napoli')return;",
            "selectedPort!=='napoli')return",
            "tfgList.addEventListener('click'",
            "evaluateTfgSchedule(row,tfgFeed)",
            "loadTfgSnapshot()",
            "ATTENZIONE: copia del programma TFG non acquisita recentemente",
        ):
            self.assertIn(fragment,app)
        self.assertNotIn('verify=False',app)
        self.assertNotIn('localStorage',app)

    def test_tfg_data_schema_and_uncertainty_not_tied_to_fixture(self):
        from json import loads
        feed=loads((ROOT/'data/tfg_schedule.json').read_text(encoding='utf-8'))
        self.assertIsInstance(feed.get('rows'),list)
        self.assertIn('source_updated_at',feed)
        self.assertIn('acquired_at',feed)
        app=(ROOT/'app.js').read_text(encoding='utf-8')
        self.assertIn("isTfgFeedFresh(tfgFeed)",app)
        self.assertIn("ATTENZIONE: copia del programma TFG non acquisita recentemente",app)
