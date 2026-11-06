/* Published renderer: only shared runtime identity and scoped data. No browser config. */
(function(root){'use strict';
 const $=id=>document.getElementById(id),stage=$('stage'),format=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
 let snapshot,metrics,rows=[],plannedStops=new Set(),page=0,poll=null,paging=null,abort=null,stopped=false,generation=0;
 const sourceDate=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
 const outputId=new URL(location.href).searchParams.get('edu-output');
 
 function stop(){generation++;clearTimeout(poll);clearInterval(paging);abort?.abort();abort=null;poll=null;paging=null;}
 function clear(error){stopped=true;stop();rows=[];$('rows').replaceChildren();$('selection').textContent='';$('status').textContent=error?.status===410?'Výstup byl odvolán.':'Výstup není dostupný.';$('previous').parentElement.hidden=true;}
 function size(p,m){
  const g=m.geometry;stage.dataset.compact=String(p.mode!=='web'&&(g.ratio>=2.7||(g.width<=1200&&g.height<=720)));const fixed=p.mode!=='web';const w=g.width||innerWidth,h=g.height||innerHeight;
  stage.style.width=fixed?w+'px':'100%';stage.style.height=fixed?h+'px':'auto';stage.style.minHeight=fixed?'0':'100vh';
  const scale=fixed?Math.min(innerWidth/w,innerHeight/h):1;stage.style.transform=fixed?'scale('+scale+')':'';
  const text=m.text;const header=m.header;
  // Shared semantic roles, no content-dependent enlargement.
  stage.style.setProperty('--body-size',(text.body||24)+'px');stage.style.setProperty('--title-size',(header.title||36)+'px');stage.style.setProperty('--meta-size',(header.meta||text.caption)+'px');stage.style.setProperty('--header-height',(header.height||100)+'px');
 }
 function pageSize(){if(snapshot.presentation.mode==='web')return Math.max(1,rows.length);return Math.max(1,Math.floor((stage.clientHeight-stage.querySelector('header').offsetHeight-stage.querySelector('footer').offsetHeight-90)/Math.max(48,(metrics.text.body||24)*2)));}
 function renderRows(){
  const count=pageSize(),pages=Math.max(1,Math.ceil(rows.length/count));page=Math.min(page,pages-1);$('rows').replaceChildren();
  for(const row of rows.slice(page*count,(page+1)*count)){
   const tr=document.createElement('tr');const delay=row.is_canceled?'Odřeknuto':plannedStops.has(row.stop_name)?'Plán':!row.realtime_available||!Number.isFinite(row.delay_seconds)?'Bez údaje':Math.abs(row.delay_seconds)<60?'Včas':(row.delay_seconds>0?'+':'−')+Math.floor(Math.abs(row.delay_seconds)/60)+' min';
   for(const value of [format.format(new Date(row.scheduled_at)),row.line,row.destination,row.stop_name,delay]){const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td)}$('rows').append(tr);
  }
  const interactive=snapshot.presentation.interaction==='interactive';$('previous').parentElement.hidden=pages===1||!interactive;$('page').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
 }
 async function tick(token){if(stopped||token!==generation)return;abort=new AbortController();
  try{
   // Use the shared client's configured same-origin path, never a query-selected provider.
   const dataClient=root.EduvizeOutputClient.create({signal:abort.signal});const value=await dataClient.getPublicData(outputId);if(token!==generation||stopped)return;
   if(value.schemaVersion!==1||!Array.isArray(value.data?.departures))throw Error('Neplatná dopravní data');
   rows=value.data.departures;plannedStops=new Set(value.data.plannedStops||[]);page=0;renderRows();
   const observation=new Date(value.observedAt),planned=plannedStops.size>0;
   const age=planned?'Podklad: '+sourceDate.format(observation):'Načteno '+format.format(observation);
   $('status').textContent=(value.stale?'Starší údaje · ':'')+(value.complete?'':'Část zastávek není dostupná · ')+(rows.length?(planned?'Plánované odjezdy · ':'')+age:'Žádné odjezdy v nastaveném intervalu. '+age);
  }catch(error){if(token!==generation||stopped)return;if([403,404,410].includes(error.status)){clear(error);return;}rows=[];renderRows();$('status').textContent='Odjezdy dočasně nejsou dostupné.';}
  if(token===generation&&!stopped)poll=setTimeout(()=>tick(token),30000);
 }
 function resume(){if(stopped||poll!==null||abort)return;const token=generation;tick(token);}
 $('previous').onclick=()=>{page=Math.max(0,page-1);renderRows()};$('next').onclick=()=>{page++;renderRows()};
 root.addEventListener('resize',()=>{if(snapshot){size(snapshot.presentation,metrics);renderRows()}});
 root.EduvizeOutputRuntime.start({appId:'transport',outputId,
  onPresentation:(p,m)=>size(p,m),
  render:(s,m,{signal})=>{stop();stopped=false;snapshot=s;metrics=m;rows=[];page=0;$('selection').textContent=s.payload.stops.join(' · ');renderRows();signal.addEventListener('abort',stop,{once:true});},
  onReady:()=>{resume();if(!paging&&snapshot.presentation.interaction==='display')paging=setInterval(()=>{const pages=Math.max(1,Math.ceil(rows.length/pageSize()));page=(page+1)%pages;renderRows()},snapshot.payload.pageSeconds*1000)},
  onError:()=>{stop();$('status').textContent='Ověření publikace dočasně není dostupné.';},clear});
})(window);
