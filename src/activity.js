import { localDay, mondayOf, offsetDay } from './activity-calendar.js';

// Retain only counts and router-owned IDs. Never take upstream arguments or
// responses here, including for Direct calls that have no trusted project ID.
function addSource(sources, connectionId, projectId, calls = 1) {
  const key = connectionId + ':' + (projectId || '');
  const existing = sources.get(key);
  if (existing) existing.calls += calls;
  else sources.set(key, { connectionId, projectId, calls });
}

export class RouterActivity {
  constructor(store, clock = Date.now) {
    this.clock = clock;
    this.startedAt = clock();
    this.seconds = new Map();
    this.running = new Set();
    const today = localDay(this.startedAt);
    const previous = store.data.activityHistory;
    this.history = previous || { since: today, days: {}, lastActiveWeek: null, streak: 0 };
    store.data.activityHistory = this.history;
    const pruned = this.pruneDays(today);
    if (!previous || pruned) store.save();
  }

  pruneDays(today) {
    const monday = mondayOf(today);
    if (this.calendarWeek === monday) return false;
    this.calendarWeek = monday;
    const earliest = offsetDay(monday, -21);
    const old = Object.keys(this.history.days).filter(day => day < earliest);
    for (const day of old) delete this.history.days[day];
    return old.length > 0;
  }

  pruneSeconds(second) {
    if (this.lastPrunedSecond === second) return;
    this.lastPrunedSecond = second;
    const earliest = Math.floor(second / 60) * 60 - 14 * 60;
    for (const at of this.seconds.keys()) {
      if (at < earliest || at > second) this.seconds.delete(at);
    }
  }

  begin(connectionId, projectId = null) {
    const call = { connectionId, projectId };
    this.running.add(call);
    // The caller saves the counters together with the terminal audit event.
    return success => {
      if (!this.running.delete(call)) return;
      const now = this.clock();
      const second = Math.floor(now / 1000);
      this.pruneSeconds(second);
      if (!this.seconds.has(second)) this.seconds.set(second, new Map());
      addSource(this.seconds.get(second), connectionId, projectId);
      const today = localDay(now);
      if (today < this.history.since) this.history.since = today;
      this.pruneDays(today);
      const day = this.history.days[today] ||= {};
      day[connectionId] = (day[connectionId] || 0) + 1;
      const week = this.calendarWeek;
      if (success && (!this.history.lastActiveWeek || this.history.lastActiveWeek < week)) {
        this.history.streak = this.history.lastActiveWeek === offsetDay(week, -7) ? this.history.streak + 1 : 1;
        this.history.lastActiveWeek = week;
      }
    };
  }

  forgetConnection(id) {
    for (const call of this.running) if (call.connectionId === id) this.running.delete(call);
    for (const sources of this.seconds.values()) {
      for (const [key, row] of sources) {
        if (row.connectionId !== id) continue;
        sources.delete(key);
        addSource(sources, 'removed', null, row.calls);
      }
    }
    for (const day of Object.values(this.history.days)) {
      if (!Object.hasOwn(day, id)) continue;
      day.removed = (day.removed || 0) + day[id];
      delete day[id];
    }
  }

  snapshot(view) {
    const now = this.clock();
    const second = Math.floor(now / 1000);
    this.pruneSeconds(second);
    if (view === 'weeks') {
      const today = localDay(now);
      const week = mondayOf(today);
      // Idle views are read-only; expired days also get pruned on the next
      // routed call or daemon startup, when the vault is saved.
      const start = offsetDay(week, -21);
      const days = Object.fromEntries(Object.entries(this.history.days).filter(([day]) => day >= start && day <= today));
      const active = [week, offsetDay(week, -7)].includes(this.history.lastActiveWeek);
      return { today, start, since: this.history.since, days, streak: active ? this.history.streak : 0 };
    }
    if (view === 'minutes') {
      const start = Math.floor(second / 60) * 60 - 14 * 60;
      const minutes = Array.from({ length: 15 }, (_, i) => ({
        at: (start + i * 60) * 1000, calls: 0, sources: new Map()
      }));
      for (const [at, sources] of this.seconds) {
        const minute = minutes[Math.floor((at - start) / 60)];
        for (const row of sources.values()) {
          minute.calls += row.calls;
          addSource(minute.sources, row.connectionId, row.projectId, row.calls);
        }
      }
      return { asOf: now, startedAt: Math.min(this.startedAt, now), minutes: minutes.map(minute => ({ ...minute, sources: [...minute.sources.values()] })) };
    }
    if (view !== 'pulse') throw new Error('Unknown activity view');
    const bins = Array(12).fill(0);
    const sources = new Map();
    const running = new Map();
    for (const call of this.running) addSource(running, call.connectionId, call.projectId);
    for (let i = 0; i < 60; i++) {
      const bucket = this.seconds.get(second - 59 + i);
      if (!bucket) continue;
      for (const row of bucket.values()) {
        bins[Math.floor(i / 5)] += row.calls;
        addSource(sources, row.connectionId, row.projectId, row.calls);
      }
    }
    return { asOf: now, bins, sources: [...sources.values()], running: [...running.values()] };
  }
}
