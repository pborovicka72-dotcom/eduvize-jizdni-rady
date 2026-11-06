/* Source selection only; publication and public context belong to the shared resolver. */
(function(root){
'use strict';
function distance(a,b){const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2)))}
function points(c,name){return (c.coordinates?.[name]||[]).filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180)}
function matches(name,from,to){
 if(!from.stops.includes(name)||!to.stops.includes(name))return false;
 const a=points(from,name),b=points(to,name);
 // Require every platform to have a nearby counterpart in both catalogs.
 return a.length>0&&b.length>0&&a.every(p=>b.some(q=>distance(p,q)<=150))&&b.every(p=>a.some(q=>distance(p,q)<=150));
}
let catalogs;
async function catalog(){if(!catalogs)catalogs=Promise.all(['./data/stops.json','./data/national/stops.json'].map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Katalog zastávek není dostupný');const d=await r.json();if(!Array.isArray(d.stops))throw Error('Neplatný katalog zastávek');return d})).catch(e=>{catalogs=null;throw e});return catalogs}
async function read(names,minutes,source){
 if(!['pid','cz_gtfs'].includes(source)||!Array.isArray(names)||names.length>20||!names.every(n=>typeof n==='string'&&n.trim()&&n.length<=100)||!Number.isFinite(Number(minutes))||minutes<1||minutes>720)throw Error('Neplatný výběr zastávek');
 const [pid,national]=await catalog();const departures=[],known=[],failed=[],planned=[],timestamps=[];
 for(const name of [...new Set(names)]){
  const inPid=pid.stops.includes(name),inNational=national.stops.includes(name);
  const linked=matches(name,pid,national);
  const usePid=source==='pid'?inPid:inNational&&linked;
  let data;
  if(usePid){try{data=await root.EduvizeTransportRealtime.read([name],minutes);if(!data||!Array.isArray(data.known_stops)||!data.known_stops.includes(name))data=null}catch{data=null}}
  if(!data&&inNational&&(source!=='pid'||linked)){
   try{data=await root.EduvizeTransportNational.read([name],minutes);data={...data,departures:data.departures.map(d=>({...d,realtime_available:false,delay_seconds:null,predicted_at:null}))};planned.push(name)}catch{failed.push(name)}
  }
  if(data){timestamps.push(Date.parse(data.generated_at));known.push(...(data.known_stops||[]));departures.push(...data.departures.filter(d=>d.stop_name===name))}else if(!failed.includes(name))failed.push(name);
 }
 return {source:planned.length?'mixed':'golemio',generated_at:timestamps.length&&timestamps.every(Number.isFinite)?new Date(Math.min(...timestamps)).toISOString():null,departures,known_stops:[...new Set(known)],failed_stops:failed,planned_stops:planned};
}
root.EduvizeTransportSources={read,matches};
})(typeof window==='undefined'?globalThis:window);
