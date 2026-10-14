"""Build a pinned action catalog from a reviewed Webflow tools/list snapshot."""
import json,sys,copy
from pathlib import Path
# Incremental refresh preserves reviewed permission policy and excludes unrelated
# new families. Both channel snapshots must agree for shared schema updates.
if sys.argv[1] in ['--refresh-compatible','--refresh-site-branches','--refresh-site-reads']:
 stable, beta = [json.load(open(filename)) for filename in sys.argv[2:4]]
 def actions(tools):
  result={}
  for tool in tools:
   props=tool['inputSchema'].get('properties',{});items=props.get('actions',{}).get('items')
   if not items:continue
   entries=[('build',items)] if tool['name'] in ['data_element_builder','data_component_builder','data_whtml_builder'] else [(k,v) for variant in items.get('anyOf',items.get('oneOf',[items])) for k,v in variant.get('properties',{}).items() if k!='label']
   for action,schema in entries:result[tool['name']+'.'+action]=(schema,props)
  return result
 shared=actions(stable);preview=actions(beta)
 catalog=json.loads(Path('src/catalog.json').read_text())
 if sys.argv[1]=='--refresh-site-reads':
  reviewed_reads={
   'data_aeo_tool':['get_bot_traffic','get_bot_traffic_pages','get_citation_rate','get_citations','get_cited_domain_paths','get_competitor_citations','get_page_citation_share','get_prompt_execution','get_query_guide','get_top_cited_domains','get_visibility','get_visibility_breakdown','list_prompt_executions','list_prompts'],
   'data_recommendations_tool':['get_recommendation','get_recommendation_settings','get_recommendations_guide','get_recommendations_summary','list_recommendations']}
  for tool, names in reviewed_reads.items():
   for action in names:
    key=tool+'.'+action;schema,props=preview[key]
    beta_only=tool=='data_recommendations_tool'
    if beta_only and key in shared:raise ValueError('Review new Stable availability: '+key)
    if not beta_only and shared.get(key)!=(schema,props):raise ValueError('Channel schema or targeting differs: '+key)
    guide=action in ['get_query_guide','get_recommendations_guide']
    if 'siteId' in props or 'pageId' in props or (not guide and 'site_id' not in schema.get('required',[])) or (guide and schema.get('properties')):raise ValueError('Review site read targeting: '+key)
    op={'id':key,'tool':tool,'action':action,'area':'analyze','title':'Analytics','mode':'read','permission':'analyze:read','extraPermissions':[],'topSite':None,'page':False,'builder':False,'direct':False,'schema':schema}
    if beta_only:op['channels']=['beta']
    catalog=[existing for existing in catalog if existing['id']!=key];catalog.append(op)
  Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
  print(len(catalog),'reviewed operations');sys.exit(0)
 if sys.argv[1]=='--refresh-site-branches':
  for action,mode in [('list_site_branches','read'),('create_site_branch','write'),('stage_site_branch','publish'),('discard_site_branch','delete')]:
   key='data_pages_tool.'+action;schema,props=preview[key]
   if key in shared or 'siteId' in props or 'pageId' in props or 'site_id' not in schema.get('required',[]):raise ValueError('Review branch targeting/channel: '+key)
   op={'id':key,'tool':'data_pages_tool','action':action,'area':'pages','title':'Pages','mode':mode,'permission':'pages:'+mode,'extraPermissions':[] if mode=='read' else ['agent_instructions:read'],'topSite':None,'page':False,'builder':False,'direct':False,'channels':['beta'],'schema':schema}
   catalog=[existing for existing in catalog if existing['id']!=key];catalog.append(op)
  key='data_pages_tool.create_page'
  for op in catalog:
   if op['id']==key:
    if op['schema']!=shared[key][0]:raise ValueError('Review Stable page creation schema')
    op['channelSchemas']={'beta':preview[key][0]}
  Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
  print(len(catalog),'reviewed operations');sys.exit(0)
 reviewed={
  'data_cms_tool.create_collection_items','data_cms_tool.list_collection_items','data_cms_tool.publish_collection_items',
  'data_component_props_tool.create_prop','data_component_props_tool.update_prop','data_component_props_tool.set_component_instance_prop_values',
  'data_component_tool.get_all_components','data_component_tool.query_components','data_element_builder.build',
  'data_element_settings_tool.get_bindable_sources','data_element_settings_tool.get_settings','data_element_settings_tool.set_settings','data_sites_tool.publish_site'}
 for op in catalog:
  if op['id'] not in reviewed:continue
  schema,props=shared[op['id']]
  if schema != preview[op['id']][0]:raise ValueError('Channel schemas differ: '+op['id'])
  if op['topSite'] != ('siteId' if 'siteId' in props else None) or op['page'] != ('pageId' in props):raise ValueError('Targeting changed: '+op['id'])
  schema=copy.deepcopy(schema)
  if op['id']=='data_cms_tool.create_collection_items':
   # The upstream output-schema export closes the object half of a record /
   # object intersection. Only these fieldData maps accept custom CMS slugs.
   request=schema['properties']['request']['properties']
   for field in [request['items']['items']['properties']['fieldData'],request['fieldData']['items']]:
    record,required=field['allOf']
    if record.get('additionalProperties')!={} or set(required.get('properties',{}))!={'name','slug'} or required.get('additionalProperties') is not False:
     raise ValueError('CMS fieldData export changed; review compatibility correction')
    del required['additionalProperties']
  op['schema']=schema
 for action in ['get_browser_window_height_report','get_goal_performance','get_page_flow_report','get_scroll_depth_report','list_goals']:
  key='data_analyze_tool.'+action;schema,props=preview[key]
  if key not in shared or (schema,props)!=shared[key]:raise ValueError('Channel schema or targeting differs: '+key)
  op={'id':key,'tool':'data_analyze_tool','action':action,'area':'analyze','title':'Analytics','mode':'read','permission':'analyze:read','extraPermissions':[],'topSite':None,'page':False,'builder':False,'direct':False,'schema':schema}
  catalog=[existing for existing in catalog if existing['id']!=key];catalog.append(op)
 Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
 print(len(catalog),'reviewed operations');sys.exit(0)
