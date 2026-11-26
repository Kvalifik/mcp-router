function includedInPreset(key, type) {
  if (type === 'all') return true;
  // Library management includes uninstallation and sharing a new version.
  if (key === 'libraries:write') return false;
  if (type === 'no-publishing') return !key.endsWith(':publish');
  if (type === 'read-write') return key.endsWith(':read') || key.endsWith(':write');
  return type === 'read' && key.endsWith(':read');
}

export function presetGrants(keys, type) {
  return Object.fromEntries(keys.map(key => [key, includedInPreset(key, type)]));
}

export function accessLabel(keys, grants) {
  const enabled = keys.filter(key => grants[key] === true);
  if (!enabled.length) return 'No permissions';
  if (enabled.length === keys.length) return 'Full access';
  const matches = type => keys.every(key => !!grants[key] === includedInPreset(key, type));
  if (matches('no-publishing')) return 'No publishing';
  if (matches('read-write')) return 'Read & write';
  if (enabled.every(key => key.endsWith(':read'))) return 'Read-only';
  return 'Custom access';
}
