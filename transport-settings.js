/* Explicit kiosk opt-in; historical standalone URLs keep their original defaults. */
(function(root){
 const KEY='eduvize-pid-config';
 function query(value,storage){
  const params=new URLSearchParams(value);
  if(params.get('transport_settings')!=='browser')return params;
  let saved;try{const store=storage||root.localStorage;const id=params.get('edu-profile');saved=JSON.parse((id&&store.getItem(KEY+':'+id))||store.getItem(KEY)||'null');if(id&&saved?.profileId&&saved.profileId!==id)return params;}catch{return params;}
  if(!saved||!Array.isArray(saved.stops)||!saved.stops.length||!saved.stops.every(s=>typeof s==='string'&&s.trim()))return params;
  params.delete('name');params.set('stops',saved.stops.join('|'));
  params.set('source',saved.source==='cz_gtfs'?'cz_gtfs':'pid');
  for(const key of ['minutes','limit','pageSeconds'])if(saved[key]!==undefined)params.set(key,String(saved[key]));
  if(Array.isArray(saved.types)&&saved.types.length)params.set('types',saved.types.join(','));
  return params;
 }
 function watch(value,onChange,storage=root.localStorage){
  if(new URLSearchParams(value).get('transport_settings')!=='browser')return;
  let previous=query(value,storage).toString();
  const check=()=>{const next=query(value,storage).toString();if(next!==previous){previous=next;onChange();}};
  root.addEventListener('storage',event=>{if(event.key===KEY||event.key?.startsWith(KEY+':')||event.key===null)check();});
  root.addEventListener('pageshow',check);
  root.addEventListener('focus',check);
  root.setInterval(check,30000);
 }
 root.EduvizeTransportSettings=Object.freeze({query,watch});
})(window);
