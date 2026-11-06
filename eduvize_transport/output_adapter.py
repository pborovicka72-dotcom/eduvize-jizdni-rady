"""Trusted transport adapter for the shared output registry. No application registry."""
import copy
import gzip
import hashlib
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from eduvize_admin.output_registry import Adapter, OutputError

TYPES={'bus','tram','metro','train','ferry','funicular'}
ZONE=ZoneInfo('Europe/Prague')

def validate(payload,presentation):
    keys={'source','stops','types','minutes','limit','pageSeconds'}
    if not isinstance(payload,dict) or set(payload)!=keys:raise ValueError('Invalid transport payload')
    if payload['source'] not in ('pid','cz_gtfs'):raise ValueError('Unknown transport source')
    stops=payload['stops'];types=payload['types']
    if not isinstance(stops,list) or not 1<=len(stops)<=20 or any(not isinstance(s,str) or not s.strip() or s!=s.strip() or len(s)>100 or '|' in s for s in stops) or len(set(stops))!=len(stops):raise ValueError('Invalid stops')
    if not isinstance(types,list) or not types or any(not isinstance(t,str) or t not in TYPES for t in types) or len(set(types))!=len(types):raise ValueError('Invalid types')
    for key,lo,hi in [('minutes',1,720),('limit',1,100),('pageSeconds',3,120)]:
        if type(payload[key]) is not int or not lo<=payload[key]<=hi:raise ValueError('Invalid numeric setting')
    return copy.deepcopy(payload)

def data_root():
    value=os.getenv('EDUVIZE_TRANSPORT_DATA_DIR')
    if not value:raise OutputError(503,'DEPENDENCY_UNAVAILABLE','Dopravní data nejsou nakonfigurována.')
    return Path(value)

def catalog(root,national=False):
    return json.loads((root/('national/stops.json' if national else 'stops.json')).read_text())

def linked(name,a,b):
    def points(c):return c.get('coordinates',{}).get(name,[])
    def distance(p,q):
        lat1,lat2=map(math.radians,[p[0],q[0]]);dlat=lat2-lat1;dlon=math.radians(q[1]-p[1])
        return 12742000*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)))
    x,y=points(a),points(b)
    if not x or not y or name not in a['stops'] or name not in b['stops']:return False
    if any(not isinstance(p,list) or len(p)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p) or abs(p[0])>90 or abs(p[1])>180 for p in x+y):return False
    return all(any(distance(p,q)<=150 for q in y) for p in x) and all(any(distance(p,q)<=150 for q in x) for p in y)

def national_read(root,name,minutes,now):
    key=hashlib.sha256(name.encode()).hexdigest()[:2]
    with gzip.open(root/'national/shards'/f'{key}.json.gz','rt') as f:feed=json.load(f)
    if feed.get('schemaVersion')!=1:raise ValueError('Unsupported feed')
    rows=feed['stops'].get(name)
    if rows is None:raise ValueError('Unknown stop')
    result=[];today=now.astimezone(ZONE).date();until=now+timedelta(minutes=minutes)
    lookback=max(1,math.ceil(max((r[0] for r in rows),default=0)/86400))
    for offset in range(-lookback,math.ceil(minutes/1440)+1):
        date=today+timedelta(days=offset);day=date.strftime('%Y%m%d')
        for seconds,index,stop_id in rows:
            trip=feed['trips'][index];service=feed['services'][trip[1]];exception=service.get('exceptions',{}).get(day)
            active=exception==1 if exception is not None else service['start']<=day<=service['end'] and service['days'][date.weekday()]
            at=(datetime.combine(date,datetime.min.time())+timedelta(seconds=seconds)).replace(tzinfo=ZONE).astimezone(timezone.utc)
            if active and now<=at<=until:result.append(dict(stop_name=name,stop_id=stop_id,trip_id=trip[0],line=trip[2],route_type=trip[3],destination=trip[4],scheduled_at=at.isoformat(),predicted_at=None,delay_seconds=None,realtime_available=False,is_canceled=False))
    return result,feed['generated_at']

