/* National planned departures. Never send release-local GTFS IDs to PID realtime. */
(function(root){
'use strict';
const cache=new Map();
const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(date){return Object.fromEntries(local.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))}
function midnight(year,month,day){const target=Date.UTC(year,month-1,day);let value=target;for(let i=0;i<3;i++){const p=parts(new Date(value));value+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)}return value}
function active(service,date){const key=date.toISOString().slice(0,10).replaceAll('-','');const exception=service.exceptions?.[key];return exception!==undefined?exception===1:key>=service.start&&key<=service.end&&Boolean(service.days[(date.getUTCDay()+6)%7])}
async function dataset(){const response=await fetch('./data/national/manifest.json',{cache:'no-store'});if(!response.ok)throw Error('Manifest jízdního řádu není dostupný');const m=await response.json();if(m.schemaVersion!==1||m.source!=='cz_gtfs'&&m.source!=='cisjr_netex'||!/^[a-f0-9]{64}$/.test(m.generation_id||'')||!/^[a-f0-9]{64}$/.test(m.source_sha256||''))throw Error('Neověřená generace jízdního řádu');return m;}
async function shard(key,manifest){const id=manifest.generation_id+':'+key,existing=cache.get(id);if(existing&&Date.now()-existing.time<300000)return existing.promise;const promise=(async()=>{const response=await fetch('./data/national/shards/'+key+'.json.gz?generation='+manifest.generation_id,{cache:'no-store'});if(!response.ok)throw Error('Celostátní jízdní řád není dostupný (HTTP '+response.status+')');if(typeof DecompressionStream==='undefined')throw Error('Prohlížeč nepodporuje dekompresi jízdního řádu. Aktualizujte jej.');const feed=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();if(feed.schemaVersion!==1||feed.feed_version!==manifest.feed_version||feed.generated_at!==manifest.generated_at)throw Error('Neshodná generace jízdního řádu. Obnovte načtení.');return feed;})();if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(id,{time:Date.now(),promise});try{return await promise}catch(error){cache.delete(id);throw error}}
async function read(names,minutes,now=Date.now()){
 const manifest=await dataset();
 const keys=await Promise.all(names.map(async name=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name)))[0].toString(16).padStart(2,'0')));
 const feeds=await Promise.all([...new Set(keys)].map(key=>shard(key,manifest)));const departures=[],known=[];const p=parts(new Date(now));const today=Date.UTC(p.year,p.month-1,p.day),until=now+minutes*60000;
 for(const feed of feeds){if(feed.schemaVersion!==1)throw Error('Nepodporovaný formát jízdního řádu');for(const name of names){const schedule=feed.stops[name];if(!schedule)continue;known.push(name);
 // Include earlier service dates for GTFS times beyond 24:00, without assuming device timezone.
 const lookback=Math.max(1,Math.ceil(schedule.reduce((max,row)=>Math.max(max,row[0]),0)/86400));
 for(let offset=-lookback;offset<=Math.ceil(minutes/1440);offset++){const date=new Date(today+offset*86400000);const origin=midnight(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());for(const [seconds,index,stopId] of schedule){const trip=feed.trips[index],service=feed.services[trip[1]];if(!service||!active(service,date))continue;
 // GTFS wall-clock times, including >24:00; DST offset is resolved at the departure time.
 const wall=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),0,0,seconds));let timestamp=origin+seconds*1000;const wp=parts(new Date(timestamp));timestamp+=wall.getTime()-Date.UTC(wp.year,wp.month-1,wp.day,wp.hour,wp.minute,wp.second);
 if(timestamp>=now-120*60000&&timestamp<=until)departures.push({scheduled_at:new Date(timestamp).toISOString(),stop_id:stopId,stop_name:name,trip_id:trip[0],line:trip[2],route_type:trip[3],destination:trip[4]});
 }} }}
 return {source:'cz_gtfs',generated_at:feeds[0]?.generated_at,feed_version:feeds[0]?.feed_version,realtime_available:false,known_stops:known,departures};
}
root.EduvizeTransportNational={read,active,midnight};
})(typeof window==='undefined'?globalThis:window);
