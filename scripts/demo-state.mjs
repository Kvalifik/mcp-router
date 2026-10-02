// In-memory behavior for the fictional demo only. No router, OAuth, disk, or network access.
import { validatePermissions } from '../src/permissions.js';
import { connectionTestUnavailable } from '../ui/permission-availability.js';

export function createDemoState(seed) {
  const state = structuredClone(seed);
  let sequence = 0;
  const channel = value => {
    if (!['stable', 'beta'].includes(value)) throw new Error('Invalid MCP version');
    return value;
  };
  const boolean = value => {
    if (typeof value !== 'boolean') throw new Error('Invalid toggle');
    return value;
  };
  function mutate(path, body = {}) {
    if (path === '/settings/default-channel') state.settings.defaultChannel = channel(body.channel);
    else if (path === '/settings/default-permissions') {
      const next = validatePermissions(body.permissions);
      for (const project of state.projects) {
        if (!project.enabled && JSON.stringify(project.permissions) === JSON.stringify(state.settings.defaultPermissions)) project.permissions = structuredClone(next);
      }
      state.settings.defaultPermissions = next;
    } else if (path === '/settings/connection-order') {
      if (!Array.isArray(body.ids) || body.ids.length !== state.connections.length || new Set(body.ids).size !== body.ids.length || body.ids.some(id => !state.connections.some(c => c.id === id))) throw new Error('Invalid order');
      state.connections = body.ids.map(id => state.connections.find(c => c.id === id));
    } else if (path === '/connections') {
      const id = `demo-added-${++sequence}`;
      const name = `Demo connection ${sequence}`;
      state.connections.push({ id, name, sourceName: name, enabled: true, channel: state.settings.defaultChannel, channels: {} });
      return { id };
    } else if (path === '/read-project') {
      const project = state.projects.find(p => p.id === body.projectId);
      if (!project) throw new Error('Unknown demo project');
      const connection = state.connections.find(c => c.id === project.connectionId);
      const reason = connectionTestUnavailable(project, connection, project.channel === 'inherit' ? connection.channel : project.channel);
      if (reason) throw new Error(reason);
      return { ok: true, simulated: true };
    } else {
      const match = path.match(/^\/(connections|projects)\/([a-z0-9-]+)\/(edit|toggle|delete|check|refresh|authorize)$/);
      if (!match) throw new Error('This action is unavailable in the demo.');
      const [, kind, id, action] = match;
      const item = state[kind].find(entry => entry.id === id);
      if (!item) throw new Error('Unknown demo item');
      if (action === 'edit') {
        const update = {};
        if (body.name !== undefined) {
          if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw new Error('Invalid name');
          update.name = body.name.trim();
        }
        if (body.useDefaultName) update.name = item.sourceName || item.name;
        if (body.dismissNaming) update.needsName = false;
        for (const key of ['enabled', 'favourite']) if (body[key] !== undefined) update[key] = boolean(body[key]);
        if (body.permissions !== undefined) update.permissions = validatePermissions(body.permissions);
        if (body.channel !== undefined) update.channel = body.channel === 'inherit' ? 'inherit' : channel(body.channel);
        Object.assign(item, update);
      } else if (kind !== 'connections') throw new Error('Unsupported demo action');
      else if (action === 'toggle') item.enabled = boolean(body.enabled);
      else if (action === 'delete') {
        state.connections = state.connections.filter(c => c.id !== id);
        state.projects = state.projects.filter(p => p.connectionId !== id);
      } else if (action === 'authorize') {
        const selected = channel(body.channel || item.channel || state.settings.defaultChannel);
        if (!state.projects.some(p => p.connectionId === id)) {
          const projectId = `${id}-project`;
          state.projects.push({ id: projectId, siteId: projectId, connectionId: id, name: 'Demo Playground', sourceName: 'Demo Playground', shortName: 'demo-playground', enabled: false, favourite: false, available: true, channel: 'inherit', permissions: structuredClone(state.settings.defaultPermissions) });
        }
        item.channels[selected] = { authorized: true, status: 'connected', siteIds: state.projects.filter(p => p.connectionId === id).map(p => p.siteId) };
        item.tokenFingerprint = 'fictional-demo';
        return { url: 'demo:authorized', simulated: true };
      } else {
        if (!item.enabled) throw new Error('Enable this connection before syncing.');
        item.lastError = null;
        return { sites: state.projects.filter(p => p.connectionId === id), simulated: true };
      }
    }
    return { ok: true };
  }
  return { state, mutate };
}
