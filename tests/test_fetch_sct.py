import unittest
from scripts.fetch_sct import extract_rows,build_snapshot,upstream_timestamp,schedule_columns
from datetime import datetime,timezone
from bs4 import BeautifulSoup
HTML = '''<html><table>
<tr><th>DATE</th><th>E.T.A.</th><th>VESSEL</th><th>VOYAGE</th><th>TRADE</th><th>CLOSING TIME</th><th></th><th></th><th>ACTIONS</th><th>ACCEPTANCE DRY</th><th>ACCEPTANCE REEF</th><th>STATUS</th><th>ACCEPTANCE DRY</th><th>ACCEPTANCE REEF</th></tr>
<tr><td>01/11/2026</td><td>08:00</td><td>MSC ARUSHI R.</td><td>CD644A</td><td>MSC</td><td>31/10/2026 10:00</td><td></td><td></td><td></td><td></td><td></td><td>PENDING</td><td>CARGO ACCEPTED</td><td>CARGO ACCEPTED</td></tr>
<tr><td>02/11/2026</td><td>00:00</td><td>ONE SHIP</td><td>01A</td><td>MSC</td><td>31/10/2026 10:00 CLOSED</td><td></td><td></td><td></td><td></td><td></td><td>DEPARTED</td><td>CARGO ACCEPTED</td><td>NOT ACCEPTED</td></tr>
</table></html>'''
class SctTests(unittest.TestCase):
    def test_parse_rows(self):
        rows=extract_rows(HTML)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['vessel'],'MSC ARUSHI R.')
        self.assertEqual(rows[0]['acceptance_dry'],'CARGO ACCEPTED')
        self.assertEqual(rows[0]['acceptance_reef'],'CARGO ACCEPTED')
        self.assertEqual(rows[1]['status'],'DEPARTED')
        self.assertEqual(rows[1]['acceptance_reef'],'NOT ACCEPTED')
    def test_fail_closed_when_no_table(self):
        self.assertEqual(extract_rows('<p>no vessel data</p>'),[])

    def test_acceptance_column_uses_final_explicit_header(self):
        html=HTML.replace(
          '<td></td><td></td><td>PENDING</td><td>CARGO ACCEPTED</td><td>CARGO ACCEPTED</td>',
          '<td>CARGO ACCEPTED</td><td>NOT ACCEPTED</td><td>PENDING</td>'
          '<td>NOT ACCEPTED</td><td>CARGO ACCEPTED</td>',
          1
        )
        rows=extract_rows(html)
        self.assertEqual(rows[0]['acceptance_dry'],'NOT ACCEPTED')
        self.assertEqual(rows[0]['acceptance_reef'],'CARGO ACCEPTED')
    def test_reordered_headers_are_mapped_not_assumed(self):
        # Changed headers must not be interpreted by positional guessing.
        self.assertEqual(extract_rows(HTML.replace('ACCEPTANCE REEF','MISSING REEF')),[])
    def test_status_and_unknown_acceptance_are_not_invented(self):
        html=HTML.replace('<td>PENDING</td><td>CARGO ACCEPTED</td>',
              '<td>UNKNOWN STATE</td><td>??</td>',1)
        rows=extract_rows(html)
        self.assertEqual(rows[0]['status'],'')
        self.assertEqual(rows[0]['acceptance_dry'],'')
    def test_invalid_calendar_date_is_rejected(self):
        self.assertEqual(len(extract_rows(HTML.replace('01/11/2026','31/02/2026'))),1)
    def test_empty_or_changed_header_rejected(self):
        self.assertEqual(extract_rows('<table><tr><th>VESSEL</th><th>ETA</th></tr></table>'),[])
    def test_snapshot_tracks_acquisition_and_change_separately(self):
        now=datetime(2026,10,31,11,0,tzinfo=timezone.utc)
        rows=extract_rows(HTML)
        prev={'rows':rows,'acquired_at':'2026-10-31T09:00:00+00:00',
              'data_changed_at':'2026-10-30T10:00:00+00:00'}
        payload=build_snapshot(rows,now,prev)
        self.assertEqual(payload['data_changed_at'],prev['data_changed_at'])
        self.assertEqual(payload['acquired_at'],now.isoformat())
        self.assertIsNone(payload['source_updated_at'])
        mutated=[{**row,'acceptance_dry':'NOT ACCEPTED'} for row in rows]
        changed=build_snapshot(mutated,now,prev)
        self.assertEqual(changed['data_changed_at'],now.isoformat())
    def test_snapshot_rejects_large_drop(self):
        rows=extract_rows(HTML)
        prev={'rows':rows*6}
        with self.assertRaises(ValueError):
            build_snapshot(rows[:1],datetime(2026,10,31,tzinfo=timezone.utc),prev)
    def test_no_source_timestamp_without_explicit_notice(self):
        self.assertIsNone(upstream_timestamp(HTML))

if __name__=='__main__':unittest.main()
