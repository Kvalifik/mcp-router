import React, {useSyncExternalStore} from 'react';
import {Check, Info, LoaderCircle, TriangleAlert, X} from 'lucide-react';
import {AnimatedReveal} from './components/ui/animated-content';
import {Button} from './components/ui/button';

const listeners = new Set();
const pending = new Map();
let current = null;
let nextId = 0;
let timer;

function refresh() {
  const next = pending.values().next().value || null;
  if (current === next) return;
  current = next;
  clearTimeout(timer);
  if (next && Number.isFinite(next.duration)) timer = setTimeout(() => dismiss(next.id), next.duration);
  for (const notify of listeners) notify();
}

function dismiss(id) {
  pending.delete(id);
  refresh();
}

function publish(kind, text, {id = ++nextId, duration} = {}) {
  const item = {id, kind, text, duration:duration ?? (kind === 'success' ? 2000 : 6000)};
  if (kind === 'loading') item.duration = Infinity;
  pending.set(id, item);
  refresh();
  return id;
}

export const notice = Object.fromEntries(['success','info','error','loading'].map(kind =>
  [kind, (text, options) => publish(kind, text, options)]));

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const icons = {success:Check, info:Info, error:TriangleAlert, loading:LoaderCircle};
export function NotificationStrip() {
  const item = useSyncExternalStore(subscribe, () => current);
  const Icon = item && icons[item.kind];
  return <AnimatedReveal show={!!item} className="update-banner-reveal">{item && <div className="update-banner">
    <Icon aria-hidden="true" className="size-4 shrink-0" />
    <span role={item.kind === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 break-words text-xs">{item.text}</span>
    <Button size="icon-xs" variant="ghost" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X /></Button>
  </div>}</AnimatedReveal>;
}
