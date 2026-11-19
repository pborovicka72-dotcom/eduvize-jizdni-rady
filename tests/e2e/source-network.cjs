/* Browser integration with controlled network fixtures; no live school data. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {gzipSync}=require('node:zlib');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
 const root=path.resolve(__dirname,'../..');const evidence=[];
 try{for(const scenario of ['live','outage','empty','ambiguous']){
 const context=await browser.newContext();const page=await context.newPage();const requests=[];
 const now=new Date(),future=new Date(now.getTime()+300000);const local=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(future).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const date=local.year+local.month+local.day;const seconds=Number(local.hour)*3600+Number(local.minute)*60+Number(local.second);
 const feed={schemaVersion:1,generated_at:now.toISOString(),stops:{A:[[seconds,0,'national-A']]},trips:[['trip','service','123',3,'Terminal']],services:{service:{start:date,end:date,days:[1,1,1,1,1,1,1]}}};
 await context.route('**/*',async route=>{const url=new URL(route.request().url());requests.push(url.href);if(url.hostname.endsWith('onrender.com'))throw Error('Render request: '+url.href);
 const p=url.pathname;let body,type='application/json';let status=200;
 if(p==='/'){type='text/html';body='<script src="/transport-national.js"></script><script src="/transport-realtime.js"></script><script src="/transport-sources.js"></script>'}
 else if(p==='/realtime-config.json')body=JSON.stringify({endpoint:'/doprava-api/api/v1/pid/departures'});
 else if(p.endsWith('/stops.json'))body=JSON.stringify({stops:['A'],coordinates:{A:[[scenario==='ambiguous'&&p.includes('national')?49:50,14]]}});
 else if(p.startsWith('/data/national/shards/')){body=gzipSync(JSON.stringify(feed));type='application/octet-stream'}
 else if(p.startsWith('/doprava-api/')){status=['outage','ambiguous'].includes(scenario)?503:200;body=JSON.stringify({source:'golemio',known_stops:['A'],generated_at:now.toISOString(),departures:scenario==='empty'?[]:[{stop_name:'A',scheduled_at:future.toISOString(),realtime_available:true,delay_seconds:120}]})}
 else if(/^\/transport-(national|realtime|sources)\.js$/.test(p)){type='text/javascript';body=fs.readFileSync(path.join(root,p.slice(1)))}else return route.abort();
 await route.fulfill({status,contentType:type,body});});
 await page.goto('http://localhost/');await page.evaluate(()=>localStorage.setItem('eduvize-pid-config',JSON.stringify({stops:['FOREIGN-SCHOOL']})));
 const data=await page.evaluate(()=>EduvizeTransportSources.read(['A'],60,'pid'));
 if(['empty','ambiguous'].includes(scenario))assert.equal(data.departures.length,0);else assert.equal(data.departures[0].realtime_available,scenario!=='outage');
 if(scenario==='outage'){assert.equal(data.departures[0].delay_seconds,null);assert.equal(data.departures[0].predicted_at,null);assert.equal(data.planned_stops[0],'A')}
 if(scenario==='ambiguous'){assert.equal(data.failed_stops[0],'A');assert(!requests.some(u=>u.includes('/shards/')))}
 assert(!JSON.stringify(data).includes('FOREIGN-SCHOOL'));assert(requests.every(u=>new URL(u).hostname==='localhost'));
 evidence.push({scenario,passed:true,requests});await context.close();}
 console.log(JSON.stringify(evidence,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
