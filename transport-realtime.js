/* Live data is fetched through our server, never with a browser-visible API key. */
(function(root){
 async function endpoint(){const response=await fetch('./realtime-config.json',{cache:'no-store'});if(!response.ok)throw Error('Chybí konfigurace PID');const config=await response.json();const url=new URL(config.endpoint,location.origin);if(url.origin!==location.origin)throw Error('PID endpoint musí být ve stejném prostředí');return url.href;}
 async function read(stops,minutes){
  const base=await endpoint();if(!base)return null;
  const url=new URL(base);url.searchParams.set('stops',stops.join('|'));url.searchParams.set('minutes',minutes);
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Živá data PID nejsou dostupná');
  const data=await response.json();if(!Array.isArray(data.departures))throw Error('Neplatná živá data PID');
  return data;
 }
 function actual(d){return d.realtime_available&&d.predicted_at?d.predicted_at:d.scheduled_at}
 function label(d){
  if(d.is_canceled)return 'Odřeknuto';
  if(!d.realtime_available||!Number.isFinite(d.delay_seconds))return 'Bez údaje';
  const seconds=d.delay_seconds;if(Math.abs(seconds)<60)return 'Včas';
  return (seconds>0?'+':'−')+Math.floor(Math.abs(seconds)/60)+' min';
 }
 root.EduvizeTransportRealtime=Object.freeze({read,actual,label});
})(window);
