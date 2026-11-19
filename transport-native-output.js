/* Native transport binding. Shared Profiles and OutputActions own identity, Save and publication. */
(function(root){'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 function fail(code,message){throw Object.assign(Error(message),{code});}
 function project(config){
  if(!config||config.schemaVersion!==1)fail('SETTINGS_REQUIRED','Nejprve uložte nastavení jízdních řádů do Eduvize.');
  const v=config.values||{},p=config.presentation?clone(config.presentation):legacyPresentation(config);
  const payload={source:config.source,stops:clone(config.stops||[]),types:clone(config.types||[])};
  if(!['pid','cz_gtfs'].includes(payload.source)||payload.stops.length<1||payload.stops.length>20||new Set(payload.stops).size!==payload.stops.length||payload.stops.some(s=>typeof s!=='string'||!s.trim()||s!==s.trim()||s.length>100||s.includes('|')))fail('SETTINGS_REQUIRED','Uložené zastávky nejsou platné. Uložte nastavení znovu.');
  if(!payload.types.length||new Set(payload.types).size!==payload.types.length||payload.types.some(t=>!['bus','tram','metro','train','ferry','funicular'].includes(t)))fail('SETTINGS_REQUIRED','Vyberte platné druhy dopravy.');
  for(const [key,min,max] of [['minutes',1,720],['limit',1,100],['pageSeconds',3,120]]){const n=Number(v[key]);if(!Number.isInteger(n)||n<min||n>max)fail('SETTINGS_REQUIRED','Uložené číselné nastavení není platné.');payload[key]=n;}
  root.EduvizeOutputActions.canonicalSlot(p);
  return {schemaVersion:1,payloadVersion:1,payload,presentation:p};
 }
 function legacyPresentation(config){
  const mode=config.values?.viewMode||config.values?.outputType||'nsp',s=config.segment;
  if(mode==='kiosk')fail('SETTINGS_REQUIRED','Uložte nastavení kiosku včetně jeho rozměrů do Eduvize.');
  return {mode,geometry:mode==='nsp'&&s?{registryId:'nsp-4k',registryVersion:1,orientation:s.orientation,layoutId:Number(s.style),segmentId:Number(s.block)}:null,interaction:config.outputInteraction||'display',kioskLayout:null};
 }
 async function install(){
  const status=document.getElementById('notice'),sink=()=>root.EduvizeProfiles?.statusFor?.('transport');
  const connect=()=>sink()?.useResult(status);root.addEventListener('eduvize-admin-status-ready',e=>{if(e.detail?.app==='transport')connect();});connect();
  try{
   await root.EduvizeProfileAdapter.ready;
   if(root.EduvizeProfiles?.transportApplyBoundary!=='superseded-v1')fail('DEPENDENCY_UNAVAILABLE','Společná správa profilů není aktuální. Obnovte stránku.');
   await root.EduvizeAdminAuth.ready;
   const client=root.EduvizeOutputClient.create({getAuthorization:()=>{const token=root.EduvizeAdminAuth.getToken('configurations');return token?'Bearer '+token:null;}}),reader=root.EduvizeSavedOutputSettings.create();
   const context=()=>{const s=root.EduvizeAdminAuth.status();return {schoolId:String(s.schoolId||''),profileId:s.profileId,appId:'transport',presentation:root.EduvizeTransportPresentation()};};
   if(root.EduvizeOutputActions.transportPreviewHost!=='transport-protected-physical-v1')fail('DEPENDENCY_UNAVAILABLE','Společný dopravní náhled není dostupný. Obnovte stránku.');
   const actions=root.EduvizeOutputActions.mount({workflow:'saved-copy-preview',previewHost:'transport-protected-physical-v1',client,context,
    draft:async({savedCommit=null}={})=>{const c=context();let config;if(savedCommit){if(savedCommit.appId!=='transport'||savedCommit.profileId!==c.profileId||!Number.isSafeInteger(savedCommit.revision))fail('CONTEXT_CHANGED','Potvrzené nastavení patří jinému profilu.');config=savedCommit.config;}else config=(await reader.load(c)).config;return project(config);},
    previewDraftUrl:async()=>{
     const url=root.EduvizeTransportPreviewUrl();
     if(root.location.hostname==='test.skola.eduvize.cz'){
      const token=root.EduvizeAdminAuth.getToken('configurations');
      if(!token)fail('AUTH_REQUIRED','Přihlášení pro náhled vypršelo. Přihlaste se znovu.');
      const response=await root.fetch('/_access/session',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:'{}',credentials:'same-origin',cache:'no-store'});
      if(!response.ok)fail('AUTH_REQUIRED','Přístup k náhledu nelze ověřit. Přihlaste se znovu.');
     }
     return url;
    },elements:{copyButton:document.getElementById('copy'),openButton:document.querySelector('button[form="form"][type="submit"]'),status}});
   if(actions.workflow!=='saved-copy-preview'||typeof actions.withSavedCommit!=='function')fail('DEPENDENCY_UNAVAILABLE','Společné ovládání výstupů není dostupné.');
   root.EduvizeProfileAdapter.outputActions=actions;
   root.dispatchEvent(new Event('eduvize-profile-adapter-ready'));
  }catch(error){if(sink())sink().result(error.message,'error');else{status.dataset.state='error';status.textContent=error.message;}}
 }
 root.EduvizeTransportNativeOutput=Object.freeze({project,install});
 install();
})(window);
