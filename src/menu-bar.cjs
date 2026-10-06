const MODES = ['off', 'icon', 'connections', 'projects', 'both'];
function menuBarMode(saved) { return MODES.includes(saved) ? saved : 'projects'; }
const { accessStatus } = require('./access-status.cjs');
function menuBarStatus(summary) { return accessStatus(summary); }
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
function createTrayTextUpdater(icons) {
  let previousTray, previousTitle, previousTooltip, previousAttention;
  return (tray, mode, status) => {
    const title = menuBarTitle(mode, status);
    const projectCount = status.attention
      ? `${status.projects} of ${status.enabledProjects ?? status.projects} enabled projects ready`
      : `${status.projects} ${status.projects===1?'project':'projects'}`;
    const tooltip = `${status.connections} ${status.connections===1?'connection':'connections'} · ${projectCount}${status.attention?' · Access needs attention':''}${(status.issues || []).map(issue => `\n${issue.name}: ${issue.reason} — ${issue.actionLabel}`).join('')}`;
    if (tray !== previousTray || title !== previousTitle) tray.setTitle(title, {fontType:'monospacedDigit'});
    if (tray !== previousTray || tooltip !== previousTooltip) tray.setToolTip(tooltip);
    if (icons && (tray !== previousTray || status.attention !== previousAttention)) tray.setImage(status.attention ? icons.warning : icons.normal);
    previousAttention = status.attention;
    previousTray = tray; previousTitle = title; previousTooltip = tooltip;
  };
}
module.exports = { MODES, menuBarMode, menuBarStatus, menuBarTitle, popoverBounds, createTrayTextUpdater };
