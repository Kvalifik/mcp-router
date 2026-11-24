import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, ChevronDown, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import './activity.css';
import { offsetDay } from '../src/activity-calendar.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const weekFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const formatDay = (key, format = dayFormat) => format.format(new Date(key + 'T12:00:00Z'));
const callCount = n => numberFormat.format(n) + (n === 1 ? ' call' : ' calls');
const emptyBins = Array(12).fill(0);
const sum = values => values.reduce((a, b) => a + b, 0);

// Only request the data the visible surface needs. The next request starts
// after the previous one finishes, even if the daemon or machine is busy.
function useActivity(view, enabled) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer, controller;
    async function refresh() {
      if (document.hidden || controller) return;
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch('/api/activity?view=' + view, { signal: request.signal });
        if (!response.ok) throw new Error('Unavailable');
        const next = await response.json();
        if (!request.signal.aborted) { setData(next); setFailed(false); }
      } catch {
        if (!request.signal.aborted) setFailed(true);
      } finally {
        if (controller === request) controller = null;
        if (!request.signal.aborted) timer = setTimeout(refresh, view === 'weeks' ? 15000 : 2000);
      }
    }
    function stop() {
      clearTimeout(timer);
      controller?.abort();
      controller = null;
    }
    function visibilityChanged() {
      stop();
      if (!document.hidden) void refresh();
    }
    void refresh();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => { stop(); document.removeEventListener('visibilitychange', visibilityChanged); };
  }, [view, enabled]);
  return { data, failed };
}

function MiniBars({ bins, large = false }) {
  const max = Math.max(1, ...bins);
  return <span aria-hidden="true" className={'activity-spark' + (large ? ' activity-spark-large' : '')}>
    {bins.map((value, i) => <i key={i} style={{ height: (100 * value / max) + '%' }} />)}
  </span>;
}

function Sources({ rows, inventory, daily = false }) {
  const groups = new Map();
  const connections = new Map(inventory.connections.map(c => [c.id, c.name]));
  const projects = new Map(inventory.projects.map(p => [p.id, p.name]));
  for (const {connectionId, projectId, calls} of rows) {
    if (!groups.has(connectionId)) groups.set(connectionId, {
      id: connectionId, name: connectionId === 'removed' ? 'Removed connections' : connections.get(connectionId) || 'Unavailable connection', total: 0, projects: []
    });
    const group = groups.get(connectionId);
    group.total += calls;
    if (!daily && connectionId !== 'removed') group.projects.push({
      id: projectId, name: projectId ? projects.get(projectId) || 'Unavailable project' : 'Direct calls', calls
    });
  }
  return <ul className="activity-sources">{Array.from(groups.values()).sort((a,b) => a.name.localeCompare(b.name)).map(group =>
    <li key={group.id}>
      <div className="activity-source"><strong>{group.name}</strong><strong>{numberFormat.format(group.total)}</strong></div>
      {group.projects.length > 0 && <ul>{group.projects.sort((a,b) => a.name.localeCompare(b.name)).map(project => <li className="activity-source" key={project.id === null ? 'direct' : 'project:' + project.id}>
        <span>{project.name}</span><span>{numberFormat.format(project.calls)}</span>
      </li>)}</ul>}
    </li>)}</ul>;
}

