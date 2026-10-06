// Shared by the owner dashboard and menu bar. Never include upstream error text.
const grantReady = grant => !!grant?.authorized && grant.status === 'connected' && !grant.inventoryPending;
function grantIssue(connection, channel) {
  const grant = connection.channels?.[channel];
  const label = channel === 'beta' ? 'Beta' : 'Stable';
  if (!grant?.authorized) return { reason: `${label} authorization required`, action: 'authorize', actionLabel: `Authorize ${label}` };
  if (grant.status === 'check_failed') return { reason: `${label} access check failed`, action: 'check', actionLabel: 'Retry check' };
  if (grant.inventoryPending || ['authorized', 'awaiting_authorization'].includes(grant.status)) return { reason: `Checking ${label} access…`, pending: true, action: 'check', actionLabel: 'Retry check' };
  if (!grantReady(grant)) return { reason: `${label} access check failed`, action: 'check', actionLabel: 'Retry check' };
  return null;
}
function accessStatus(summary) {
  const connections = summary.connections.filter(c => c.enabled);
  const selected = summary.projects.filter(p => p.enabled && connections.some(c => c.id === p.connectionId));
  const issues = [];
  const readyProjectIds = [];
  for (const project of selected) {
    const connection = connections.find(c => c.id === project.connectionId);
    const channel = project.channel && project.channel !== 'inherit' ? project.channel : connection.channel || 'stable';
    const label = channel === 'beta' ? 'Beta' : 'Stable';
    let issue = grantIssue(connection, channel);
    if (!issue && project.available === false) issue = { reason: 'Project is no longer available', action: 'check', actionLabel: 'Sync projects' };
    if (!issue && !connection.channels[channel].siteIds?.includes(project.siteId)) issue = { reason: `Project not included in ${label} authorization`, action: 'authorize', actionLabel: `Reconnect ${label}` };
    if (!issue && !Object.values(project.permissions || {}).some(Boolean)) issue = { reason: 'No permissions selected', action: 'permissions', actionLabel: 'Review permissions' };
    if (issue) issues.push({ ...issue, projectId: project.id, connectionId: connection.id, name: project.name, connectionName: connection.name, channel });
    else readyProjectIds.push(project.id);
  }
  for (const connection of connections) {
    const channel = connection.channel || 'stable';
    const issue = grantIssue(connection, channel);
    if (issue && !issues.some(i => i.connectionId === connection.id && i.channel === channel)) issues.push({ ...issue, connectionId: connection.id, name: connection.name, channel });
  }
  return { connections: connections.filter(c => Object.values(c.channels || {}).some(grantReady)).length,
    projects: readyProjectIds.length, enabledProjects: selected.length, readyProjectIds, issues,
    attention: issues.some(i => !i.pending) };
}
module.exports = { accessStatus };
