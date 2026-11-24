// Public attestation contains only hashes/counts/decisions, never provider payloads.
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {compareCatalog} from './check-webflow-catalog.mjs';
const reportPath='docs/release-review.json';
const digest=value=>createHash('sha256').update(value).digest('hex');
// Index blob IDs are independent of platform checkout line-ending conversion.
// Require all source edits staged before review; only this report may be unstaged.
execFileSync('git',['diff','--exit-code','--quiet','--','.',':!'+reportPath]);
const entries=execFileSync('git',['ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').filter(line=>line&&!line.endsWith('\t'+reportPath)).sort();
const sourceDigest=digest(entries.join('\0'));
const version=JSON.parse(fs.readFileSync('package.json')).version;
// These pilots defer the same reviewed Beta Libraries and Component definitions.
// The digest pins them; any upstream change requires a new decision.
function pilotDeferrals(channel, tools, catalog, comparison) {
 const result = {missing:[], outdated:[], deferred:[]};
 const faviconPilot = ['0.11.3-rc.1', '0.11.3-rc.2', '0.11.3-rc.3'].includes(version);
 if (channel !== 'beta' || (!faviconPilot && !/^0\.11\.[12](-rc\.\d+)?$/.test(version))) return result;
 const definitions = ['data_libraries_tool','data_component_tool'].map(name => tools.find(tool => tool.name === name));
 const expectedDigest = faviconPilot ? '4581531bf56fbc76f7c7d993c2ffcbffd141d92b417fdbe1ea0715e1e86bd566' : '84860394ee762d9aa91ae0c9f3ac1bb3192ad255cfc872dfda88d5c0185dbd99';
 if (digest(JSON.stringify(definitions)) !== expectedDigest) throw Error('Review the changed Beta Libraries and Components definitions');
 if (!isDeepStrictEqual(comparison.unclassifiedTools,['data_libraries_tool'])) throw Error('Review Beta tool classification');
 result.missing.push('data_libraries_tool');
 result.deferred.push({tool:'data_libraries_tool', reason:'All 14 actions await a workspace visibility, multi-site write and ownership review.'});
 for (const action of ['get_all_components','get_component','insert_component_instance','query_components']) {
  const id = 'data_component_tool.' + action;
  const change = comparison.changed.find(entry => entry.id === id);
  const op = catalog.find(entry => entry.id === id);
  const pinned = op.channelSchemas?.beta || op.schema;
  const live = definitions[1].inputSchema.properties.actions.items.anyOf.find(v => v.properties[action]).properties[action];
  if (!isDeepStrictEqual(change?.fields,['schema']) || !isDeepStrictEqual({...live, description:pinned.description},pinned)) throw Error('Review Beta component arguments: ' + action);
  result.outdated.push(id);
 }
 result.deferred.push({operations:result.outdated,reason:'Only descriptions changed. Review their library guidance with Shared Libraries support.'});
 return result;
}
if(process.argv[2]==='--record') {
 const catalog=JSON.parse(fs.readFileSync('src/catalog.json'));
 const channels={};
 for(const [index,channel] of ['stable','beta'].entries()) {
  const raw=fs.readFileSync(process.argv[index+3]);const tools=JSON.parse(raw);
  const comparison=compareCatalog(tools,catalog,channel);
  const gaps=pilotDeferrals(channel,tools,catalog,comparison);
  const remaining=comparison.changed.filter(change=>!gaps.outdated.includes(change.id));
  if(comparison.added.length||comparison.removed.length||comparison.unclassifiedTools.some(tool=>!gaps.missing.includes(tool))||remaining.some(x=>x.id!=='data_cms_tool.create_collection_items'||JSON.stringify(x.fields)!=='["schema"]'))throw Error(`Resolve ${channel} differences before recording review`);
  if(remaining.length) {
   const cms=tools.find(t=>t.name==='data_cms_tool');
   const variants=cms.inputSchema.properties.actions.items.anyOf;
   const schema=structuredClone(variants.find(v=>v.properties.create_collection_items).properties.create_collection_items);
   const request=schema.properties.request.properties;
   for(const field of [request.items.items.properties.fieldData,request.fieldData.items]) {
    const [record,required]=field.allOf;
    if(!isDeepStrictEqual(record.additionalProperties,{})||!isDeepStrictEqual(Object.keys(required.properties).sort(),['name','slug'])||required.additionalProperties!==false)throw Error('CMS correction shape changed');
    delete required.additionalProperties;
   }
   const op=catalog.find(o=>o.id==='data_cms_tool.create_collection_items');
   if(!isDeepStrictEqual(schema,op.channelSchemas?.[channel]||op.schema))throw Error('Unreviewed CMS schema changes');
  }
  channels[channel]={status:'reviewed',toolCount:tools.length,snapshotSha256:digest(raw),supportedOperations:catalog.filter(o=>!o.channels||o.channels.includes(channel)).length,...gaps,unverified:[],acceptedDifferences:remaining.map(x=>({...x,reason:'Reviewed narrow CMS fieldData export correction; custom field slugs remain accepted.'}))};
 }
 fs.writeFileSync(reportPath,JSON.stringify({version,reviewedAt:new Date().toISOString(),sourceDigest,channels,excluded:[{tools:['ask_webflow_ai','get_more_tools','webflow_guide_tool'],reason:'Utility guidance/discovery is handled by the router, not exposed as arbitrary execution.'},{tools:['webflow_home'],reason:'Account-wide home UI duplicates owner-managed inventory; agents use approved projects.'},{operation:'data_sites_tool.list_sites',reason:'Owner-managed inventory; agents use approved project discovery.'}],notes:'Complete paginated captures, guides and envelope differences reviewed locally. No customer mutations used for compatibility testing. New permissions default off for existing grants.'},null,2)+'\n');
 console.log('Recorded reviewed source digest and both channel outcomes');
} else {
 const report=JSON.parse(fs.readFileSync(reportPath));
 if(report.version!==version||report.sourceDigest!==sourceDigest)throw Error('Release review is stale: repeat the review on the final source tree');
 const age=Date.now()-Date.parse(report.reviewedAt);
 if(!Number.isFinite(age)||age< -300000||age>7*86400000)throw Error('Release review must be refreshed within seven days');
 for(const channel of ['stable','beta'])if(report.channels?.[channel]?.status!=='reviewed'||report.channels[channel].unverified.length)throw Error(`Incomplete ${channel} review`);
 console.log(`Release ${version}: current source tree and both channel reviews verified`);
}
