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
  document.documentElement.dataset.kioskHeader=p.mode==='kiosk'&&p.kioskLayout==='menu'?'light':'dark';
  document.documentElement.classList.toggle('kiosk-output',p.mode==='kiosk');
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
  const item=document.createElement('div');item.className='departure';if(row.is_canceled)item.classList.add('is-canceled');
  const route=text('route','');const [kind,color]=routeKind(row);if(color)route.classList.add(color);route.append(routeIcon(kind),text('route-number',row.line));
  const count=text('countdown','—');if(!row.is_canceled)count.dataset.departure=String(Date.parse(row.predicted_at||row.scheduled_at));
  item.append(text('time',time.format(new Date(row.scheduled_at))),route,text('destination',tidy(row.destination)),text('stop',tidy(row.stop_name)),count);
  if(showDelay){const delay=text('delay',row.is_canceled?'Odřeknuto':plannedStops.has(row.stop_name)?'Plán':!row.realtime_available||!Number.isFinite(row.delay_seconds)?'Bez údaje':Math.abs(row.delay_seconds)<60?'Včas':(row.delay_seconds>0?'+':'−')+Math.floor(Math.abs(row.delay_seconds)/60)+' min');delay.classList.toggle('is-delayed',row.realtime_available&&row.delay_seconds>=60);item.append(delay);}
  return item;
 }
 function pageSize(showDelay){
  if(snapshot.presentation.mode==='web')return Math.max(1,rows.length);
  const height=$('viewport').clientHeight;if(height<=0)return 1;
  const root=$('rows');root.replaceChildren();
  let used=0,count=0;
  for(const row of rows){
   const node=rowNode(row,showDelay);root.append(node);
   const style=getComputedStyle(node),size=node.offsetHeight+parseFloat(style.marginBottom||0);
   if(count&&used+size>height+0.5)break;
   used+=size;count++;
  }
  return Math.max(1,count);
 }
 function renderRows(){
  if(!snapshot)return;
  const showDelay=rows.some(row=>row.realtime_available&&Number.isFinite(row.delay_seconds));
  document.documentElement.dataset.delayAvailable=String(showDelay);
  const count=pageSize(showDelay),pages=snapshot.payload.limit===0?1:Math.max(1,Math.ceil(rows.length/count));
  page=Math.min(page,pages-1);$('rows').replaceChildren();
  for(const row of rows.slice(page*count,(page+1)*count))$('rows').append(rowNode(row,showDelay));
  if(!rows.length)$('rows').append(text('message','V nastaveném intervalu nejsou odjezdy.'));
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
  onReady:()=>{resume();if(!paging&&snapshot.presentation.interaction==='display'&&snapshot.payload.limit!==0)paging=setInterval(()=>{const pages=Math.max(1,Math.ceil(rows.length/pageSize(rows.some(row=>row.realtime_available&&Number.isFinite(row.delay_seconds)))));page=(page+1)%pages;renderRows()},snapshot.payload.pageSeconds*1000)},
  onError:()=>{stop();$('status').textContent='Ověření publikace dočasně není dostupné.';$('dot').classList.add('error');},clear});
})(window);
