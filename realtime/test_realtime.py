import unittest
from realtime import normalize

class RealtimeTests(unittest.TestCase):
    def item(self, available=True, canceled=False):
        return {'departure_timestamp':{'scheduled':'2026-11-01T01:00:00+01:00','predicted':'2026-11-01T01:05:00+01:00'},'delay':{'is_available':available,'seconds':300},'trip':{'id':'trip','headsign':'Cíl','is_canceled':canceled},'stop':{'id':'U1'},'route':{'short_name':'905','type':3}}
    def test_delay_and_stop_identity(self):
        d=normalize({'stops':[{'stop_id':'U1','stop_name':'Muzeum'}],'departures':[self.item()]},'Muzeum')[0]
        self.assertEqual(d['delay_seconds'],300)
        self.assertEqual(d['stop_id'],'U1')
        self.assertEqual(d['stop_name'],'Muzeum')
        self.assertEqual(d['predicted_at'],'2026-11-01T01:05:00+01:00')
    def test_unknown_is_not_on_time(self):
        d=normalize({'departures':[self.item(False)]},'Muzeum')[0]
        self.assertIsNone(d['delay_seconds'])
        self.assertIsNone(d['predicted_at'])
    def test_cancellation(self):
        self.assertTrue(normalize({'departures':[self.item(canceled=True)]},'Muzeum')[0]['is_canceled'])
    def test_bad_timestamp_skipped(self):
        d=self.item();d['departure_timestamp']['scheduled']='bad'
        self.assertEqual(normalize({'departures':[d]},'Muzeum'),[])

if __name__=='__main__':unittest.main()
