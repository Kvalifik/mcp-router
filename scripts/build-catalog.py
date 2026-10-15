"""Build a pinned action catalog from a reviewed Webflow tools/list snapshot."""
import json,sys,copy
from pathlib import Path
if sys.argv[1]=='--refresh-beta-tools':
 stable,beta=[json.load(open(f)) for f in sys.argv[2:4]]
 tools={t['name']:t for t in beta};shared={t['name']:t for t in stable}
 catalog=json.loads(Path('src/catalog.json').read_text())
 families={'data_apps_tool','data_campaigns_tool','data_members_tool','data_optimize_tool','data_interactions_tool'}
 modal={'data_component_props_tool.create_prop','data_component_props_tool.update_prop','data_component_props_tool.set_component_instance_prop_values','data_element_settings_tool.set_settings','data_element_builder.build'}
 def actions(tool):
  items=tool['inputSchema']['properties']['actions']['items']
  return {'build':items} if tool['name']=='data_element_builder' else {k:v for variant in items.get('anyOf',[items]) for k,v in variant['properties'].items() if k!='label'}
 for name in families:
  old,new=shared[name]['inputSchema'],tools[name]['inputSchema']
  # Only the two reviewed standalone-create fields may differ from Stable.
  normalized=copy.deepcopy(new)
  if name=='data_apps_tool':
   create=actions({'name':name,'inputSchema':normalized})['create_app']
   for key in ['folder_id','site_specific_access']:del create['properties'][key]
  if normalized!=old:raise ValueError('Review new Beta family differences: '+name)
 for op in catalog:
  if op['tool'] in families:
   op['channels']=['stable','beta']
   schema=actions(tools[op['tool']])[op['action']]
   if schema!=op['schema']:op.setdefault('channelSchemas',{})['beta']=schema
   else:op.pop('channelSchemas',None)
  if op['id'] in modal:
   schema=actions(tools[op['tool']])[op['action']]
   if schema!=op.get('channelSchemas',{}).get('stable',op['schema']):raise ValueError('Review new Modal differences')
   op['schema']=schema;op.pop('channelSchemas',None)
 def add(tool,action,area,title,mode,scope=None,schema=None,alias=None,extra=None):
  schema=schema or actions(tools[tool])[action]
  op={'id':tool+'.'+(alias or action),'tool':tool,'action':action,'area':area,'title':title,'mode':mode,'permission':area+':'+mode,'extraPermissions':extra or ([] if mode=='read' else ['agent_instructions:read']),'topSite':None,'page':False,'builder':False,'direct':False,'channels':['beta'],'schema':schema}
  if scope:op['scope']=scope
  if alias:op['upstreamAlias']=True
  catalog[:]=[o for o in catalog if o['id']!=op['id']];catalog.append(op)
 add('data_workspaces_tool','list_workspaces','workspace_discovery','Workspace discovery','read','connection')
 add('data_recommendations_tool','update_recommendation_settings','recommendations','AEO recommendation settings','write')
 schema=copy.deepcopy(actions(tools['data_apps_tool'])['create_app']);del schema['properties']['site_id']
 add('data_apps_tool','create_app','standalone_apps','Standalone Cloud Apps','write','connection',schema,'create_standalone_app',['agent_instructions:read','scripts:write','apps:publish'])
 Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
 print(len(catalog),'reviewed operations');sys.exit(0)
