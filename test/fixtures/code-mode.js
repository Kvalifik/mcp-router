import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/store.js';
import { Router } from '../../src/router.js';
export const site = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const itemsOperation = 'data_cms_tool.list_collection_items';
export const envelope = (action,result) => ({content:[{type:'text',text:JSON.stringify({action,result})}]});
export const unwrap = response => JSON.parse(response.content[0].text).result;
export function fixture({count=1200, delayMs=0, intercept=async()=>{}}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-code-synthetic-'));
  const store=new Store(dir), metrics={opens:0,calls:0};
  const items=Array.from({length:count},(_,i)=>({id:`item-${i}`,fieldData:{name:`Course ${i}`,category:i%10===0?'selected':'other',body:'Synthetic content. '.repeat(250)}}));
  const router=new Router(store,{provider:(id,interactive,channel)=>({id,channel})},{open:async provider=>{
    metrics.opens++; if(delayMs) await new Promise(r=>setTimeout(r,delayMs));
    return {listSites:async()=>[{id:site}],close:async()=>{},call:async(tool,args)=>{
      metrics.calls++; if(delayMs) await new Promise(r=>setTimeout(r,delayMs));
      const action=Object.keys(args.actions[0]).find(k=>k!=='label');
      const overridden=await intercept({tool,args,action,provider,router,store});
      if(overridden!==undefined)return overridden;
      if(action==='search_instructions')return envelope(action,{instructions:[],pagination:{total:0}});
      if(action==='get_collection_list')return envelope(action,{collections:[{id:'owned-collection'}]});
      if(action==='list_collection_items'){
        const {offset=0,limit=100}=args.actions[0][action].request||{};
        return envelope(action,{items:items.slice(offset,offset+limit),pagination:{total:items.length,offset,limit}});
      }
      throw new Error('Unexpected synthetic operation');
    }};
  }});
  const connectionId=router.createConnection('Synthetic workspace');
  store.connection(connectionId).sites=[{id:site,name:'Synthetic site'}];
  store.connection(connectionId).tokens={access_token:'synthetic-only'};
  router.saveProject({id:'p',name:'Synthetic project',connectionId,siteId:site,enabled:true});
  router.edit('projects','p',{permissions:{'cms:read':true,'agent_instructions:read':true}});
  return {router,store,metrics,connectionId,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
export const snippet = `
const matches = [];
for (let offset = 0; ; offset += 100) {
  const response = read('${itemsOperation}', {collection_id:'owned-collection',request:{limit:100,offset}});
  const page = JSON.parse(response.content[0].text).result;
  for (const item of page.items) if (item.fieldData.category === 'selected') matches.push({id:item.id,name:item.fieldData.name});
  if (offset + page.items.length >= page.pagination.total) break;
}
print(matches);
`;