def kind(row):return {0:'tram',1:'metro',2:'train',3:'bus',4:'ferry',5:'funicular',6:'funicular',7:'funicular'}.get(row.get('route_type'),'bus')

def prepare(actor,payload,connection):
    root=data_root();c=catalog(root,payload['source']=='cz_gtfs')
    if any(s not in c['stops'] for s in payload['stops']):raise ValueError('Unknown stop')
    return copy.deepcopy(payload),[]

def live(record,request):
    # Only the immutable published snapshot supplies selection; request query is ignored.
    config=json.loads(record['snapshot'])['payload'];root=data_root();now=datetime.now(timezone.utc)
    try:a,b=catalog(root),catalog(root,True)
    except (OSError,ValueError):raise OutputError(503,'DEPENDENCY_UNAVAILABLE','Katalog dopravy není dostupný.') from None
    rows=[];timestamps=[];missing=[];planned=[]
    from .pid import fetch_board
    from fastapi import HTTPException
    from concurrent.futures import ThreadPoolExecutor
    def read_one(name):
        verified=linked(name,a,b)
        if name in a['stops'] and (config['source']=='pid' or verified):
            try:
                items,stamp=fetch_board(name,config['minutes'])
                return name,items,stamp,False
            except HTTPException as error:
                if error.status_code in (401,403):raise OutputError(503,'DEPENDENCY_UNAVAILABLE','Přístup ke zdroji PID není dostupný.') from None
            except Exception:pass
        if name in b['stops'] and (config['source']=='cz_gtfs' or verified):
            try:
                items,stamp=national_read(root,name,config['minutes'],now)
                return name,items,stamp,True
            except (OSError,ValueError,KeyError,TypeError):pass
        return name,None,None,False
    # Bounded parallelism keeps multi-stop PID outages within the shared client's deadline.
    # At most two 4-second internal-service waves for the 20-stop payload limit.
    with ThreadPoolExecutor(max_workers=min(10,len(config['stops']))) as pool:
        results=list(pool.map(read_one,config['stops']))
    for name,items,stamp,is_planned in results:
        if items is None:missing.append(name)
        else:
            timestamps.append(stamp);rows.extend(items)
            if is_planned:planned.append(name)
    if not timestamps:raise OutputError(503,'DEPENDENCY_UNAVAILABLE','Odjezdy nejsou dostupné.')
    now=datetime.now(timezone.utc)
    observed=min(datetime.fromisoformat(s.replace('Z','+00:00')) for s in timestamps)
    def at(r):return datetime.fromisoformat(((r.get('predicted_at') if r.get('realtime_available') else None) or r['scheduled_at']).replace('Z','+00:00'))
    # Retain source provenance and never turn an unknown delay into zero.
    rows=[r for r in rows if r['stop_name'] in config['stops'] and kind(r) in config['types'] and now<=at(r)<=now+timedelta(minutes=config['minutes'])]
    rows.sort(key=at)
    return dict(schemaVersion=1,observedAt=observed.isoformat(),fetchedAt=now.isoformat(),stale=any(now-datetime.fromisoformat(stamp.replace('Z','+00:00'))>(timedelta(days=10) if is_planned else timedelta(seconds=60)) for _,items,stamp,is_planned in results if items is not None),complete=not missing,data={'departures':rows[:config['limit']],'missingStops':missing,'plannedStops':planned})

def live_validate(value):
    # Public rows are allowlisted; no provider/private connection metadata can leak.
    result=copy.deepcopy(value);allowed={'stop_name','stop_id','trip_id','line','route_type','destination','scheduled_at','predicted_at','delay_seconds','realtime_available','is_canceled'}
    result['data']['departures']=[{k:v for k,v in row.items() if k in allowed} for row in result['data']['departures']]
    return result

def get_output_adapters():
    return {'transport':Adapter(validate,'/eduvize-jizdni-rady/published.html',prepare=prepare,live_response=live,live_validate=live_validate)}
