const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');
function setup({live='fail',far=false}={}){
 const calls=[];const pid={stops:['A'],coordinates:{A:[[50,14]]}};const national={stops:['A','B'],coordinates:{A:[[far?49:50,14]],B:[[49,15]]}};
 const c={fetch:async url=>({ok:true,json:async()=>url.includes('national')?national:pid}),EduvizeTransportRealtime:{read:async names=>{calls.push(names[0]);if(live==='fail')throw Error('offline');return {known_stops:names,departures:live==='empty'?[]:[{stop_name:'A',realtime_available:true,delay_seconds:0}]}}},EduvizeTransportNational:{read:async names=>({known_stops:names,generated_at:'2026-11-01T00:00:00Z',departures:[{stop_name:names[0],realtime_available:true,delay_seconds:0,predicted_at:'invalid'}]})}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../transport-sources.js','utf8'),c);return {api:c.EduvizeTransportSources,calls};
}
test('PID outage uses verified national stop and removes all realtime claims',async()=>{const {api}=setup();const d=await api.read(['A'],60,'pid');assert.equal(d.departures.length,1);assert.equal(d.departures[0].realtime_available,false);assert.equal(d.departures[0].delay_seconds,null);assert.equal(d.departures[0].predicted_at,null)});
test('same name at different position is never a fallback',async()=>{const {api}=setup({far:true});const d=await api.read(['A'],60,'pid');assert.equal(d.departures.length,0);assert.equal(d.failed_stops[0],'A')});
test('national selection uses verified PID, national-only stop stays planned',async()=>{const {api,calls}=setup({live:'ok'});const d=await api.read(['A','B'],60,'cz_gtfs');assert.deepEqual(calls,['A']);assert.equal(d.departures[0].realtime_available,true);assert.equal(d.departures[1].realtime_available,false)});
test('successful empty live board is not replaced by scheduled trips',async()=>{const {api}=setup({live:'empty'});const d=await api.read(['A'],60,'pid');assert.equal(d.departures.length,0);assert.equal(d.known_stops[0],'A');assert.equal(d.planned_stops.length,0)});
