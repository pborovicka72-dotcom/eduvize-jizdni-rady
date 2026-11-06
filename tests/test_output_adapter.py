import copy,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
from eduvize_transport.output_adapter import get_output_adapters,validate
CORE=Path(os.environ['EDUVIZE_OUTPUT_CORE'])
spec=importlib.util.spec_from_file_location('core_tests',CORE/'tests/test_output_api.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
PAYLOAD=dict(source='pid',stops=['A'],types=['bus'],minutes=60,limit=25,pageSeconds=10)
class TransportOutput(unittest.TestCase):
 def setUp(self):
  self.b=core.Outputs('runTest');self.b.setUp();self.b.registry.adapters.update(get_output_adapters())
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'national/shards').mkdir(parents=True)
  for name in ('stops.json','national/stops.json'):(self.root/name).write_text(json.dumps({'stops':['A'],'coordinates':{'A':[[50,14]]}}))
  self.env=patch.dict(os.environ,EDUVIZE_TRANSPORT_DATA_DIR=str(self.root));self.env.start()
  assembly=self.b.call('POST','/api/v1/output-assemblies',dict(schemaVersion=1,appId='transport',profileId=self.b.profile)).json()
  self.b.body.update(appId='transport',assemblyId=assembly['id']);self.b.body['draft']['payload']=copy.deepcopy(PAYLOAD)
 def tearDown(self):self.env.stop();self.tmp.cleanup();self.b.tearDown()
 def test_publication_draft_stable_link_isolation_and_revoke(self):
  b=self.b;id=b.create()['id'];url='/api/public/v1/outputs/'+id
  self.assertEqual(b.client.get(url).status_code,404);pub=b.publish(id)
  self.assertEqual(b.client.get('/o/'+id,follow_redirects=False).headers['location'],'/eduvize-jizdni-rady/published.html?edu-output='+id)
  self.assertEqual(b.call('GET','/api/v1/outputs/'+id,actor='test-b').status_code,404)
  draft=copy.deepcopy(b.body['draft']);draft['payload']['minutes']=120
  b.call('PUT','/api/v1/outputs/'+id+'/draft',dict(expectedRevision=1,draft=draft));self.assertEqual(b.client.get(url).json()['payload']['minutes'],60)
  for _ in range(2):self.assertEqual(b.call('GET','/api/v1/outputs/'+id+'/link').json()['url'],pub['url'])
  self.assertEqual(b.publish(id,2)['url'],pub['url'])
  b.call('POST','/api/v1/outputs/'+id+'/revoke',dict(expectedRevision=3));self.assertEqual(b.client.get(url+'/data').status_code,410)
 def test_scoped_live_ignores_query_and_strips_private_fields(self):
  b=self.b;id=b.create()['id'];b.publish(id);at=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()
  row=dict(stop_name='A',scheduled_at=at,predicted_at=None,realtime_available=False,delay_seconds=None,route_type=3,line='1',destination='Terminal',connectionId='secret')
  with patch('eduvize_transport.pid.fetch_board',return_value=([row],datetime.now(timezone.utc).isoformat())) as fetch:r=b.client.get('/api/public/v1/outputs/'+id+'/data?stops=Foreign&minutes=720')
  self.assertEqual(r.status_code,200,r.text);fetch.assert_called_once_with('A',60);self.assertNotIn('secret',r.text);self.assertIsNone(r.json()['data']['departures'][0]['delay_seconds'])
 def test_empty_board_is_not_fallback(self):
  b=self.b;id=b.create()['id'];b.publish(id)
  with patch('eduvize_transport.pid.fetch_board',return_value=([],datetime.now(timezone.utc).isoformat())):r=b.client.get('/api/public/v1/outputs/'+id+'/data')
  self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['complete']);self.assertEqual(r.json()['data']['plannedStops'],[])
 def test_ambiguous_position_fails_closed(self):
  (self.root/'national/stops.json').write_text(json.dumps({'stops':['A'],'coordinates':{'A':[[49,14]]}}));b=self.b;id=b.create()['id'];b.publish(id)
  with patch('eduvize_transport.pid.fetch_board',side_effect=RuntimeError('offline')):r=b.client.get('/api/public/v1/outputs/'+id+'/data')
  self.assertEqual(r.status_code,503,r.text)
 def test_payload_rejects_secret_url_and_invalid_types(self):
  for p in [{**PAYLOAD,'url':'https://example.org'},{**PAYLOAD,'minutes':True},{**PAYLOAD,'stops':['A|B']},{**PAYLOAD,'source':'other'}]:
   with self.assertRaises(ValueError):validate(p,{})
 def test_pid_denied_does_not_serve_fallback(self):
  from fastapi import HTTPException
  b=self.b;id=b.create()['id'];b.publish(id)
  with patch('eduvize_transport.pid.fetch_board',side_effect=HTTPException(403,'denied')):r=b.client.get('/api/public/v1/outputs/'+id+'/data')
  self.assertEqual(r.status_code,503,r.text)
 def test_unknown_stop_cannot_be_published(self):
  self.b.body['draft']['payload']['stops']=['Foreign'];id=self.b.create()['id']
  r=self.b.call('POST','/api/v1/outputs/'+id+'/publish',dict(expectedRevision=0));self.assertEqual(r.status_code,422,r.text)
 def test_source_age_and_unknown_delay_survive_national_fallback(self):
  import gzip,hashlib
  from zoneinfo import ZoneInfo
  now=datetime.now(timezone.utc);future=now+timedelta(minutes=5);local=future.astimezone(ZoneInfo('Europe/Prague'));day=local.strftime('%Y%m%d')
  stamp=(now-timedelta(days=2)).isoformat();feed=dict(schemaVersion=1,generated_at=stamp,stops={'A':[[local.hour*3600+local.minute*60+local.second,0,'stop']]},trips=[['trip','service','123',3,'Terminal']],services={'service':dict(start=day,end=day,days=[1]*7)})
  key=hashlib.sha256(b'A').hexdigest()[:2]
  with gzip.open(self.root/'national/shards'/f'{key}.json.gz','wt') as f:json.dump(feed,f)
  b=self.b;id=b.create()['id'];b.publish(id)
  with patch('eduvize_transport.pid.fetch_board',side_effect=RuntimeError('offline')):r=b.client.get('/api/public/v1/outputs/'+id+'/data')
  self.assertEqual(r.status_code,200,r.text);d=r.json();self.assertEqual(d['observedAt'],stamp);self.assertEqual(d['data']['plannedStops'],['A']);self.assertEqual(len(d['data']['departures']),1);self.assertIsNone(d['data']['departures'][0]['delay_seconds']);self.assertFalse(d['data']['departures'][0]['realtime_available'])
 def test_two_profiles_keep_distinct_snapshots_and_live_selection(self):
  b=self.b;first=b.create()['id'];first_url=b.publish(first)['url'];second_profile='d'*32
  b.registry.profile_owner=lambda p:b.school if p in (b.profile,second_profile) else b.other
  for name in ('stops.json','national/stops.json'):(self.root/name).write_text(json.dumps({'stops':['A','B'],'coordinates':{'A':[[50,14]],'B':[[49,15]]}}))
  assembly=b.call('POST','/api/v1/output-assemblies',dict(schemaVersion=1,appId='transport',profileId=second_profile)).json()
  b.body.update(profileId=second_profile,assemblyId=assembly['id']);b.body['draft']['payload']['stops']=['B'];second=b.create()['id'];b.publish(second)
  self.assertEqual(b.client.get('/api/public/v1/outputs/'+first).json()['payload']['stops'],['A']);self.assertEqual(b.client.get('/api/public/v1/outputs/'+second).json()['payload']['stops'],['B'])
  with patch('eduvize_transport.pid.fetch_board',return_value=([],datetime.now(timezone.utc).isoformat())) as board:
   self.assertEqual(b.client.get('/api/public/v1/outputs/'+first+'/data?profileId='+second_profile).status_code,200)
   self.assertEqual(b.client.get('/api/public/v1/outputs/'+second+'/data').status_code,200)
  self.assertEqual([c.args[0] for c in board.call_args_list],['A','B'])
  b.color='#223344';self.assertEqual(b.client.get('/api/public/v1/outputs/'+first+'/theme').json()['colors']['primary'],b.color)
  self.assertEqual(b.call('GET','/api/v1/outputs/'+first+'/link').json()['url'],first_url)
 def test_national_after_midnight_honors_calendar_exceptions(self):
  import gzip,hashlib
  from eduvize_transport.output_adapter import national_read
  feed={'schemaVersion':1,'generated_at':'2026-11-01T00:00:00Z','stops':{'A':[[90600,0,'stop']]},'trips':[['trip','service','123',3,'Terminal']],'services':{'service':{'start':'20260101','end':'20261231','days':[1,1,1,1,1,0,0],'exceptions':{'20261101':1,'20261102':2}}}}
  key=hashlib.sha256(b'A').hexdigest()[:2]
  with gzip.open(self.root/'national/shards'/f'{key}.json.gz','wt') as f:json.dump(feed,f)
  rows,stamp=national_read(self.root,'A',60,datetime(2026,11,2,0,tzinfo=timezone.utc));self.assertEqual(len(rows),1);self.assertEqual(rows[0]['scheduled_at'],'2026-11-02T00:10:00+00:00')
  rows,_=national_read(self.root,'A',60,datetime(2026,11,3,0,tzinfo=timezone.utc));self.assertEqual(rows,[])
