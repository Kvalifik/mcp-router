import React, { useCallback, useEffect, useState } from 'react';
import { AnimatedReveal } from '@/components/ui/animated-content';
import { Button } from '@/components/ui/button';

const messages = {
  checking: 'Checking for updates…',
  installing: 'Restarting to update…',
  current: 'You’re up to date.',
  'no-release': 'No public release yet.',
  unconfigured: 'Update checking is unavailable.',
};

const errors = {
  timeout: 'Update check timed out. Try again.',
  network: 'Couldn’t reach GitHub. Check your connection.',
  'rate-limit': 'GitHub request limit reached. Try again later.',
  server: 'GitHub is unavailable. Try again later.',
  'invalid-response': 'Unexpected response from GitHub. Try again later.',
  install: 'Couldn’t prepare the update. Check again.',
  skip: 'Couldn’t skip this version. Check again.',
  download: 'Couldn’t open the download page. Check again.',
  notes: 'Couldn’t open the release notes. Check again.',
};

export function useUpdateBanner() {
  const [notice, setNotice] = useState(null);

  const report = useCallback((result, manual = false) => {
    const {state, version, reason} = result;
    if (state === 'skipped') return setNotice(null);
    if (['downloading', 'ready', 'available'].includes(state)) {
      setNotice({state, version});
    } else if (state === 'installing' || state === 'checking') {
      setNotice({state, text: messages[state]});
    } else if (manual || reason === 'install') {
      setNotice({state, text: messages[state] || errors[reason] || 'Update check failed. Try again.', temporary: true});
    } else {
      setNotice(null);
    }
  }, []);

  const check = useCallback(async (manual = false) => {
    if (!window.routerDesktop?.checkUpdates) return;
    if (manual) report({state: 'checking'});
    const result = await window.routerDesktop.checkUpdates(manual).catch(() => ({state: 'error'}));
    report(result, manual);
  }, [report]);

  useEffect(() => {
    const unsubscribe = window.routerDesktop?.onUpdateStatus?.(result => report(result));
    check();
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { unsubscribe?.(); clearInterval(timer); };
  }, [check, report]);

  useEffect(() => {
    if (!notice?.temporary) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  return {notice, check, report};
}

export function UpdateBanner({notice, report}) {
  const {state, text, version} = notice || {};
  const desktop = window.routerDesktop;
  function failed(reason) { report({state: 'error', reason}, true); }

  return <AnimatedReveal show={!!notice} className="update-banner-reveal">{notice && <div className="update-banner">
    <span role="status" className="min-w-0 flex-1 text-xs font-medium">{version ? <>
      {state === 'downloading' && 'Downloading '}
      <button type="button" role="link" className="cursor-pointer rounded-sm underline decoration-muted-foreground underline-offset-2 hover:decoration-current focus-visible:outline-ring" aria-label={`Release notes for ${version}`} title="View release notes" onClick={() => desktop.openUpdateNotes(version).catch(() => failed('notes'))}>{version}</button>
      {state === 'downloading' ? '…' : ` ${state}`}
    </> : text}</span>
    {version && <div className="flex items-center gap-1">
      <Button size="xs" variant="ghost" onClick={() => desktop.skipUpdate(version).catch(() => failed('skip'))}>Skip Version</Button>
      {state === 'ready' && <Button size="xs" title="Restart MCP Router to install. Active AI connections will briefly disconnect." aria-label="Update and restart MCP Router" onClick={() => desktop.installUpdate(version).catch(() => failed('install'))}>Update</Button>}
      {state === 'available' && <Button size="xs" onClick={() => desktop.downloadUpdate(version).catch(() => failed('download'))}>Download</Button>}
    </div>}
  </div>}</AnimatedReveal>;
}
