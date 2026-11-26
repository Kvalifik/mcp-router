import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle, DialogTitleRow } from '@/components/ui/dialog';
import './activity.css';
import { offsetDay } from '../src/activity-calendar.js';
import { pulseIntervals, pulsePeriods } from '../src/activity.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const secondsFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dayFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const weekFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const formatDay = (key, format = dayFormat) => format.format(new Date(key + 'T12:00:00Z'));
const callCount = n => numberFormat.format(n) + (n === 1 ? ' call' : ' calls');
const emptyBins = Array(pulseIntervals + 1).fill(0);
const sum = values => values.reduce((a, b) => a + b, 0);

// Only request the data the visible surface needs. The next request starts
// after the previous one finishes, even if the daemon or machine is busy.
function useActivity(view, period) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let timer, controller;
    const query = new URLSearchParams({view});
    if (period) query.set('period', period);
    async function refresh() {
      if (document.hidden || controller) return;
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch('/api/activity?' + query, { signal: request.signal });
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
  }, [view, period]);
  return { data, failed };
}

function MiniBars({ series, size = 'toolbar' }) {
  const bins = series?.bins || emptyBins;
  const firstBin = series?.firstBin ?? 0;
  const stride = size === 'compact' ? 2 : 1;
  const bars = new Map();
  bins.forEach((calls, index) => {
    const interval = Math.floor((firstBin + index) / stride);
    bars.set(interval, (bars.get(interval) || 0) + calls);
  });
  // Compress bursts into the available height. A given count always looks the
  // same, including when a larger neighboring burst rolls out of the window.
  return <span aria-hidden="true" data-empty={!bins.some(Boolean) || undefined} className={'activity-spark activity-spark-' + size}>
    {Array.from(bars, ([interval, calls]) => <i key={interval} style={{ height: (100 * calls / (calls + 2)) + '%' }} />)}
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

export function ActivityPulse({ open, disabled, triggerRef, onClick }) {
  const { data, failed } = useActivity('pulse');
  const bins = data?.bins || emptyBins;
  const total = sum(bins);
  const running = sum((data?.running || []).map(row => row.calls));
  const rate = failed ? 'Unavailable' : !data ? 'Activity' : total || running ? compactFormat.format(total) + '/min' : 'Idle';
  const pending = !failed && running > 0 ? numberFormat.format(running) + ' in progress' : '';
  const description = [!failed && (total || running) ? callCount(total) + ' per minute' : rate, pending].filter(Boolean).join(' · ');
  return <Button ref={triggerRef} disabled={disabled} onClick={onClick} aria-haspopup="dialog" aria-expanded={open}
    title={'Router activity: ' + description} size="sm" variant="outline" className="activity-pulse" data-running={!!pending || undefined} aria-label={'Router activity: ' + description}>
    <MiniBars series={failed ? null : data} /><MiniBars series={failed ? null : data} size="compact" />
    <span className="activity-pulse-rate">{rate}</span><ChevronDown className="size-3" />
  </Button>;
}

function intervalLabel(at, {asOf, startedAt, period, intervalSeconds}) {
  const end = (Math.floor(asOf / 1000) + 1) * 1000;
  const from = Math.max(at, end - period * 1000, Math.floor(startedAt / 1000) * 1000);
  const to = Math.min(end, at + intervalSeconds * 1000);
  const format = intervalSeconds < 60 || from % 60000 || to % 60000 ? secondsFormat : timeFormat;
  return format.format(from) + '–' + format.format(to);
}

function IntervalChart({ snapshot, selected, onSelect }) {
  const buttons = useRef([]);
  const [focused, setFocused] = useState(null);
  const { intervals, intervalSeconds, period, asOf, startedAt } = snapshot;
  // The oldest clock interval may have rolled out completely. Intervals before
  // router startup are also unavailable, even when the rest of the chart is live.
  const end = (Math.floor(asOf / 1000) + 1) * 1000;
  const start = end - period * 1000;
  const first = intervals.findIndex(bar => bar.at + intervalSeconds * 1000 > Math.max(start, startedAt));
  const last = intervals.length - 1;
  const tabStop = intervals.some((bar, i) => i >= first && bar.at === focused) ? focused : intervals[last].at;
  const peak = Math.max(2, ...intervals.map(bar => bar.calls));
  const step = 10 ** Math.max(0, Math.floor(Math.log10(peak / 2)) - 1);
  const half = Math.ceil(peak / (2 * step)) * step;
  function onKey(event, index) {
    const targets = { ArrowRight: Math.min(last, index + 1), ArrowLeft: Math.max(first, index - 1), Home: first, End: last };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    const next = targets[event.key];
    buttons.current[next]?.focus();
  }
  const unit = intervalSeconds === 60 ? 'minute' : intervalSeconds + ' seconds';
  const format = intervalSeconds < 60 ? secondsFormat : timeFormat;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only the marks overlap. The grid, controls and breakdown always represent
  // the committed snapshot, including during an interrupted range change.
  const marks = <motion.div key={period} aria-hidden="true" className="activity-bar-layer" style={{'--bar-count': intervals.length}}
    initial={reducedMotion ? false : {opacity: 0, scaleY: .92}} animate={{opacity: 1, scaleY: 1}} exit={{opacity: 0}}
    transition={{duration: .22, ease: 'easeOut'}}>
    {intervals.map((bar, i) => <span key={bar.at} className="activity-bar" data-selected={bar.at === selected || undefined}
      style={{height: (100 * bar.calls / (2 * half)) + '%', visibility: i < first ? 'hidden' : undefined}} />)}
  </motion.div>;
  return <section className="activity-card activity-chart" aria-label={'Calls per ' + unit}>
    <div className="activity-chart-heading"><h3>Calls per {unit}</h3>
      {startedAt > start && <span>Tracking since {format.format(startedAt)}</span>}
    </div>
    <div className="activity-plot">
      <div className="activity-axis" aria-hidden="true">{[half * 2, half, 0].map(n => <span key={n}>{numberFormat.format(n)}</span>)}</div>
      <div className="activity-columns" role="group" aria-label="Filter calls by interval" style={{'--bar-count': intervals.length}}>
        {reducedMotion ? marks : <AnimatePresence initial={false}>{marks}</AnimatePresence>}
        {intervals.map((bar, i) => {
          const label = i >= first ? intervalLabel(bar.at, snapshot) + ' · ' + callCount(bar.calls) : 'Outside tracking period';
          return <button type="button" key={bar.at} title={label} aria-label={label} aria-pressed={bar.at === selected}
            disabled={i < first} ref={element => { buttons.current[i] = element; }}
            tabIndex={bar.at === tabStop ? 0 : -1} onFocus={() => setFocused(bar.at)}
            onKeyDown={event => onKey(event, i)} onClick={() => onSelect(bar)} />;
        })}
      </div>
    </div>
    <div className="activity-times" aria-hidden="true"><span>{format.format(start)}</span><span>{format.format(end)}</span></div>
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

export function ActivityDialogBody({ inventory }) {
  const [period, setPeriod] = useState(60);
  const [selection, setSelection] = useState(null);
  const live = useActivity('period', period);
  const history = useActivity('weeks');
  // Keep the displayed range (including a pinned bar) until the next one arrives.
  // Reset the pin in that same render so the chart and totals change together.
  if (selection && selection.snapshot.period !== live.data?.period) setSelection(null);
  const snapshot = selection?.snapshot || live.data;
  const bar = selection?.bar;
  const displayedPeriod = snapshot?.period ?? period;
  const title = bar ? intervalLabel(bar.at, snapshot) : displayedPeriod === 60 ? 'Last minute' : 'Last ' + displayedPeriod / 60 + ' minutes';
  const rows = bar?.sources ?? snapshot?.sources ?? [];
  const total = sum(rows.map(row => row.calls));
  return <>
    <DialogHeader className="activity-dialog-header shrink-0 text-left">
      <DialogTitleRow className="activity-heading"><DialogTitle className="mr-auto">Activity</DialogTitle>
        <div className="activity-periods" role="group" aria-label="Activity time range">{pulsePeriods.map(seconds =>
          <button type="button" key={seconds} aria-pressed={period === seconds} onClick={() => setPeriod(seconds)}>{seconds / 60} min</button>
        )}</div>
      </DialogTitleRow>
      <DialogDescription className="activity-subtitle">{snapshot && live.failed ? 'Showing the last update. Reconnecting…' :
        bar ? 'Select the highlighted bar again to see all calls.' : 'Select a bar to see calls for that interval.'}</DialogDescription>
    </DialogHeader>
    <div className="dialog-scroll activity-page">
      {snapshot ? <>
        <IntervalChart snapshot={snapshot} selected={bar?.at} onSelect={next =>
          setSelection(current => current?.bar.at === next.at ? null : {snapshot, bar: next})} />
        <section className="activity-card activity-breakdown" aria-busy={displayedPeriod !== period}>
          <div className="activity-card-head"><h3>{title}</h3><span>{callCount(total)}</span></div>
          {total ? <Sources rows={rows} inventory={inventory} /> :
            <p className="activity-empty">{bar ? 'No calls finished in this interval.' : 'No calls finished in this period.'}</p>}
        </section>
        {!bar && snapshot.running.length > 0 && <section className="activity-card">
          <div className="activity-card-head"><h3>In progress</h3><span>{callCount(sum(snapshot.running.map(row => row.calls)))}</span></div>
          <Sources rows={snapshot.running} inventory={inventory} />
        </section>}
      </> : <p className="activity-note">{live.failed ? 'Activity is unavailable. Reconnecting…' : 'Loading activity…'}</p>}
      <section className="activity-weekly" aria-labelledby="weekly-heading">
        <h2 className="type-section" id="weekly-heading">Weekly rhythm</h2>
        <WeeklyRhythm inventory={inventory} {...history} />
      </section>
    </div>
  </>;
}
