/* Shared runtime + real published renderer, controlled HTTP publication lifecycle. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=path.resolve(__dirname,'../..'),shared=process.env.EDUVIZE_OUTPUT_STYLES;
if(!shared)throw Error('Set EDUVIZE_OUTPUT_STYLES to pinned shared client checkout');
const assets=new Map();for(const file of [path.join(app,'published.html'),path.join(app,'published.js'),path.join(app,'published.css'),...['output-client.js','output-runtime.js','segment-profile.js','nsp-geometry.js'].map(n=>path.join(shared,'design-system',n))])assets.set(path.resolve(file),fs.readFileSync(file));
const layouts={};vm.runInNewContext(fs.readFileSync(path.join(shared,'design-system/nsp-geometry.js'),'utf8'),{window:layouts});
const cases=[{mode:'web',geometry:null,interaction:'display',kioskLayout:null}];
for(const [orientation,entries] of Object.entries(layouts.EduvizeNSPLayouts.layouts))for(const [layout,segments] of Object.entries(entries))for(let i=0;i<segments.length;i++)cases.push({mode:'nsp',geometry:{registryId:'nsp-4k',registryVersion:1,orientation,layoutId:Number(layout),segmentId:i+1},interaction:'display',kioskLayout:null});
for(const orientation of ['landscape','portrait'])for(const kioskLayout of ['menu','tiles'])for(const interaction of ['display','interactive'])cases.push({mode:'kiosk',geometry:{registryId:'kiosk-viewport',registryVersion:1,orientation,width:orientation==='portrait'?1080:1920,height:orientation==='portrait'?1920:1080},interaction,kioskLayout});
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});const evidence=[];
try{for(const presentation of cases){
 const context=await browser.newContext({viewport:{width:1280,height:800}});const page=await context.newPage();await page.clock.install();let revoked=false,revision=1,color='#112233',dataRequests=0;const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const id='a'.repeat(32),base='https://test.skola.eduvize.cz';
 await context.addInitScript(()=>{localStorage.setItem('eduvize-pid-config',JSON.stringify({stops:['FOREIGN']}));localStorage.setItem('eduvize-profile-selection-v1','c'.repeat(32));});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());requests.push(u.href);assert.equal(u.origin,base);const p=u.pathname;let body,type='application/json',status=200;
 if(p.startsWith('/api/public/v1/outputs/')){
  assert(p.startsWith('/api/public/v1/outputs/'+id));
  if(revoked){status=410;body={error:{code:'REVOKED',message:'Výstup odvolán'}};}
  else if(p.endsWith('/theme'))body={schemaVersion:1,colors:{background:'#f3f6fa',text:'#172033',muted:'#52627a',surface:'#ffffff',primary:color,primaryText:'#ffffff',secondary:'#dde5ef',secondaryText:'#172033',accent:'#227755',border:'#cbd5e1'},controls:{heightPx:44,radiusPx:10},cards:{radiusPx:10},icons:{radiusPx:10}};
  else if(p.endsWith('/data')){dataRequests++;const at=new Date(Date.now()+300000).toISOString();body={schemaVersion:1,observedAt:'2026-11-02T00:00:00Z',fetchedAt:new Date().toISOString(),stale:false,complete:true,data:{plannedStops:[revision===1?'A':'B'],departures:[{scheduled_at:at,line:'123',destination:'Terminal',stop_name:revision===1?'A':'B',delay_seconds:null,realtime_available:false}]}};}
  else body={schemaVersion:1,id,appId:'transport',publishedRevision:revision,presentation,payload:{source:'pid',stops:[revision===1?'A':'B'],types:['bus'],minutes:60,limit:25,pageSeconds:10},theme:{mode:'profile-active',url:'/api/public/v1/outputs/'+id+'/theme',refreshSeconds:60},media:[]};
  body=JSON.stringify(body);
 }else{let file;if(p.startsWith('/eduvize-styly/design-system/'))file=path.join(shared,p.slice('/eduvize-styly/'.length));else if(p.startsWith('/eduvize-jizdni-rady/'))file=path.join(app,p.slice('/eduvize-jizdni-rady/'.length));else throw Error('Unexpected route '+p);body=assets.get(path.resolve(file));if(!body)throw Error('Unexpected asset '+p);type=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html';}
 await route.fulfill({status,contentType:type,body});});
 await page.goto(base+'/eduvize-jizdni-rady/published.html?edu-output='+id+'&stops=FOREIGN');await page.locator('#rows tr').waitFor();assert.equal(await page.locator('#rows').innerText().then(t=>t.includes('FOREIGN')),false);assert((await page.locator('#rows').innerText()).includes('Plán'));assert(/2\.\s*11\.\s*2026/.test(await page.locator('#status').innerText()),'Display must retain the national source date, not the fresh fetch time');
 if(presentation.mode==='web'&&process.env.TRANSPORT_PREVIEW)await page.screenshot({path:process.env.TRANSPORT_PREVIEW});
 revision=2;color='#223344';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>document.getElementById('selection').textContent==='B');await page.waitForFunction(()=>document.getElementById('rows').textContent.includes('B'));
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ev-primary')),color);
 revoked=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>document.getElementById('rows').children.length===0);const before=dataRequests;await page.clock.fastForward(120000);assert.equal(dataRequests,before);assert.equal(errors.length,0,errors.join('\n'));
 evidence.push({presentation,passed:true,requests:requests.length});await context.close();}
 console.log(JSON.stringify({passed:evidence.length,cases:evidence},null,2));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