if sys.argv[1]=='--refresh-project-tools':
 source=json.load(open(sys.argv[2]));catalog=json.loads(Path('src/catalog.json').read_text())
 tools={t['name']:t for t in source}
 def action_map(tool):
  items=tool['inputSchema']['properties']['actions']['items']
  if tool['name']=='data_element_builder':return {'build':items}
  return {k:v for variant in items.get('anyOf',[items]) for k,v in variant['properties'].items() if k!='label'}
 reviewed={
  'data_apps_tool':{'read':['get_app','get_app_domains','get_deployment','list_apps','list_deployments','list_environments','get_build_logs','get_runtime_logs','list_variables'],'write':['create_app','create_environment','update_app','update_environment'],'delete':['delete_app','delete_environment','delete_variable'],'publish':['redeploy','trigger_deployment']},
  'data_campaigns_tool':{'read':['get_campaign','get_campaign_task_status','get_engaged_accounts','get_form_submissions_count','get_opportunity_summary','get_page_variation_suggestions','get_page_variations','get_time_series','list_campaign_hub_sites','list_campaigns'],'write':['bulk_update_page_variations','create_campaign','create_page_variation','personalize_element','personalize_property','update_campaign','update_personalized_field'],'delete':['delete_campaign','delete_page_variation','unlink_delete_personalized_field']},
  'data_members_tool':{'read':['list_site_members','list_site_roles','list_workspace_members'],'write':['bulk_update_workspace_roles','grant_site_access','invite_workspace_member','update_site_role','update_workspace_role'],'delete':['remove_workspace_member','revoke_site_access']},
  'data_optimize_tool':{'read':['get_optimization_audience_insights','get_optimization_summary','get_optimization_trend','list_dimension_values','list_optimization_dimensions','list_optimization_goals','list_optimizations','list_optimize_resources']}}
 titles={'apps':'Cloud Apps','app_data':'Cloud logs & variables','campaigns':'Campaigns','site_access':'Site Access','workspace_members':'Workspace Members','optimize':'Optimize'}
 for name,modes in reviewed.items():
  tool=tools[name];props=tool['inputSchema']['properties'];entries=action_map(tool)
  if set(tool['inputSchema']['required'])!={'actions','session_id','agent_id','context'} or 'siteId' in props or 'pageId' in props:raise ValueError('Review tool envelope: '+name)
  if set(entries)!={a for names in modes.values() for a in names}:raise ValueError('Review changed actions: '+name)
  for mode,names in modes.items():
   for action in names:
    schema=entries[action];area={'data_apps_tool':'apps','data_campaigns_tool':'campaigns','data_members_tool':'site_access','data_optimize_tool':'optimize'}[name];scope='project'
    if name=='data_members_tool' and 'workspace_id' in schema['properties']:area='workspace_members';scope='workspace'
    if action in ['get_build_logs','get_runtime_logs','list_variables']:area='app_data'
    extra=[] if mode=='read' else ['agent_instructions:read']
    if name=='data_apps_tool' and mode in ['write','publish']:extra+=['scripts:write']
    if action in ['create_app','create_environment','update_environment','delete_app','delete_environment']:extra+=['apps:publish']
    if name=='data_campaigns_tool' and mode=='write':extra+=['scripts:write']
    if name=='data_campaigns_tool' and action=='create_campaign':extra+=['pages:write','assets:write']
    if name=='data_campaigns_tool' and action=='delete_campaign':extra+=['pages:delete','assets:delete']
    key=name+'.'+action
    op={'id':key,'tool':name,'action':action,'area':area,'title':titles[area],'mode':mode,'permission':area+':'+mode,'extraPermissions':extra,'topSite':None,'page':False,'builder':False,'direct':False,'channels':['stable'],'schema':schema}
    if scope=='workspace':op['scope']='workspace'
    catalog=[o for o in catalog if o['id']!=key];catalog.append(op)
 # Keep the previous Beta schemas: that grant was unavailable for this review.
 for key in ['data_component_props_tool.create_prop','data_component_props_tool.update_prop','data_component_props_tool.set_component_instance_prop_values','data_element_settings_tool.set_settings','data_element_builder.build']:
  name,action=key.split('.');tool=tools[name];op=next(o for o in catalog if o['id']==key)
  if op['topSite']!=('siteId' if 'siteId' in tool['inputSchema']['properties'] else None) or op['page']!=('pageId' in tool['inputSchema']['properties']):raise ValueError('Review changed targeting: '+key)
  op.setdefault('channelSchemas',{})['stable']=action_map(tool)[action]
 Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
 print(len(catalog),'reviewed operations');sys.exit(0)
if sys.argv[1]=='--refresh-interactions':
 source=json.load(open(sys.argv[2]))
 tool=next(t for t in source if t['name']=='data_interactions_tool')
 props=tool['inputSchema']['properties']
 if set(tool['inputSchema']['required'])!={'siteId','pageId','actions','session_id','agent_id','context'}:raise ValueError('Review interaction envelope')
 entries={k:v for variant in props['actions']['items']['anyOf'] for k,v in variant['properties'].items() if k!='label'}
 modes={'guide':'read','list_interactions':'read','get_interaction':'read','create_interaction':'write','update_interaction':'write','delete_interaction':'delete'}
 if set(entries)!=set(modes):raise ValueError('Review changed interaction actions')
 catalog=json.loads(Path('src/catalog.json').read_text())
 for action,mode in modes.items():
  key='data_interactions_tool.'+action
  op={'id':key,'tool':'data_interactions_tool','action':action,'area':'interactions','title':'Interactions (GSAP)','mode':mode,'permission':'interactions:'+mode,'extraPermissions':(['scripts:write'] if mode=='write' else [])+(['agent_instructions:read'] if mode!='read' else []),'topSite':'siteId','page':True,'builder':False,'direct':False,'channels':['stable'],'schema':entries[action]}
  catalog=[existing for existing in catalog if existing['id']!=key];catalog.append(op)
 Path('src/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
 print(len(catalog),'reviewed operations');sys.exit(0)
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