export function ActivityPulse({ inventory, enabled, triggerRef, onInspect }) {
  const { data, failed } = useActivity('pulse', enabled);
  const [open, setOpen] = useState(false);
  const navigating = useRef(false);
  const bins = data?.bins || emptyBins;
  const total = sum(bins);
  const running = sum((data?.running || []).map(row => row.calls));
  const rate = failed ? 'Unavailable' : !data ? 'Activity' : total ? callCount(total) + '/min' : running ? '' : 'Idle';
  const pending = !failed && running > 0 ? numberFormat.format(running) + ' in progress' : '';
  const label = [rate, pending].filter(Boolean).join(' · ');
  return <Popover open={open && enabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} size="sm" variant="outline" className="activity-pulse" aria-label={'Router activity: ' + label}>
        <MiniBars bins={failed ? emptyBins : bins} /><span className="activity-pulse-full">{label}</span>
        <span className="activity-pulse-short" aria-hidden="true">{pending || rate}</span><ChevronDown className="size-3" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" collisionPadding={10} aria-label="Router activity" className="activity-popover"
      onCloseAutoFocus={event => { if (navigating.current) { event.preventDefault(); navigating.current = false; } }}>
      <div className="activity-popover-head"><strong>Last 60 seconds</strong>{data && !failed && <span>{callCount(total)}</span>}</div>
      {failed || !data ? <p className="activity-note">{failed ? 'Activity is unavailable. Reconnecting…' : 'Loading activity…'}</p> :
        <>
          <MiniBars bins={bins} large /><div className="activity-range"><span>60s ago</span><span>Now</span></div>
          <div className="activity-popover-list">
            {running > 0 && <section><h3>{pending}</h3><Sources rows={data.running} inventory={inventory} /></section>}
            {total > 0 ? <section>{running > 0 && <h3>Finished</h3>}<Sources rows={data.sources} inventory={inventory} /></section>
              : <p className="activity-note">{running ? 'Waiting for calls to finish.' : 'No calls in the last minute.'}</p>}
          </div>
        </>}
      <Button size="sm" variant="ghost" className="activity-open" onClick={() => {
        navigating.current = true; setOpen(false); onInspect();
      }}>Open activity <ArrowUpRight className="size-4" /></Button>
    </PopoverContent>
  </Popover>;
}

