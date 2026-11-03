import unittest
from scripts.fetch_conateco import parse_terminal_date,normalize_public_row,build_rows

def example(**extra):
    data={
      'nome_nave':'MSC GRETA III','viaggioimbarco':'AC643A','id_viaggio':'202600358',
      'data_previ':'2026-11-02','ora_previs':'00.00','cod_stato':'PRE',
      'accettaCarico':'1','iconaStatoNave':'ACCETTA_CARICO',
      'stopcarico':'','accettazioneesterni':'','tdtac1':'20261027','torac1':'12:00',
      'tdtcd1':'20261102','torcd1':'17:00','note':'','note2':'','nome_armatore':'TEST LINE'
    }
    data.update(extra)
    return data
def cats(p=None,r=None,o=None,d=None):
    return {'PRESENTI':p or [],'PREVISTE':r or [],
            'ORMEGGIATE':o or [],'PARTITE':d or []}
class ConatecoForecastTests(unittest.TestCase):
    def test_parse_public_columns_and_cutoff(self):
        row=normalize_public_row(example(),'PREVISTE')
        self.assertEqual(row['vessel'],'MSC GRETA III')
        self.assertEqual(row['voyage'],'AC643A')
        self.assertEqual(row['eta'],'2026-11-02 00:00')
        self.assertEqual(row['closing'],'2026-11-02 17:00')
        self.assertEqual(row['opening'],'2026-10-27 12:00')
        self.assertEqual(row['acceptance_flag'],'1')
        self.assertEqual(row['acceptance_icon'],'ACCETTA_CARICO')
    def test_blocked_or_departed_preserved_as_negative_information(self):
        r=normalize_public_row(example(accettaCarico='0',
                iconaStatoNave='NO_ACCETTA_CARICO',stopcarico='S'),'ORMEGGIATE')
        self.assertEqual(r['acceptance_flag'],'0')
        self.assertEqual(r['stop_cargo'],'S')
        self.assertEqual(r['category'],'ORMEGGIATE')
    def test_duplicate_same_voyage_deduplicated(self):
        data=build_rows(cats(p=[example()],o=[example()]))
        self.assertEqual(len(data),1)
        self.assertEqual(data[0]['category'],'ORMEGGIATE')
        self.assertFalse(data[0]['source_conflict'])
    def test_conflicting_duplicate_fails_closed(self):
        data=build_rows(cats(p=[example()],o=[example(stopcarico='S')]))
        self.assertEqual(len(data),1)
        self.assertTrue(data[0]['source_conflict'])
    def test_missing_dates_never_misleading(self):
        self.assertEqual(parse_terminal_date('0','00:00'),'')
        self.assertEqual(parse_terminal_date('20260230','12:00'),'')
        self.assertEqual(parse_terminal_date('20261102','25:00'),'')
        self.assertIsNone(normalize_public_row(example(data_previ='bad'),'PREVISTE'))
    def test_unknown_flags_will_not_be_normalized_positive(self):
        self.assertEqual(normalize_public_row(example(accettaCarico='2'),'PREVISTE')['acceptance_flag'],'')
        self.assertEqual(normalize_public_row(example(iconaStatoNave='MYSTERY'),'PREVISTE')['acceptance_icon'],'')
    def test_no_customer_booking_data_exported(self):
        row=normalize_public_row(example(B_BOOKING='PRIVATE123'),'PREVISTE')
        self.assertNotIn('B_BOOKING',row)
        self.assertNotIn('id_booking',row)
    def test_external_depot_flag_is_preserved_without_inventing_address(self):
        row=normalize_public_row(example(accettazioneesterni='S',note='ACCETT.RETROPORTO'),'PREVISTE')
        self.assertEqual(row['external_depot'],'S')
        self.assertIn('ACCETT.RETROPORTO',row['notes'])
        self.assertNotIn('delivery_address',row)
    def test_conflicting_external_depot_signals_fail_closed(self):
        data=build_rows(cats(p=[example(accettazioneesterni='S')],
                             o=[example(accettazioneesterni='')]))
        self.assertEqual(len(data),1)
        self.assertTrue(data[0]['source_conflict'])
    def test_bad_shape_rejected(self):
        with self.assertRaises(ValueError):
            build_rows({'PREVISTE':{}})
