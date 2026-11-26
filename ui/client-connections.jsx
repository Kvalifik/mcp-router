import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from './components/ui/button.jsx';
import { AnimatedReveal, AnimatedText, AnimatedWords } from './components/ui/animated-content.jsx';
import { ActionMenu } from './settings-menu.jsx';
import { notice } from './notifications.jsx';

const dismissKey = 'mcp-router-dismissed-app-setup';
const statuses = {
  configured: 'Set up',
  'not-connected': 'Not set up',
  'needs-reconnect': 'Needs reconnecting',
  error: 'Can’t read configuration',
};

function appIcon(id) {
  if (['codex', 'claude-desktop'].includes(id)) return 'MessageSquare';
  if (['cursor', 'vscode', 'antigravity'].includes(id)) return 'Code2';
  return 'Terminal';
}

function setupAction(client, connect) {
  const reconnect = ['configured', 'needs-reconnect'].includes(client.state);
  return {
    id: `connect-${client.id}`,
    label: reconnect ? 'Reconnect' : 'Set up',
    icon: reconnect ? 'RefreshCw' : 'Plus',
    onSelect: () => connect(client),
  };
}

async function copyConfiguration(format, label) {
  try {
    await window.routerDesktop.copyClientConfig(format);
    const message = format === 'agent' ? 'Setup instructions copied. Paste them into your AI app.' : `${label} configuration copied to clipboard.`;
    notice.success(message, {duration:6000});
  } catch {
    notice.error('Could not copy configuration.');
  }
}

export function useClientConnections() {
  const [clients, setClients] = useState();
  const [pending, setPending] = useState(null);
  const latestRead = useRef(0);
  const menuButton = useRef(null);

  useEffect(() => {
    if (!window.routerDesktop) return;
    async function refresh() {
      const request = ++latestRead.current;
      try {
        const result = await window.routerDesktop.clientStatus();
        if (request === latestRead.current) setClients(result);
      } catch {
        if (request === latestRead.current) setClients(null);
      }
    }
    refresh();
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      latestRead.current++;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  async function connect(client) {
    if (pending) return;
    setPending(client.id);
    const id = notice.loading(`Setting up ${client.name}…`);
    try {
      const result = await window.routerDesktop.connectClient(client.id);
      if (!result.ok) throw new Error(result.error);
      // Ignore any poll started before the registration was verified.
      latestRead.current++;
      setClients(current => (current ?? clients).map(item => item.id === client.id ? {...item, state:'configured'} : item));
      notice.success(result.message, {id, duration:10000});
    } catch (error) {
      notice.error(error.message, {id, duration:6000});
    } finally {
      setPending(null);
    }
  }

  const installed = clients?.filter(client => client.installed) ?? [];
  const configuredCount = installed.filter(client => client.state === 'configured').length;
  return {clients, installed, configuredCount, pending, connect, menuButton};
}

export function AppsMenu({apps}) {
  if (!window.routerDesktop) return null;
  const {clients, installed, configuredCount, pending, connect, menuButton} = apps;
  const label = clients ? `Apps (${configuredCount}/${installed.length})` : 'Apps';
  const description = clients ? `${configuredCount} of ${installed.length} detected apps set up` : 'App connections';
  const items = installed.map(client => {
    const configured = client.state === 'configured';
    const needsAttention = ['error', 'needs-reconnect'].includes(client.state);
    const statusIcon = configured ? 'Check' : needsAttention ? 'TriangleAlert' : null;
    return {
      label: client.name,
      icon: statusIcon ?? appIcon(client.id),
      children: [
        {id:`status-${client.id}`, label:statuses[client.state], icon:statusIcon ?? 'Info', disabled:true},
        ...(configured ? [{id:`hint-${client.id}`, label:client.hint, icon:'Info', disabled:true}] : []),
        {separator:true},
        setupAction(client, connect),
      ],
    };
  });
  if (!installed.length) {
    const label = clients === undefined ? 'Checking installed apps…' : clients === null ? 'Could not check installed apps' : 'No supported apps detected';
    items.push({id:'no-installed-apps', label, icon:'Info', disabled:true});
  }
  const missing = clients?.filter(client => !client.installed) ?? [];
  if (missing.length) {
    items.push({label:'Not installed', icon:'Plus', children:missing.map(client => ({
      id:`download-${client.id}`, label:client.name, icon:appIcon(client.id),
      onSelect:async () => {
        try { await window.routerDesktop.clientDownload(client.id); }
        catch { notice.error('Could not open the download page.'); }
      },
    }))});
  }
  items.push({separator:true}, {label:'Copy configuration', icon:'Copy', children:
    [['standard','Standard MCP'], ['vscode','VS Code'], ['agent','Agent setup snippet']].map(([format, label]) => ({
      id:`copy-${format}`, label, icon:'Copy', onSelect:() => copyConfiguration(format, label),
    })),
  });
  return <ActionMenu items={items} trigger={
    <Button ref={menuButton} className="app-client-menu" variant="outline" size="sm" aria-label={label} title={description} disabled={!!pending}>
      <Sparkles /><AnimatedText className="tabular-nums">{label}</AnimatedText><ChevronDown className="size-3" aria-hidden="true" />
    </Button>
  } />;
}

export function AppSetupPrompt({apps, hasEnabledProject}) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === 'true'; }
    catch { return false; }
  });
  const {clients, installed, configuredCount, pending, connect, menuButton} = apps;
  const show = hasEnabledProject && !dismissed && !!clients?.length && configuredCount === 0;

  let action;
  let message = 'Set up an AI app to use your Webflow projects.';
  if (!installed.length) {
    message = 'No supported AI apps detected. You can set up another MCP client manually.';
    action = <Button size="sm" variant="outline" onClick={() => copyConfiguration('agent')}><Copy />Copy setup instructions</Button>;
  } else if (installed.every(client => client.state === 'error')) {
    message = 'MCP Router couldn’t read your AI app settings. Check the configuration, then retry setup in Apps.';
    action = <Button size="sm" variant="outline" onClick={() => menuButton.current?.click()}><Sparkles />Open Apps</Button>;
  } else if (installed.length === 1) {
    const client = installed[0];
    const setup = setupAction(client, connect);
    const Icon = client.state === 'needs-reconnect' ? RefreshCw : Plus;
    action = <Button size="sm" disabled={!!pending} onClick={setup.onSelect}><Icon />{setup.label} {client.name}</Button>;
  } else {
    const choices = installed.map(client => {
      const setup = setupAction(client, connect);
      const unreadable = client.state === 'error';
      return {...setup, label:unreadable ? `${client.name} — check settings` : `${setup.label} ${client.name}`,
        icon:unreadable ? 'TriangleAlert' : appIcon(client.id), disabled:unreadable};
    });
    action = <ActionMenu items={choices} trigger={<Button size="sm" disabled={!!pending}>Choose an AI app<ChevronDown className="size-3" /></Button>} />;
  }
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(dismissKey, 'true'); } catch { /* Keep this session dismissed. */ }
    menuButton.current?.focus();
  }
  return <AnimatedReveal show={show} className="app-setup-reveal full-window-only">{show && <section aria-label="AI app setup" className="mt-4 flex items-center gap-3 rounded-lg border bg-background p-3">
    <p className="min-w-0 flex-1 text-sm"><AnimatedWords>{message}</AnimatedWords></p>
    {action}
    <Button size="icon-xs" variant="ghost" aria-label="Dismiss AI app setup" onClick={dismiss}><X /></Button>
  </section>}</AnimatedReveal>;
}
