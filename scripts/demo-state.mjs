// In-memory behavior for the fictional demo only. No router, OAuth, disk, or network access.
import { RouterActivity } from '../src/activity.js';
import { localDay, mondayOf, offsetDay } from '../src/activity-calendar.js';
import { validatePermissions, validateWorkspacePermissions, validateConnectionPermissions, connectionPermissionEdits } from '../src/permissions.js';
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
    if (path === '/settings/disabled-project-discovery') {
      if (typeof body.enabled !== 'boolean') throw new Error('Invalid settings');
      state.settings.discoverDisabledProjects = body.enabled;
    } else if (path === '/settings/default-channel') state.settings.defaultChannel = channel(body.channel);
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
        if (body.accessMode !== undefined) {
          if (kind !== 'connections' || !['managed','direct'].includes(body.accessMode)) throw new Error('Invalid access mode');
          update.accessMode = body.accessMode;
        }
        if (body.permissions !== undefined) update.permissions = validatePermissions(body.permissions);
        if (body.connectionPermissions !== undefined) {
          if(kind!=='connections')throw new Error('Connection permissions belong to a connection');
          update.connectionPermissions=validateConnectionPermissions(body.connectionPermissions);
        }
        if (body.workspacePermissions !== undefined) {
          if(kind!=='connections')throw new Error('Workspace permissions belong to a connection');
          update.workspacePermissions=validateWorkspacePermissions(body.workspacePermissions,item.sites||[]);
        }
        if (body.permissionEdits !== undefined) {
          if (kind !== 'connections' || 'connectionPermissions' in body || 'workspacePermissions' in body) throw new Error('Invalid permission edits');
          Object.assign(update, connectionPermissionEdits(item, body.permissionEdits));
        }
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

// The README and interactive demo use the production aggregator with fictional
// calls. Freeze screenshot time so a slow capture cannot age out its sample.
export function createDemoActivity(state, live) {
  const wallStart = Date.now();
  const anchor = new Date(wallStart).setHours(14, 14, 59, 0);
  const today = localDay(anchor);
  const first = offsetDay(mondayOf(today), -21);
  let sampleTime = new Date(first + 'T12:00:00').getTime();
  const clock = () => sampleTime ?? (live ? anchor + Date.now() - wallStart : anchor);
  const activity = new RouterActivity({data:{},save() {}}, clock);
  function add(index) {
    const project = state.projects[index];
    const connection = state.connections.find(c => c.id === project?.connectionId);
    if (connection?.enabled && (project.enabled || connection.accessMode === 'direct')) {
      activity.begin(connection.id, connection.accessMode === 'direct' ? null : project.id)(true);
    }
  }
  for (let i = 0; offsetDay(first, i) < today; i++) {
    const weekday = i % 7;
    if (weekday > 4 || (weekday === 3 && i % 2 === 1)) continue;
    sampleTime = new Date(offsetDay(first, i) + 'T12:00:00').getTime();
    for (let call = 0; call < (i * 17) % 91 + 3; call++) add(call % 5 === 0 ? 4 : 0);
  }
  const volumes = [6,8,10,12,8,15,20,24,17,12,10,8,7,10,12];
  const lastMinuteSeconds = [4,6,8,23,24,25,26,28,31,47,49,52];
  for (const [minute, total] of volumes.entries()) {
    for (let call = 0; call < total; call++) {
      const second = minute === 14 ? lastMinuteSeconds[call] : Math.floor(57 * call / total);
      sampleTime = anchor - (14 - minute) * 60000 - 59000 + second * 1000;
      const source = minute === 14 ? (call < 8 ? 0 : 1) : (call % 6 === 5 ? 4 : call % 6 === 4 ? 1 : 0);
      add(source);
    }
  }
  sampleTime = null;
  const bursts = [0, 1, 4, 2, 0, 0, 3, 1];
  let index = 0;
  return {activity, advanceTime(ms) { sampleTime = clock() + ms; }, tick() {
    const count = bursts[index++ % bursts.length];
    for (let i = 0; i < count; i++) add([0, 1, 0, 4][(index + i) % 4]);
  }};
}
