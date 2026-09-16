export function presetGrants(keys, type) {
  return Object.fromEntries(keys.map(key => [key,
    type === 'all' ||
    type === 'no-publishing' && !key.endsWith(':publish') ||
    type === 'read' && key.endsWith(':read')
  ]));
}

export function accessLabel(keys, grants) {
  const enabled = keys.filter(key => grants[key] === true);
  if (!enabled.length) return 'No permissions';
  if (enabled.length === keys.length) return 'Full access';
  if (keys.every(key => !!grants[key] === !key.endsWith(':publish'))) return 'No publishing';
  if (enabled.every(key => key.endsWith(':read'))) return 'Read-only';
  return 'Custom access';
}
