import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { RouterActivity } from '../src/activity.js';
import { localDay, mondayOf, offsetDay } from '../src/activity-calendar.js';
import { fixture, itemsOperation } from './fixtures/code-mode.js';

function tracker(start) {
  let now = start;
  const store = {data:{}, save() {}};
  return {store, activity:new RouterActivity(store, () => now), setTime:time => { now = time; }};
}

test('in-flight calls, rolling seconds, and minute buckets count overlapping completions exactly once', () => {
  const start = new Date(2026, 10, 24, 14, 0).getTime();
  const {activity, setTime} = tracker(start);
  const project = activity.begin('studio','project');
  const direct = activity.begin('personal');
  assert.equal(activity.snapshot('pulse').running.length, 2);
  assert.equal(activity.snapshot('pulse').sources.length, 0);
  project(true); project(true);
  setTime(start + 59000);
  direct(false);
  const pulse = activity.snapshot('pulse');
  assert.deepEqual(pulse.running, []);
  assert.deepEqual(pulse.bins, [0,1,0,0,0,0,0,0,0,0,0,0,1]);
  assert.deepEqual(pulse.sources, [
    {connectionId:'studio',projectId:'project',calls:1},
    {connectionId:'personal',projectId:null,calls:1}
  ]);
  setTime(start + 60000);
  assert.equal(activity.snapshot('pulse').sources.length, 1);
  setTime(start + 14 * 60000 + 59000);
  const minutes = activity.snapshot('minutes').minutes;
  assert.equal(minutes.length, 15);
  assert.equal(minutes[0].at,start);
  assert.equal(minutes[0].calls,2);
  assert.deepEqual(minutes[0].sources,pulse.sources);
  setTime(start + 15 * 60000);
  assert.ok(activity.snapshot('minutes').minutes.every(bucket => !bucket.calls));
  assert.deepEqual(activity.snapshot('weeks').days[localDay(start)],{studio:1,personal:1});
});

test('rolling activity periods keep exact boundaries and attribution across a minute rollover', () => {
  const start = new Date(2026, 10, 24, 14, 0).getTime();
  const {activity, setTime} = tracker(start);
  for (const second of [0, 1, 600, 601, 840, 841, 900]) {
    setTime(start + second * 1000);
    if (second === 600 || second === 601) activity.begin('personal')(true);
    else activity.begin('studio', 'project')(true);
  }
  activity.begin('studio', 'in-progress');
  const {ranges, ...minute} = activity.snapshot('ranges');
  assert.deepEqual(minute, activity.snapshot('pulse'));
  assert.deepEqual(minute.running, [{connectionId:'studio', projectId:'in-progress', calls:1}]);
  assert.deepEqual(minute.bins, [1,0,0,0,0,0,0,0,0,0,0,0,1]);
  assert.deepEqual(ranges[300].bins, [1,0,0,0,0,0,0,0,0,2,0,0,1]);
  assert.deepEqual(ranges[900].bins, [1,0,0,0,0,0,0,0,2,0,0,2,1]);
  assert.deepEqual(ranges[300].sources, [
    {connectionId:'personal', projectId:null, calls:1},
    {connectionId:'studio', projectId:'project', calls:3}
  ]);
  assert.deepEqual(ranges[900].sources, [
    {connectionId:'studio', projectId:'project', calls:4},
    {connectionId:'personal', projectId:null, calls:2}
  ]);
  assert.equal(activity.snapshot('minutes').minutes.reduce((sum, m) => sum + m.calls, 0), 5);
  for (const [period, width, expected] of [[60, 5, minute], [300, 30, ranges[300]], [900, 60, ranges[900]]]) {
    const detail = activity.snapshot('period', period);
    assert.equal(detail.intervalSeconds, width);
    assert.equal(detail.period, period);
    assert.deepEqual(detail.sources, expected.sources);
    assert.deepEqual(detail.running, minute.running);
    const sources = new Map();
    for (const [i, bar] of detail.intervals.entries()) {
      assert.equal(bar.at, start + (900 - period + i * width) * 1000);
      assert.equal(bar.calls, bar.sources.reduce((total, row) => total + row.calls, 0));
      for (const row of bar.sources) {
        const id = [row.connectionId, row.projectId].join('/');
        sources.set(id, (sources.get(id) || 0) + row.calls);
      }
    }
    assert.deepEqual(sources, new Map(expected.sources.map(row => [[row.connectionId, row.projectId].join('/'), row.calls])));
    assert.deepEqual(detail.intervals[0].sources, [period === 300
      ? {connectionId:'personal', projectId:null, calls:1}
      : {connectionId:'studio', projectId:'project', calls:1}]);
    assert.deepEqual(detail.intervals.at(-1).sources, [{connectionId:'studio', projectId:'project', calls:1}]);
  }
  assert.throws(() => activity.snapshot('period', 10), /Unknown activity period/);
  setTime(start + 1800000);
  assert.deepEqual(activity.snapshot('ranges').ranges[900].sources, []);
  assert.ok(activity.snapshot('period', 900).intervals.every(bar => !bar.calls && !bar.sources.length));
});

