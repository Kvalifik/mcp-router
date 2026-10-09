// Electron/Squirrel verifies the downloaded app against the running app's
// signing requirement. Renderer callers cannot supply URLs or install paths.
function createMacUpdater({checker,autoUpdater,arch,onChange=()=>{}}) {
 let state={state:'current'},pending=null,inFlight=false,timeout;
 const publish=value=>{state=value;onChange({...state});return {...state};};
 const clear=()=>{clearTimeout(timeout);inFlight=false;};
 autoUpdater.on('error',()=>{clear();publish({state:'error',reason:'install'});});
 autoUpdater.on('update-not-available',()=>{clear();publish({state:'current'});});
 autoUpdater.on('update-downloaded',()=>{
  if(!inFlight)return;
  clear();publish({state:'ready',version:state.version});
 });
 async function check() {
  if(inFlight||state.state==='ready'||state.state==='installing')return {...state};
  if(pending)return pending;
  pending=(async()=>{
   const result=await checker.check();
   const url=result.state==='available'?checker.macFeed(arch):null;
   if(!url)return publish(result);
   try {
    autoUpdater.setFeedURL({url,serverType:'json'});
    inFlight=true;
    publish({state:'downloading',version:result.version});
    timeout=setTimeout(()=>{
     // Squirrel cannot cancel a request. Keep it in flight to prevent duplicate
     // downloads; a late success/error still completes the request normally.
     publish({state:'error',reason:'download-timeout',version:result.version});
    },15*60*1000);
    timeout.unref?.();
    autoUpdater.checkForUpdates();
   }catch {clear();publish({state:'error',reason:'install'});}
   return {...state};
  })();
  try{return await pending;}finally{pending=null;}
 }
 function install() {
  if(state.state!=='ready')throw new Error('No verified update is ready');
  const version=state.version;
  publish({state:'installing',version});
  try {autoUpdater.quitAndInstall();}catch {publish({state:'ready',version});throw new Error('Could not restart to update');}
 }
 return {check,install,status:()=>({...state})};
}
module.exports={createMacUpdater};
