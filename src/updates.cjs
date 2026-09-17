const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function newer(candidate, current) {
 const a=VERSION.exec(candidate),b=VERSION.exec(current);
 if(!a||!b)return false;
 for(let i=1;i<=3;i++){if(BigInt(a[i])!==BigInt(b[i]))return BigInt(a[i])>BigInt(b[i]);}
 return false;
}
function createUpdateChecker({repository,currentVersion,fetchImpl=fetch}) {
 const valid=typeof repository==='string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository);
 let latest=null,pending;
 async function check() {
  if(!valid)return {state:'unconfigured'};
  if(pending)return pending;
  pending=(async()=>{
   try {
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(response.status===404)return {state:'no-release'};
    if(!response.ok)return {state:'error',reason:response.status===429 || response.status===403 && response.headers?.get('x-ratelimit-remaining')==='0'?'rate-limit':'server'};
    const text=await response.text();if(text.length>1048576)throw new Error('Response too large');
    const release=JSON.parse(text);
    if(release.draft||release.prerelease||typeof release.tag_name!=='string'||!VERSION.test(release.tag_name))return {state:'no-release'};
    if(newer(release.tag_name,currentVersion)){
     latest=`https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`;
     return {state:'available',version:release.tag_name.replace(/^v/,'')};
    }
    latest=null;return {state:'current'};
   }catch(error){return {state:'error',reason:['TimeoutError','AbortError'].includes(error?.name)?'timeout':error instanceof SyntaxError?'invalid-response':'network'};}
  })();
  try{return await pending;}finally{pending=null;}
 }
 return {check,releaseUrl:()=>latest};
}
module.exports={createUpdateChecker,newer};
