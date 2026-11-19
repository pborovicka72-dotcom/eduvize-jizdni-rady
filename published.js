/* Public transport output uses the same layout as the live preview and only scoped published data. */
(function(root){'use strict';
 const $=id=>document.getElementById(id),stage=$('stage');
 const time=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
 const date=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const sourceDate=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
 const outputId=new URL(location.href).searchParams.get('edu-output');
 let snapshot,metrics,rows=[],plannedStops=new Set(),page=0,poll=null,paging=null,abort=null,stopped=false,generation=0;
 const text=(className,value)=>{const node=document.createElement('span');node.className=className;node.textContent=String(value??'—');return node;};
 const tidy=value=>String(value||'—').replace(/,\s*/g,', ').replace(/žel\.\s*st\./gi,'žel. st.').replace(/\s+/g,' ').trim();
 function clock(){const now=new Date();$('clock').textContent=time.format(now);$('date').textContent=date.format(now);for(const node of document.querySelectorAll('[data-departure]')){const remaining=Number(node.dataset.departure)-Date.now();node.textContent=remaining<=0?'odjíždí':Math.ceil(remaining/60000)+' min';}}
 function stop(){generation++;clearTimeout(poll);clearInterval(paging);abort?.abort();abort=null;poll=null;paging=null;}
 function clear(error){stopped=true;stop();rows=[];$('rows').replaceChildren();$('selection').textContent='';$('status').textContent=error?.status===410?'Výstup byl odvolán.':'Výstup není dostupný.';$('dot').classList.add('error');$('previous').parentElement.hidden=true;}
 function size(p,m){
  const g=m.geometry,fixed=p.mode!=='web',w=g.width||innerWidth,h=g.height||innerHeight;
  document.documentElement.dataset.outputMode=p.mode;
  document.documentElement.classList.toggle('web-output',!fixed);
  document.body.classList.toggle('web-mode',!fixed);
  stage.dataset.compact=String(fixed&&(g.ratio>=2.7||(w<=1200&&h<=720)));
  stage.style.width=fixed?w+'px':'100%';stage.style.height=fixed?h+'px':'auto';stage.style.minHeight=fixed?'0':'100vh';
  stage.style.transform=fixed?'scale('+Math.min(innerWidth/w,innerHeight/h)+')':'';
  root.EduvizeTransportLayout.apply(stage,{web:!fixed},w,h);
  for(const [key,value] of Object.entries(m.header))stage.style.setProperty('--edu-header-'+key,value+'px');
  stage.style.setProperty('--edu-header-inset',(m.header.height-m.header.icon)/2+'px');
  for(const [key,value] of Object.entries(m.text))stage.style.setProperty('--edu-text-'+key,value+'px');
 }
 function routeKind(row){
  const type=Number(row.route_type),line=String(row.line||'—').trim();
  if(type===1)return ['metro',['A','B','C'].includes(line.toUpperCase())?'metro-'+line.toLowerCase():'unknown'];
  if(type===0||type===900)return ['tram','tram'];
  if(type===2||type>=100&&type<200)return ['train','train'];
  if(type===11)return ['bus','trolleybus'];
  if(type===4||type>=1000&&type<1100)return ['ferry','ferry'];
  if(type===7||type>=1300&&type<1400)return ['funicular','funicular'];
  return ['bus',type===3||type>=700&&type<800?'':'unknown'];
 }
 function routeIcon(kind){
  const paths={bus:'M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM5 11h14M8 15h.01M16 15h.01M8 19v2M16 19v2',tram:'M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM5 11h14M8 19l-2 2M16 19l2 2',train:'M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3ZM5 11h14M8 19l-2 3M16 19l2 3',metro:'M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3ZM5 11h14M8 19l-2 3M16 19l2 3',ferry:'M3 17l3 3 6-2 6 2 3-3-3-7H6l-3 7ZM12 3v7M8 6h8',funicular:'M5 17 7 8h10l2 9-2 2H7l-2-2ZM7 13h10M8 19l-2 3M16 19l2 3'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[kind]||paths.bus);svg.append(path);return svg;
 }
 function rowNode(row,showDelay){
  const tr=document.createElement('tr');tr.className='departure';if(row.is_canceled)tr.classList.add('is-canceled');
  const departure=new Date(row.scheduled_at);const timeCell=document.createElement('td');timeCell.className='time';timeCell.textContent=time.format(departure);
  const route=document.createElement('td');route.className='route';const [kind,color]=routeKind(row);if(color)route.classList.add(color);route.append(routeIcon(kind),text('route-number',row.line));
  const destination=document.createElement('td');destination.className='destination';destination.textContent=tidy(row.destination);
  const stopName=document.createElement('td');stopName.className='stop';stopName.textContent=tidy(row.stop_name);
  const count=document.createElement('td');count.className='countdown';if(!row.is_canceled)count.dataset.departure=String(Date.parse(row.predicted_at||row.scheduled_at));
  tr.append(timeCell,route,destination,stopName,count);
  if(showDelay){const delay=document.createElement('td');delay.className='delay';delay.textContent=row.is_canceled?'Odřeknuto':plannedStops.has(row.stop_name)?'Plán':!row.realtime_available||!Number.isFinite(row.delay_seconds)?'Bez údaje':Math.abs(row.delay_seconds)<60?'Včas':(row.delay_seconds>0?'+':'−')+Math.floor(Math.abs(row.delay_seconds)/60)+' min';delay.classList.toggle('is-delayed',row.realtime_available&&row.delay_seconds>=60);tr.append(delay);}
  return tr;
 }
 function pageSize(){
  if(snapshot.presentation.mode==='web')return Math.max(1,rows.length);
  const available=$('viewport').clientHeight-$('viewport').querySelector('thead').offsetHeight;
  const font=parseFloat(stage.style.getPropertyValue('--transport-text'))||metrics.text.body||24;
  return Math.max(1,Math.floor(available/Math.max(48,font*1.65)));
 }
 function renderRows(){
  if(!snapshot)return;
  const count=pageSize(),pages=Math.max(1,Math.ceil(rows.length/count)),showDelay=rows.some(row=>row.realtime_available&&Number.isFinite(row.delay_seconds));
  page=Math.min(page,pages-1);document.documentElement.dataset.delayAvailable=String(showDelay);
  $('delay-heading').hidden=!showDelay;$('rows').replaceChildren();
  for(const row of rows.slice(page*count,(page+1)*count))$('rows').append(rowNode(row,showDelay));
  if(!rows.length){const message=document.createElement('tr');message.className='message';const cell=document.createElement('td');cell.colSpan=showDelay?6:5;cell.textContent='V nastaveném intervalu nejsou odjezdy.';message.append(cell);$('rows').append(message);}
  clock();
  const interactive=snapshot.presentation.interaction==='interactive';$('previous').parentElement.hidden=pages===1||!interactive;
  $('page').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
 }
 async function tick(token){if(stopped||token!==generation)return;abort=new AbortController();
  try{
   const dataClient=root.EduvizeOutputClient.create({signal:abort.signal}),value=await dataClient.getPublicData(outputId);
   if(token!==generation||stopped)return;
   if(value.schemaVersion!==1||!Array.isArray(value.data?.departures))throw Error('Neplatná dopravní data');
   rows=value.data.departures;plannedStops=new Set(value.data.plannedStops||[]);page=0;renderRows();
   const observation=new Date(value.observedAt),planned=plannedStops.size>0;
   const age=planned?'Podklad: '+sourceDate.format(observation):'Načteno '+time.format(observation);
   $('status').textContent=(value.stale?'Starší údaje · ':'')+(value.complete?'':'Část zastávek není dostupná · ')+(rows.length?(planned?'Plánované odjezdy · ':'')+age:'Žádné odjezdy v nastaveném intervalu. '+age);
   $('dot').classList.toggle('error',value.stale||!value.complete);
  }catch(error){if(token!==generation||stopped)return;if([403,404,410].includes(error.status)){clear(error);return;}rows=[];renderRows();$('status').textContent='Odjezdy dočasně nejsou dostupné.';$('dot').classList.add('error');}
  if(token===generation&&!stopped)poll=setTimeout(()=>tick(token),30000);
 }
 function resume(){if(stopped||poll!==null||abort)return;tick(generation);}
 $('previous').onclick=()=>{page=Math.max(0,page-1);renderRows()};$('next').onclick=()=>{page++;renderRows()};
 root.addEventListener('resize',()=>{if(snapshot){size(snapshot.presentation,metrics);renderRows()}});
 setInterval(clock,10000);clock();
 root.EduvizeOutputRuntime.start({appId:'transport',outputId,
  onPresentation:(presentation,m)=>size(presentation,m),
  render:(value,m,{signal})=>{stop();stopped=false;snapshot=value;metrics=m;rows=[];page=0;$('selection').textContent=value.payload.stops.join(' · ');renderRows();signal.addEventListener('abort',stop,{once:true});},
  onReady:()=>{resume();if(!paging&&snapshot.presentation.interaction==='display')paging=setInterval(()=>{const pages=Math.max(1,Math.ceil(rows.length/pageSize()));page=(page+1)%pages;renderRows()},snapshot.payload.pageSeconds*1000)},
  onError:()=>{stop();$('status').textContent='Ověření publikace dočasně není dostupné.';$('dot').classList.add('error');},clear});
})(window);