test('polling cannot split a finished burst, and calls in the oldest interval expire individually', () => {
  const {activity, setTime} = tracker(0);
  for (const second of [10, 21, 23, 35]) {
    setTime(second * 1000);
    activity.begin('studio', 'project')(true);
  }
  const occupied = ({firstBin, bins}) => bins.flatMap((calls, i) => calls ? [[firstBin + i, calls]] : []);
  for (let second = 40; second < 70; second++) {
    setTime(second * 1000);
    const pulse = activity.snapshot('ranges');
    assert.deepEqual(occupied(pulse), [[2,1],[4,2],[7,1]]);
    assert.deepEqual(occupied(pulse.ranges[300]), [[0,3],[1,1]]);
    assert.deepEqual(occupied(pulse.ranges[900]), [[0,4]]);
    assert.equal(pulse.sources[0].calls, 4);
  }
  for (const [second, expected] of [[70, [[4,2],[7,1]]], [81, [[4,1],[7,1]]], [83, [[7,1]]], [95, []]]) {
    setTime(second * 1000);
    const pulse = activity.snapshot('pulse');
    assert.deepEqual(occupied(pulse), expected);
    assert.equal(pulse.sources[0]?.calls || 0, expected.reduce((total, [, calls]) => total + calls, 0));
  }
});

test('weekly streak crosses years and outlasts the four-week calendar, with an open week to continue it', () => {
  const first = '2026-12-07';
  const noon = day => new Date(day + 'T12:00:00').getTime();
  const {activity, setTime, store} = tracker(noon(first));
  activity.begin('studio')(false);
  assert.equal(activity.snapshot('weeks').streak,0);
  for (let i = 0; i < 7; i++) {
    const monday = offsetDay(first,7 * i);
    assert.equal(mondayOf(offsetDay(monday,6)),monday);
    setTime(noon(monday)); activity.begin('studio')(true); activity.begin('personal')(true);
    assert.equal(activity.snapshot('weeks').streak,i + 1);
  }
  assert.equal(Object.keys(store.data.activityHistory.days).length,4);
  setTime(noon(offsetDay(first,7 * 7 + 6)));
  activity.begin('studio')(false);
  assert.equal(activity.snapshot('weeks').streak,7);
  setTime(noon(offsetDay(first,7 * 8)));
  assert.equal(activity.snapshot('weeks').streak,0);
  activity.begin('studio')(true);
  assert.equal(activity.snapshot('weeks').streak,1);
  assert.equal(mondayOf('2026-03-29'),'2026-03-23');
});

test('vault upgrades start fresh, daily totals survive restart, and removal erases attribution', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'router-activity-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const clock = () => new Date(2026, 10, 24, 12).getTime();
  const store = new Store(dir);
  store.audit('operation_completed', {projectId:'legacy-project'});
  const activity = new RouterActivity(store,clock);
  assert.deepEqual(activity.snapshot('weeks').days,{});
  activity.begin('old-connection','project')(true);
  const inFlight = activity.begin('old-connection');
  activity.forgetConnection('old-connection'); inFlight(true);
  store.save();
  assert.deepEqual(activity.snapshot('pulse').sources,[{connectionId:'removed',projectId:null,calls:1}]);
  assert.equal(JSON.stringify(store.data.activityHistory).includes('old-connection'),false);
  const restarted = new RouterActivity(new Store(dir),clock);
  assert.equal(restarted.snapshot('pulse').sources.length,0);
  assert.deepEqual(restarted.snapshot('weeks').days,{'2026-11-24':{removed:1}});
  assert.equal(restarted.snapshot('weeks').streak,1);
});

test('normal managed dispatch, nested code reads and Direct discovery report only routed requests', async t => {
  const f = fixture({count:1});
  t.after(f.cleanup);
  const {router,connectionId} = f;
  const pulse = () => router.activity.snapshot('pulse');
  await router.call('list_projects');
  await router.call('get_project_operations',{projectId:'p'});
  await router.sites(connectionId);
  assert.deepEqual(pulse().sources,[]);
  await router.call('prepare_project',{projectId:'p'});
  await router.call('read_webflow_code',{projectId:'p',code:
    "read('" + itemsOperation + "',{collection_id:'owned-collection'}); print(1);"});
  router.edit('projects','p',{permissions:{'site:read':true}});
  await router.call('read_project_site',{projectId:'p'});
  assert.deepEqual(pulse().sources,[{connectionId,projectId:'p',calls:3}]);
  router.edit('connections',connectionId,{accessMode:'direct'});
  let release;
  let started;
  const entered = new Promise(resolve => { started=resolve; });
  const finish = new Promise(resolve => { release=resolve; });
  router.open = async () => ({
    listTools:async () => [{name:'synthetic_tool'}], close:async () => {},
    call:async () => { started(); await finish; throw new Error('synthetic failure'); }
  });
  const args = {connectionId, channel:'stable'};
  await router.call('get_direct_tools',args);
  const dispatched = router.call('call_direct_tool',{...args,toolName:'synthetic_tool',arguments:{site_id:'unverified-site'}});
  await entered;
  assert.deepEqual(pulse().running,[{connectionId,projectId:null,calls:1}]);
  release(); await assert.rejects(dispatched);
  assert.deepEqual(pulse().running,[]);
  assert.deepEqual(pulse().sources.find(row => row.projectId === null),{connectionId,projectId:null,calls:2});
  assert.equal(JSON.stringify(router.activity.history).includes('unverified-site'),false);
  assert.equal(new Store(f.store.dir).data.activityHistory.days[localDay(Date.now())][connectionId],5);
});
