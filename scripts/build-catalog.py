"""Build a pinned action catalog from a reviewed Webflow tools/list snapshot."""
import json,sys
from pathlib import Path
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