function MinutesChart({ snapshot, selected, onSelect }) {
  const buttons = useRef([]);
  const peak = Math.max(2, ...snapshot.minutes.map(m => m.calls));
  const step = 10 ** Math.max(0, Math.floor(Math.log10(peak / 2)) - 1);
  const half = Math.ceil(peak / (2 * step)) * step;
  function onKey(event, index) {
    const first = snapshot.minutes.findIndex(m => m.at + 60000 > snapshot.startedAt);
    const targets = { ArrowRight: Math.min(14, index + 1), ArrowLeft: Math.max(first, index - 1), Home: first, End: 14 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    const next = targets[event.key];
    buttons.current[next]?.focus();
    onSelect(snapshot.minutes[next].at);
  }
  return <section className="activity-card minute-chart" aria-label="Calls per minute">
    <div className="activity-chart-heading"><h3>Calls per minute</h3>
      {snapshot.startedAt > snapshot.minutes[0].at && <span>Since {timeFormat.format(snapshot.startedAt)}</span>}
    </div>
    <div className="minute-plot">
      <div className="minute-axis" aria-hidden="true">{[half * 2, half, 0].map(n => <span key={n}>{numberFormat.format(n)}</span>)}</div>
      <div className="minute-columns" role="group" aria-label="Select a minute">
        {snapshot.minutes.map((minute, i) => {
          const available = minute.at + 60000 > snapshot.startedAt;
          const label = timeFormat.format(minute.at) + ' · ' + (available ? callCount(minute.calls) : 'Before router startup');
          return <button type="button" key={minute.at} title={label} aria-label={label} aria-pressed={minute.at === selected}
            disabled={!available} ref={element => { buttons.current[i] = element; }}
            tabIndex={minute.at === selected ? 0 : -1} onKeyDown={event => onKey(event, i)} onClick={() => onSelect(minute.at)}>
            <span className="minute-fill" style={{height: (100 * minute.calls / (2 * half)) + '%'}} />
          </button>;
        })}
      </div>
    </div>
    <div className="minute-times" aria-hidden="true">{[0, 7, 14].map(i => <span key={i}>{timeFormat.format(snapshot.minutes[i].at)}</span>)}</div>
  </section>;
}

function WeeklyRhythm({ inventory, data, failed }) {
  const [picked, setPicked] = useState(null);
  if (failed || !data) return <p className="activity-note">{failed ? 'Weekly history is unavailable. Reconnecting…' : 'Loading weekly history…'}</p>;
  const selected = picked && picked >= data.start && picked >= data.since && picked <= data.today ? picked : data.today;
  const totals = day => Object.values(data.days[day] || {}).reduce((a,b) => a+b, 0);
  const max = Math.max(1, ...Object.keys(data.days).map(totals));
  const rows = Object.entries(data.days[selected] || {}).map(([connectionId, calls]) => ({ connectionId, calls }));
  return <>
    <p className="activity-subtitle">{data.streak > 1 ? 'Active ' + data.streak + ' weeks in a row' :
      data.streak === 1 ? '1 active week' : 'Your first successful call starts a weekly streak.'}</p>
    <table className="rhythm-grid" aria-label="Daily routed calls over four weeks">
      <thead><tr><td />{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
      <tbody>{[0,1,2,3].map(week => {
        const start = offsetDay(data.start, week * 7);
        return <tr key={start}><th scope="row">{formatDay(start, weekFormat)}</th>{Array.from({length:7}, (_, i) => {
          const date = offsetDay(start, i);
          const future = date > data.today;
          const untracked = date < data.since;
          const calls = totals(date);
          const name = formatDay(date) + ' · ' + (future ? 'Upcoming' : untracked ? 'Before tracking began' : callCount(calls));
          return <td key={date}><button type="button" disabled={future || untracked} title={name} aria-label={name}
            data-future={future} aria-pressed={date === selected} aria-current={date === data.today ? 'date' : undefined}
            style={calls ? {'--day-strength': (25 + 75 * Math.sqrt(calls / max)) + '%'} : undefined}
            onClick={() => setPicked(date)}>{future ? '' : untracked ? '—' : (calls >= 1000 ? compactFormat : numberFormat).format(calls)}</button></td>;
        })}</tr>;
      })}</tbody>
    </table>
    <section className="activity-card"><div className="activity-card-head"><h3>{formatDay(selected)}</h3><span>{callCount(totals(selected))}</span></div>
      {rows.length ? <Sources rows={rows} inventory={inventory} daily /> : <p className="activity-empty">No calls on this day.</p>}
    </section>
    {data.since > data.start && <p className="activity-note">Tracking since {formatDay(data.since)}. Earlier days are marked with a dash.</p>}
  </>;
}

export function ActivityPage({ inventory, onBack }) {
  const [weekly, setWeekly] = useState(false);
  const [frozen, setFrozen] = useState(null);
  const heading = useRef(null);
  const live = useActivity('minutes', !weekly && !frozen);
  const history = useActivity('weeks', weekly);
  useEffect(() => { heading.current?.focus({preventScroll:true}); }, [weekly]);
  const snapshot = frozen?.snapshot || live.data;
  const minute = snapshot?.minutes.find(m => m.at === frozen?.at) || snapshot?.minutes.at(-1);
  const valid = !!snapshot && (!live.failed || !!frozen);
  const pause = at => setFrozen({ snapshot, at });
  return <main tabIndex={-1} className="router-main activity-page">
    <nav aria-label="Activity navigation">
      <Button size="sm" variant="ghost" onClick={weekly ? () => setWeekly(false) : onBack}><ArrowLeft />{weekly ? 'Activity' : 'Projects'}</Button>
      {!weekly && <Button size="sm" variant="ghost" onClick={() => setWeekly(true)}><CalendarDays />Weekly rhythm</Button>}
    </nav>
    <div className="activity-heading"><h2 ref={heading} tabIndex={-1}>{weekly ? 'Weekly rhythm' : 'Activity'}</h2>
      {!weekly && <Button size="sm" variant="outline" disabled={!valid} onClick={() => frozen ? setFrozen(null) : pause(minute.at)}>
        {frozen ? <Play /> : <Pause />}{frozen ? 'Resume live' : 'Pause'}
      </Button>}
    </div>
    {weekly ? <WeeklyRhythm inventory={inventory} {...history} /> : <>
      <p className="activity-subtitle">{frozen ? 'Last 15 minutes · Paused at ' + timeFormat.format(snapshot.asOf) : 'Last 15 minutes'}</p>
      {valid ? <>
        <MinutesChart snapshot={snapshot} selected={minute.at} onSelect={pause} />
        <section className="activity-card">
          <div className="activity-card-head"><h3>{timeFormat.format(minute.at)}–{timeFormat.format(minute.at + 60000)}</h3><span>{callCount(minute.calls)}</span></div>
          {minute.calls ? <Sources rows={minute.sources} inventory={inventory} /> : <p className="activity-empty">No calls finished in this minute.</p>}
        </section>
      </> : <p className="activity-note">{live.failed ? 'Activity is unavailable. Reconnecting…' : 'Loading activity…'}</p>}
    </>}
  </main>;
}
