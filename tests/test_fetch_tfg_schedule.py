import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep
from unittest.mock import patch
from scripts import fetch_tfg_schedule
from scripts.fetch_tfg_schedule import parse_tfg_html

def row(name, dep, acceptance, cutoff="", destination="INTERNO PORTO", arr="644E", custom_close=""):
    values=[
        "05/11/26", "", "", "", name, arr, "05/11/26", "", dep,
        custom_close, acceptance, cutoff, destination, "26/0174", "ITNAP", "", "", "MEDOV"
    ]
    return "<tr>"+"".join("<td>"+v+"</td>" for v in values)+"</tr>"

HEADER="<tr>"+"".join("<th>"+x+"</th>" for x in (
    "E.T.A.","E.T.B.","VESSEL","ARR.VOY","E.T.S.","DEPT.VOY",
    "CUSTOM CLOSE TIME","ACCETTA CARICO","Fast Corridor CUT OFF","TERMINAL DI CONSEGNA"
))+"</tr>"
PREFIX="<html><p>Ultimo aggiornamento: 30/10/2026 alle 11:21:14</p><table>"+HEADER

class TfgPublicScheduleTests(unittest.TestCase):
    def test_parse_departure_and_acceptance(self):
        html=PREFIX + row("X PRESS SAGARMALA","645W","CARICO DAL 30/10/26 08:00:00") + "</table></html>"
        data=parse_tfg_html(html)
        self.assertEqual(len(data["rows"]),1)
        item=data["rows"][0]
        self.assertEqual(item["vessel"],"X PRESS SAGARMALA")
        self.assertEqual(item["arrival_voyage"],"644E")
        self.assertEqual(item["departure_voyage"],"645W")
        self.assertEqual(item["destination"],"INTERNO PORTO")
        self.assertEqual(item["acceptance"],"CARICO DAL 30/10/26 08:00:00")
        self.assertEqual(data["source_updated_at"],"2026-10-30T11:21:14+01:00")
    def test_delivery_place_dryport_other_and_unknown(self):
        for value,expected in (("DRYPORT","DRYPORT"),("DRY PORT","DRYPORT"),
                               ("EX SUD CONTAINER","EX SUD CONTAINER"),
                               ("RETROPORTO","RETROPORTO"),
                               ("TERMINAL AREA B","TERMINAL AREA B"),
                               ("LUOGO NON PUBBLICATO","")):
            with self.subTest(value=value):
                html=PREFIX+row("ARGENTINIAN","0HWL8E1MA","ACCETTA CARICO",
                                destination=value)+"</table></html>"
                self.assertEqual(parse_tfg_html(html)["rows"][0]["destination"],expected)

    def test_unchanged_schedule_still_records_successful_acquisition(self):
        html=PREFIX+row("X PRESS SAGARMALA","645W","CARICO DAL 30/10/26 08:00:00")+"</table></html>"
        with TemporaryDirectory() as directory:
            path=Path(directory)/"tfg_schedule.json"
            with patch.object(fetch_tfg_schedule,"OUT",path), patch.object(
                fetch_tfg_schedule,"fetch_verified_tfg_html",return_value=html):
                fetch_tfg_schedule.main()
                first=json.loads(path.read_text(encoding="utf-8"))
                sleep(0.01)
                fetch_tfg_schedule.main()
                second=json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(first["rows"],second["rows"])
        self.assertEqual(first["source_updated_at"],second["source_updated_at"])
        self.assertGreater(second["acquired_at"],first["acquired_at"])

    def test_non_accetta_is_not_positive(self):
        data=parse_tfg_html(PREFIX+row("HANNA","AGA040S19","NON ACCETTA CARICO",destination="LUOGO APPROVATO")+"</table></html>")
        self.assertEqual(data["rows"][0]["acceptance"],"NON ACCETTA CARICO")
        self.assertEqual(data["rows"][0]["destination"],"LUOGO APPROVATO")
    def test_fast_corridor_is_not_general_cutoff(self):
        html = PREFIX + row("ARGENTINIAN","0HWL8E1MA","ACCETTA CARICO",
                            cutoff="30/10/26 11:00:00",custom_close="02/11/26 15:00:00") + "</table></html>"
        item = parse_tfg_html(html)["rows"][0]
        self.assertEqual(item["custom_close_time"],"02/11/26 15:00:00")
        self.assertEqual(item["fast_corridor_cut_off"],"30/10/26 11:00:00")
        self.assertEqual(item["gate_cut_off"],"")
        self.assertNotIn("cut_off",item)

    def test_missing_timestamp_rejected(self):
        with self.assertRaises(ValueError):
            parse_tfg_html(PREFIX.replace("Ultimo aggiornamento: 30/10/2026 alle 11:21:14","Aggiornamento sconosciuto")+row("HANNA","AGA040S19","ACCETTA CARICO")+"</table></html>")
    def test_changed_header_rejected(self):
        with self.assertRaises(ValueError):
            parse_tfg_html(PREFIX.replace("DEPT.VOY","UNKNOWN")+row("HANNA","AGA040S19","ACCETTA CARICO")+"</table></html>")
    def test_no_valid_rows_rejected(self):
        with self.assertRaises(ValueError):
            parse_tfg_html(PREFIX+"</table></html>")
