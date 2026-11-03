"""Official terminal logo integration checks (no remote image dependencies)."""
import struct
import unittest
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
SOURCES={
    "cnt":"assets/terminal-logos/conateco.png",
    "tfg":"assets/terminal-logos/tfg-portal.png",
    "sct":"assets/terminal-logos/sct-compact.png",
}

class TerminalLogoTests(unittest.TestCase):
    def test_authentic_local_pngs_exist_and_are_not_empty(self):
        for terminal,path in SOURCES.items():
            full=ROOT/path
            self.assertTrue(full.is_file(),terminal)
            content=full.read_bytes()
            self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"),terminal)
            self.assertLess(len(content),80_000,terminal)
            width,height=struct.unpack(">II",content[16:24])
            self.assertGreater(width,28,terminal)
            self.assertGreater(height,28,terminal)
    def test_both_pages_keep_correct_terminal_logos_and_safe_source_links(self):
        for page in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/page).read_text(encoding="utf-8"),"html.parser")
            is_driver_ui=page=="index.html"
            for key,path in SOURCES.items():
                images=soup.select(f'img.terminal-logo[src="{path}"]')
                minimum=(0 if key=="sct" else 2) if is_driver_ui else 2
                self.assertGreaterEqual(len(images),minimum,key)
                for img in images:
                    self.assertEqual(img.get("alt"),"",f"{page}/{key} decorative alt")
                    self.assertTrue(img.get("width") and img.get("height"))
            port=soup.find("fieldset",class_="ports")
            self.assertTrue(port.find('input',{"name":"port","value":"napoli"}))
            self.assertTrue(port.find('input',{"name":"port","value":"salerno"}))
            tabs=soup.find(id="napoli-terminal-switch")
            for terminal in ("cnt","tfg"):
                tab=tabs.find("input",{"value":terminal}).parent
                self.assertIsNotNone(tab.select_one(f'img[src="{SOURCES[terminal]}"]'))
                selector=soup.find(id=f"{terminal}-fleet").select_one(".terminal-heading")
                self.assertIsNotNone(selector.select_one(f'img[src="{SOURCES[terminal]}"]'))
            if is_driver_ui:
                self.assertIsNotNone(soup.find(id="sct-search-btn"))
                self.assertIsNotNone(soup.find(id="sct-vessel-results"))
            else:
                self.assertIsNotNone(port.select_one(f'img[src="{SOURCES["sct"]}"]'))
                selector=soup.find(id="sct-picker").select_one(".terminal-heading")
                self.assertIsNotNone(selector.select_one(f'img[src="{SOURCES["sct"]}"]'))
            csp=soup.find("meta",{"http-equiv":"Content-Security-Policy"}).get("content")
            self.assertIn("img-src 'self' data:",csp)
            self.assertRegex(soup.get_text(),r'Container Booking Web · v0\.\d+' if is_driver_ui else r'v0\.17')
    def test_avoid_reusing_logo_for_unrelated_terminal(self):
        for page in ("index.html","salerno-v03.html"):
            soup=BeautifulSoup((ROOT/page).read_text(encoding="utf-8"),"html.parser")
            self.assertIsNone(soup.find(id="cnt-fleet").select_one(f'img[src="{SOURCES["tfg"]}"]'))
            self.assertIsNone(soup.find(id="tfg-fleet").select_one(f'img[src="{SOURCES["cnt"]}"]'))
            self.assertIsNone(soup.find(id="sct-picker").select_one(f'img[src="{SOURCES["cnt"]}"]'))
    def test_logo_identification_is_not_terminal_authorization(self):
        doc=(ROOT/"README.md").read_text(encoding="utf-8")
        self.assertIn("senza affiliazione",doc.lower())
        self.assertIn("autorizzazioni d'ingresso",doc)

if __name__=="__main__":
    unittest.main()
