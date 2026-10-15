// Compare a complete upstream tools/list snapshot without changing runtime policy.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const excluded = new Set(['ask_webflow_ai', 'get_more_tools', 'webflow_guide_tool']);
const builders = new Set(['data_element_builder', 'data_component_builder', 'data_whtml_builder']);

export function compareCatalog(snapshot, catalog, channel) {
  catalog=catalog.filter(op=>!op.upstreamAlias);
  if(channel) catalog=catalog.filter(op=>!op.channels || op.channels.includes(channel)).map(op=>({...op,schema:op.channelSchemas?.[channel]||op.schema}));
  const tools = Array.isArray(snapshot) ? snapshot : snapshot?.tools;
  if (!Array.isArray(tools) || !tools.length || snapshot?.nextCursor) throw Error('A complete, nonempty tools/list snapshot is required');
  const upstream = new Map(), seen = new Set(), unclassifiedTools = [];
  for (const tool of tools) {
    if (typeof tool?.name !== 'string' || !tool.inputSchema?.properties || seen.has(tool.name)) throw Error('Invalid or duplicate upstream tool');
    seen.add(tool.name);
    if (excluded.has(tool.name)) continue;
    const props = tool.inputSchema.properties;
    const items = props.actions?.items;
    const known = catalog.some(op => op.tool === tool.name);
    // Unknown tool shapes need explicit review, not a guessed read/write permission.
    if (!known) { unclassifiedTools.push(tool.name); continue; }
    const builder = builders.has(tool.name);
    let entries;
    if (items) {
      const variants = items.anyOf || items.oneOf || [items];
      if (!Array.isArray(variants) || variants.some(v => !v.properties)) throw Error('Unsupported upstream action schema');
      entries = builder ? [['build', items]] : variants.flatMap(v => Object.entries(v.properties).filter(([key]) => key !== 'label'));
    } else {
      const omitted = new Set(['siteId', 'agent_id', 'session_id', 'context']);
      entries = [[tool.name === 'get_asset_preview' ? 'preview' : 'snapshot', {
        type: 'object', properties: Object.fromEntries(Object.entries(props).filter(([key]) => !omitted.has(key))),
        required: (tool.inputSchema.required || []).filter(key => !omitted.has(key)), additionalProperties: false,
      }]];
    }
    for (const [action, schema] of entries) {
      if (action === 'list_sites') continue;
      const id = `${tool.name}.${action}`;
      if (upstream.has(id)) throw Error('Duplicate upstream action');
      upstream.set(id, { schema, topSite: 'siteId' in props ? 'siteId' : null, page: 'pageId' in props, builder, direct: !items });
    }
  }
  const pinned = new Map(catalog.map(op => [op.id, op]));
  const added = [], changed = [], removed = [];
  for (const [id, candidate] of upstream) {
    const existing = pinned.get(id);
    if (!existing) { added.push(id); continue; }
    const fields = Object.keys(candidate).filter(key => !isDeepStrictEqual(candidate[key], existing[key]));
    if (fields.length) changed.push({ id, fields });
  }
  for (const id of pinned.keys()) if (!upstream.has(id)) removed.push(id);
  return { added: added.sort(), changed: changed.sort((a,b) => a.id.localeCompare(b.id)), removed: removed.sort(), unclassifiedTools: unclassifiedTools.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [channel, filename] = process.argv.slice(2);
    if (!['stable', 'beta'].includes(channel) || !filename || process.argv.length !== 4) throw Error('Usage: node scripts/check-webflow-catalog.mjs stable|beta SNAPSHOT.json');
    const report = compareCatalog(JSON.parse(fs.readFileSync(filename, 'utf8')), JSON.parse(fs.readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8')), channel);
    const reviewRequired = Object.values(report).some(entries => entries.length);
    console.log(JSON.stringify({ channel, reviewRequired, ...report }, null, 2));
    process.exitCode = reviewRequired ? 1 : 0;
  } catch {
    console.error('Catalog check failed. Supply stable|beta and a complete valid tools/list JSON snapshot; no catalog was changed.');
    process.exitCode = 2;
  }
}
