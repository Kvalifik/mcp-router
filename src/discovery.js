import { randomUUID } from 'node:crypto';
import { PERMISSIONS, validatePermissions } from './permissions.js';
export const fullPermissions = () => Object.fromEntries(PERMISSIONS.map(key => [key, true]));

// Discovery changes local inventory only. Existing grants and enabled states are retained.
export function syncProjects(store, connectionId) {
  const c = store.connection(connectionId);
  const names = [...new Set((c.sites || []).map(s => s.workspaceName).filter(Boolean))];
  if (!Object.hasOwn(c, 'nameOverride')) c.nameOverride = c.name;
  c.sourceName = names.length === 1 ? names[0] : null;
  c.name = c.nameOverride || c.sourceName || c.name;
  const projects = Object.values(store.data.projects).filter(p => p.connectionId === connectionId);
  const sites = c.sites || [];
  for (const site of sites) {
    const matches = projects.filter(p => p.siteId === site.id);
    if (matches.length) {
      for (const p of matches) {
        if (p.deletedAt) { delete p.deletedAt; p.enabled = false; }
        if (!Object.hasOwn(p, 'nameOverride')) p.nameOverride = p.name === (p.sourceName || site.name) ? null : p.name;
        p.sourceName = site.name; p.name = p.nameOverride || p.sourceName;
        p.shortName = site.shortName || ''; p.available = true;
      }
    } else {
      const id = randomUUID(), grants = structuredClone(store.data.settings.defaultPermissions);
      store.data.projects[id] = { id, name:site.name, nameOverride:null, sourceName:site.name, shortName:site.shortName || '',
        connectionId, siteId:site.id, enabled:false, available:true, read:!!grants['site:read'], permissions:grants, usesDefaultPermissions:true };
    }
  }
  for (const p of projects) if (!p.deletedAt && !sites.some(s => s.id === p.siteId)) { p.available = false; p.enabled = false; }
}
export function purgeConnection(store, id) {
  const c=store.data.connections[id];
  if(!c)return;
  c.enabled=false;c.deletedAt=new Date().toISOString();
  delete c.tokens;delete c.client;delete c.pending;
  for(const [key,p] of Object.entries(store.data.projects))if(p.connectionId===id)delete store.data.projects[key];
  delete store.data.connections[id];
  if(store.data.settings?.connectionOrder)store.data.settings.connectionOrder=store.data.settings.connectionOrder.filter(value=>value!==id);
}
export function initializeInventory(store) {
  const before = JSON.stringify(store.data);
  for(const c of Object.values(store.data.connections))if(c.deletedAt)purgeConnection(store,c.id);
  store.data.settings ||= { defaultPermissions:fullPermissions() };
  for (const c of Object.values(store.data.connections)) if (!c.deletedAt) syncProjects(store, c.id);
  store.data.settings.defaultChannel ||= 'stable';
  for(const c of Object.values(store.data.connections)) {
    if(c.channel) {
      for(const p of Object.values(store.data.projects))if(p.connectionId===c.id&&(!p.channel||p.channel==='inherit'))p.channel=c.channel;
      delete c.channel;
    }
  }
  if (JSON.stringify(store.data) !== before) store.save();
}
export function setDefaults(store, value) {
  const grants = validatePermissions(value);
  store.data.settings.defaultPermissions = grants;
  for (const p of Object.values(store.data.projects)) {
    if (!p.enabled && !p.deletedAt && p.usesDefaultPermissions) { p.permissions = { ...grants }; p.read = !!grants['site:read']; }
  }
  store.audit('default_permissions_saved');
}
