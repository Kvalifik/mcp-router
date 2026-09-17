export function permissionUnavailable({ connection, channel, siteId, defaults = false }) {
  if (defaults) return null; // Defaults are a template, not a particular grant.
  const state = connection?.channels?.[channel];
  const label = channel === 'beta' ? 'Beta' : 'Stable';
  if (!state?.authorized) return `Authorize ${label} for this project before changing permissions.`;
  if (state.inventoryPending) return `Project access on ${label} is still being checked. Try again after it finishes.`;
  if (!state.siteIds?.includes(siteId)) return `This project isn’t authorized on ${label}. Reconnect and include this project.`;
  return null;
}

export function availablePreset(current, next, unavailable) {
  return Object.fromEntries(Object.entries(next).map(([key, value]) =>
    [key, unavailable(key) ? !!current[key] : value]));
}

export function connectionTestUnavailable(project, connection, selectedChannel) {
  if (!connection?.enabled) return 'Enable this connection before testing.';
  if (!project.enabled) return 'Enable this project in the project list before testing. New projects start disabled.';
  const canRead = project.permissions ? project.permissions['site:read'] : project.read;
  if (!canRead) return 'Save Site → Read permission before testing.';
  const savedChannel = project.channel && project.channel !== 'inherit' ? project.channel : connection.channel || 'stable';
  if (selectedChannel !== savedChannel) return 'Save the MCP version selection before testing.';
  return permissionUnavailable({connection,channel:savedChannel,siteId:project.siteId,key:'site:read'});
}
