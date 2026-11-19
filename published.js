/* Public transport output uses the same layout as the live preview and only scoped published data. */
(function(root){'use strict';
 const $=id=>document.getElementById(id),stage=$('stage');
 const time=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
 const date=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const sourceDate=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
 const outputId=new URL(location.href).searchParams.get('edu-output');
 let snapshot,metrics,rows=[],pageGroups=[[]],plannedStops=new Set(),page=0,poll=null,paging=null,abort=null,stopped=false,generation=0;
 const loading=$('loading');
 function reveal(){stage.style.visibility='visible';loading.hidden=true;}
 function conceal(message){stage.style.visibility='hidden';loading.textContent=message;loading.hidden=false;}
 const text=(className,value)=>{const node=document.createElement('span');node.className=className;node.textContent=String(value??'—');return node;};
 const tidy=value=>String(value||'—').replace(/,\s*/g,', ').replace(/žel\.\s*st\./gi,'žel. st.').replace(/\s+/g,' ').trim();
 const stopWord=count=>count===1?'zastávka':count>=2&&count<=4?'zastávky':'zastávek';
 let headerFitFrame=0;
 function fitHeader(){for(const node of stage.querySelectorAll('.head .edu-header-title,.head .edu-header-meta')){node.style.removeProperty('font-size');let size=parseFloat(getComputedStyle(node).fontSize);for(let attempt=0;attempt<12&&node.clientWidth&&node.scrollWidth>node.clientWidth+1;attempt++){size*=node.clientWidth/node.scrollWidth;node.style.setProperty('font-size',Math.max(1,size-.2)+'px','important');}}}
 function scheduleHeaderFit(){cancelAnimationFrame(headerFitFrame);headerFitFrame=requestAnimationFrame(fitHeader);}
 function clock(){const now=new Date();$('clock').textContent=time.format(now);$('date').textContent=date.format(now);for(const node of document.querySelectorAll('[data-departure]')){const remaining=Number(node.dataset.departure)-Date.now();node.textContent=remaining<=0?'odjíždí':Math.ceil(remaining/60000)+' min';}scheduleHeaderFit();}
 function stop(){generation++;clearTimeout(poll);clearInterval(paging);abort?.abort();abort=null;poll=null;paging=null;}
 function clear(error){stopped=true;stop();rows=[];$('rows').replaceChildren();$('station').textContent='';$('status').textContent=error?.status===410?'Výstup byl odvolán.':'Výstup není dostupný.';$('dot').classList.add('error');$('previous').parentElement.hidden=true;conceal($('status').textContent);}
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
  const inset=(m.header.height-m.header.icon)/2;stage.style.setProperty('--edu-header-inset',inset+'px');stage.style.setProperty('--edu-header-gap',inset+'px');
  for(const [key,value] of Object.entries(m.text))stage.style.setProperty('--edu-text-'+key,value+'px');
  scheduleHeaderFit();
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
  const line=document.createElement('div');line.className='departure';if(row.is_canceled)line.classList.add('is-canceled');
  const departure=new Date(row.scheduled_at),timeCell=text('time',time.format(departure));
  const route=document.createElement('span');route.className='route';const [kind,color]=routeKind(row);if(color)route.classList.add(color);route.append(routeIcon(kind),text('route-number',row.line));
  const destination=text('destination',tidy(row.destination)),stopName=text('stop',tidy(row.stop_name));
  const count=text('countdown','—');if(!row.is_canceled)count.dataset.departure=String(Date.parse(row.predicted_at||row.scheduled_at));
  line.append(timeCell,route,destination,stopName,count);
  if(showDelay){const delay=text('delay',row.is_canceled?'Odřeknuto':plannedStops.has(row.stop_name)?'Plán':!row.realtime_available||!Number.isFinite(row.delay_seconds)?'Bez údaje':Math.abs(row.delay_seconds)<60?'Včas':(row.delay_seconds>0?'+':'−')+Math.floor(Math.abs(row.delay_seconds)/60)+' min');delay.classList.toggle('is-delayed',row.realtime_available&&row.delay_seconds>=60);line.append(delay);}
  return line;
 }
 function paginate(showDelay){
  if(snapshot.presentation.mode==='web')return [rows];
  const available=$('viewport').clientHeight;
  const body=$('rows'),measured=rows.map(row=>{const node=rowNode(row,showDelay);body.append(node);return {row,node};});
  const groups=[];let current=[],used=0;
  for(const item of measured){
   const height=item.node.getBoundingClientRect().height+parseFloat(getComputedStyle(item.node).marginBottom||0);
   if(current.length&&used+height>available+0.5){groups.push(current);current=[];used=0;}
   current.push(item.row);used+=height;
  }
  body.replaceChildren();if(current.length)groups.push(current);
  return groups.length?groups:[[]];
 }
 function renderRows(){
  if(!snapshot)return;
  const showDelay=rows.some(row=>row.realtime_available&&Number.isFinite(row.delay_seconds));
  document.documentElement.dataset.delayAvailable=String(showDelay);$('delay-heading').hidden=!showDelay;
  $('rows').replaceChildren();pageGroups=paginate(showDelay);page=Math.min(page,pageGroups.length-1);
  for(const row of pageGroups[page])$('rows').append(rowNode(row,showDelay));
  if(!rows.length){const message=document.createElement('div');message.className='message';message.textContent='V nastaveném intervalu nejsou odjezdy.';$('rows').append(message);}
  clock();
  const interactive=snapshot.presentation.interaction==='interactive';$('previous').parentElement.hidden=pageGroups.length===1||!interactive;
  $('page').textContent=(page+1)+' / '+pageGroups.length;$('previous').disabled=page===0;$('next').disabled=page===pageGroups.length-1;
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
   reveal();
  }catch(error){if(token!==generation||stopped)return;if([403,404,410].includes(error.status)){clear(error);return;}rows=[];renderRows();$('status').textContent='Odjezdy dočasně nejsou dostupné.';$('dot').classList.add('error');conceal($('status').textContent);}
  if(token===generation&&!stopped)poll=setTimeout(()=>tick(token),30000);
 }
 function resume(){if(stopped||poll!==null||abort)return;tick(generation);}
 $('previous').onclick=()=>{page=Math.max(0,page-1);renderRows()};$('next').onclick=()=>{page++;renderRows()};
 root.addEventListener('resize',()=>{if(snapshot){size(snapshot.presentation,metrics);renderRows()}});
 setInterval(clock,10000);clock();document.fonts?.ready.then(scheduleHeaderFit);
 root.EduvizeOutputRuntime.start({appId:'transport',outputId,
  onPresentation:(presentation,m)=>size(presentation,m),
  render:(value,m,{signal})=>{stop();stopped=false;snapshot=value;metrics=m;rows=[];page=0;const station=$('station'),count=value.payload.stops.length;station.dataset.fullLabel=count+' '+stopWord(count)+' · následujících '+value.payload.minutes+' min';station.textContent=stage.dataset.transportLayout==='stacked'?station.dataset.fullLabel.split(' · ')[0]:station.dataset.fullLabel;renderRows();scheduleHeaderFit();signal.addEventListener('abort',stop,{once:true});},
  onReady:()=>{resume();if(!paging&&snapshot.presentation.interaction==='display')paging=setInterval(()=>{page=(page+1)%pageGroups.length;renderRows()},snapshot.payload.pageSeconds*1000)},
  onError:()=>{stop();$('status').textContent='Ověření publikace dočasně není dostupné.';$('dot').classList.add('error');conceal($('status').textContent);},clear});
})(window);