source=json.load(open(sys.argv[1]))
groups={'agent_instructions':'Instructions','analyze':'Analytics','cms':'CMS','localization':'Localization','pages':'Pages','scripts':'Custom code','site':'Site','comments':'Comments','enterprise':'Enterprise settings','forms':'Forms','fonts':'Fonts','webhook':'Webhooks','sitemap':'Sitemap','assets':'Assets','style':'Styles','component':'Components','component_props':'Component properties','component_variants':'Component variants','variable':'Variables','element':'Elements','element_settings':'Element settings','element_builder':'Element builder','whtml_builder':'HTML builder','component_builder':'Component builder','designer':'Designer session','asset':'Designer uploads','snapshot':'Snapshots'}
catalog=[]
for t in source:
 name=t['name'];top=t['inputSchema']; props=top.get('properties',{})
 if name in ['ask_webflow_ai','get_more_tools','webflow_guide_tool']:continue
 area=name.removeprefix('data_').removesuffix('_tool')
 if name=='data_sites_tool':area='site'
 if name=='get_asset_preview':area='assets'
 if name=='element_snapshot_tool':area='snapshot'
 items=props.get('actions',{}).get('items')
 builder=name in ['data_element_builder','data_component_builder','data_whtml_builder']
 if items:
  variants=items.get('anyOf',items.get('oneOf',[items])); entries=[('build',items)] if builder else [(k,v) for item in variants for k,v in item.get('properties',{}).items() if k!='label']
 else:entries=[('preview' if name=='get_asset_preview' else 'snapshot',{'type':'object','properties':{k:v for k,v in props.items() if k not in ['siteId','agent_id','session_id','context']},'required':[k for k in top.get('required',[]) if k not in ['siteId','agent_id','session_id','context']],'additionalProperties':False})]
 for action,schema in entries:
  if action=='list_sites':continue # owner dashboard only
  mode='read' if action.startswith(('get_','list_','query_','search_','check_','read_')) or action in ['preview','snapshot'] else 'write'
  if action.startswith(('delete_','remove_','clear_','unregister_')):mode='delete'
  if action.startswith(('publish_','unpublish_')):mode='publish'
  if name=='designer_tool' and action in ['open_canvas','open_component_view','close_component_view','select_element','switch_page']:mode='write'
  # All canvas changes can introduce embedded code via element settings/bindings.
  extra=['scripts:write'] if mode!='read' and area in ['element','element_settings','element_builder','whtml_builder','component_builder','component_props','component'] else []
  if mode!='read':extra.append('agent_instructions:read')
  catalog.append({'id':name+'.'+action,'tool':name,'action':action,'area':area,'title':groups[area],'mode':mode,'permission':area+':'+mode,'extraPermissions':extra,'topSite':'siteId' if 'siteId' in props else None,'page': 'pageId' in props,'builder':builder,'direct':not bool(items),'schema':schema})
Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
print(len(catalog),'reviewed operations')
