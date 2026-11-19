const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {gzipSync}=require('node:zlib');
const {Response}=globalThis;
function reader(){
 let manifestRequests=0,shardRequests=0;
 const generated_at='2026-10-23T00:00:00Z',feed_version='fixture-2026',generation_id='a'.repeat(64);
 const manifest={schemaVersion:1,source:'cz_gtfs',generation_id,source_sha256:'b'.repeat(64),feed_version,generated_at};
 const feed={schemaVersion:1,generated_at,feed_version,stops:{Test:[[90600,0,'S1']]},trips:[['T1','calendar','123',3,'Terminal']],services:{calendar:{start:'20260101',end:'20261231',days:[1,1,1,1,1,0,0],exceptions:{'20261101':1,'20261102':2}}}};
 const context={Intl,Date,Map,Set,TextEncoder,crypto:webcrypto,Response,DecompressionStream,fetch:async url=>{
  if(url==='./data/national/manifest.json'){manifestRequests++;return Response.json(manifest);}
  assert.match(url,/^\.\/data\/national\/shards\/[a-f0-9]{2}\.json\.gz\?generation=a{64}$/);
  shardRequests++;return new Response(gzipSync(JSON.stringify(feed)));
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../transport-national.js','utf8'),context);
 return {api:context.EduvizeTransportNational,requests:()=>({manifest:manifestRequests,shard:shardRequests})};
}
test('Prague midnight is independent of device timezone, in winter and summer',()=>{
 const {api}=reader();assert.equal(new Date(api.midnight(2026,11,1)).toISOString(),'2026-10-31T23:00:00.000Z');assert.equal(new Date(api.midnight(2026,7,1)).toISOString(),'2026-06-30T22:00:00.000Z');
});
test('25:10 belongs to previous service date and honors added Sunday service',async()=>{
 const {api,requests}=reader();const now=Date.parse('2026-11-02T00:00:00Z');const first=await api.read(['Test'],60,now);assert.equal(first.departures.length,1);assert.equal(first.departures[0].scheduled_at,'2026-11-02T00:10:00.000Z');assert.equal(first.departures[0].destination,'Terminal');await api.read(['Test'],60,now);assert.deepEqual(requests(),{manifest:2,shard:1});
});
test('Removed Monday service does not depart on Tuesday after midnight',async()=>{
 const {api}=reader();const result=await api.read(['Test'],60,Date.parse('2026-11-03T00:00:00Z'));assert.equal(result.departures.length,0);assert.equal(result.known_stops[0],'Test');
});
