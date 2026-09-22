const MODES = ['off', 'icon', 'connections', 'projects', 'both'];
function menuBarMode(saved) { return MODES.includes(saved) ? saved : 'projects'; }
function menuBarStatus(summary) {
  const ready = grant => grant?.authorized && grant.status === 'connected' && !grant.inventoryPending;
  const connections = summary.connections.filter(c => c.enabled);
  const projects = summary.projects.filter(p => {
    const c = connections.find(c => c.id === p.connectionId);
    const channel = p.channel && p.channel !== 'inherit' ? p.channel : c?.channel || 'stable';
    const grant = c?.channels?.[channel];
    return p.enabled && p.available !== false && Object.values(p.permissions || {}).some(Boolean) && ready(grant) && grant.siteIds?.includes(p.siteId);
  });
  return {
    connections: connections.filter(c => Object.values(c.channels || {}).some(ready)).length,
    projects: projects.length,
    attention: connections.some(c => c.lastError || !ready(c.channels?.[c.channel || 'stable'])) || summary.projects.some(p => p.enabled && connections.some(c => c.id === p.connectionId) && !projects.includes(p)),
  };
}
function menuBarTitle(mode, status) {
  if (mode === 'both') return `${status.connections}/${status.projects}`;
  if (mode === 'connections') return String(status.connections);
  if (mode === 'projects') return String(status.projects);
  return '';
}
function popoverBounds(anchor, area) {
  const width = Math.min(400, area.width), height = Math.min(560, area.height);
  return { width, height, x: Math.round(Math.max(area.x, Math.min(anchor.x + anchor.width / 2 - width / 2, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(anchor.y + anchor.height + 4, area.y + area.height - height))) };
}
function createTrayTextUpdater() {
  let previousTray, previousTitle, previousTooltip;
  return (tray, mode, status) => {
    const title = menuBarTitle(mode, status);
    const tooltip = `${status.connections} enabled connections · ${status.projects} enabled projects${status.attention?' · Access needs attention':''}`;
    if (tray !== previousTray || title !== previousTitle) tray.setTitle(title, {fontType:'monospacedDigit'});
    if (tray !== previousTray || tooltip !== previousTooltip) tray.setToolTip(tooltip);
    previousTray = tray; previousTitle = title; previousTooltip = tooltip;
  };
}
module.exports = { MODES, menuBarMode, menuBarStatus, menuBarTitle, popoverBounds, createTrayTextUpdater };
