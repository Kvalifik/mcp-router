import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { OAuthManager, Provider } from '../src/oauth.js';
import { Router, parseSiteList } from '../src/router.js';
import { createDashboard } from '../src/server.js';

test('scheduled inventory sync respects freshness, grant isolation and disabled connections', async t => {
  const { router, store, a, b } = fixture(t);
  const now = Date.now();
  const stable = store.connection(a);
  stable.lastChecked = new Date(now).toISOString();
  stable.beta = { tokens: { access_token: 'synthetic-beta' }, sites: [] };
  store.connection(b).enabled = false;
  const channels = [];
  router.open = async provider => ({
    listSites: async () => { channels.push(provider.channel); return [{ id: 'synthetic-site', name: 'Example' }]; },
    close: async () => {}
  });
  await router.resyncDueProjects(now);
  assert.deepEqual(channels, ['beta']);
  assert.equal(stable.lastChecked, new Date(now).toISOString());
  assert.equal(Object.values(store.data.projects)[0].enabled, false);
  await router.resyncDueProjects(now);
  assert.deepEqual(channels, ['beta']);
  stable.lastChecked = new Date(now - 3_600_000).toISOString();
  await router.resyncDueProjects(now);
  assert.deepEqual(channels, ['beta', 'stable']);
});

test('scheduled sync backs off failures, preserves inventory and recovers', async t => {
  const { router, store, a, b } = fixture(t);
  store.connection(b).enabled = false;
  const before = structuredClone(store.connection(a).sites);
  let attempts = 0;
  router.open = async () => { attempts++; throw new Error('Synthetic outage'); };
  await router.resyncDueProjects();
  assert.equal(attempts, 1);
  assert.deepEqual(store.connection(a).sites, before);
  const retry = router.inventoryRetries.get(`${a}:stable`);
  await router.resyncDueProjects(retry.nextAttempt - 1);
  assert.equal(attempts, 1);
  await router.resyncDueProjects(retry.nextAttempt);
  assert.equal(attempts, 2);
  assert.equal(router.inventoryRetries.get(`${a}:stable`).failures, 2);
  router.open = async () => ({ listSites: async () => before, close: async () => {} });
  await router.sites(a);
  assert.equal(router.inventoryRetries.size, 0);
});

test('scheduled sync skips busy, unauthorised and authorizing connections', async t => {
  const { router, store, a, b, calls } = fixture(t);
  delete store.connection(b).tokens;
  store.connection(a).pending = { state: 'synthetic' };
  await router.resyncDueProjects();
  delete store.connection(a).pending;
  let release;
  const busy = router.serial(a, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  await router.resyncDueProjects();
  assert.deepEqual(calls, []);
  release(); await busy;
  await router.resyncDueProjects();
  assert.deepEqual(calls, [a]);
  assert.equal(store.connection(b).beta, undefined);
});

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir), oauth = new OAuthManager(store, 'http://127.0.0.1:43127', options);
  const calls = [];
  const router = new Router(store, oauth, { open: async provider => ({
    listSites: async () => { calls.push(provider.id); return [{ id: provider.id, name: `Site ${provider.c.name}`, workspaceId: provider.id }]; },
    close: async () => {}
  }) });
  const a = router.createConnection('A'), b = router.createConnection('B');
  for (const id of [a, b]) {
    const c = store.connection(id); c.tokens = { access_token: `secret-${id}`, refresh_token: `refresh-${id}`, token_type: 'Bearer' };
    c.sites = [{ id, name: `Site ${c.name}` }];
  }
  return { dir, store, oauth, router, calls, a, b };
}

test('encrypted vault persists two isolated OAuth grants, without secrets in summaries', t => {
  const { dir, store, a, b } = fixture(t); store.save();
  const raw = fs.readFileSync(path.join(dir, 'vault.enc')).toString();
  assert.ok(!raw.includes('secret-'));
  if(process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'vault.enc')).mode & 0o777, 0o600);
  const loaded = new Store(dir);
  assert.equal(loaded.connection(a).tokens.access_token, `secret-${a}`);
  assert.equal(loaded.connection(b).tokens.access_token, `secret-${b}`);
  assert.ok(!JSON.stringify(loaded.summary()).includes('secret-'));
  assert.ok(!JSON.stringify(loaded.summary()).includes('refresh-'));
});

test('permission checks block disabled, unknown, cross-project and write requests', async t => {
  const { router, a, b, calls } = fixture(t);
  router.saveProject({ id: 'project-a', name: 'A', connectionId: a, siteId: a, enabled: true });
  router.saveProject({ id: 'project-b', name: 'B', connectionId: b, siteId: b });
  assert.deepEqual((await router.call('list_projects')).map(p => p.id), ['project-a']);
  assert.equal((await router.call('read_project_site', { projectId: 'project-a' })).id, a);
  for (const args of [{ projectId: 'project-b' }, { projectId: 'unknown' }, { projectId: 'project-a', siteId: b }, { projectId: 'project-a', actions: [{ publish_site: {} }] }]) {
    await assert.rejects(router.call('read_project_site', args));
  }
  await assert.rejects(router.call('publish_site', { projectId: 'project-a' }));
  assert.throws(() => router.saveProject({ name: 'Cross site', connectionId: a, siteId: b }));
  assert.throws(() => router.saveProject({ name: 'Write', connectionId: a, siteId: a, write: true }));
  assert.deepEqual(calls, [a]);
  router.setConnection(a, false);
  await assert.rejects(router.call('read_project_site', { projectId: 'project-a' }));
  assert.deepEqual(await router.call('list_projects'), []);
});

test('revoking read permission during an upstream request blocks the response', async t => {
  const { router, store, a } = fixture(t);
  router.saveProject({ id: 'project-a', name: 'A', connectionId: a, siteId: a, enabled: true });
  router.open = async () => ({ listSites: async () => {
    store.data.projects['project-a'].read = false; return [{ id: a, name: 'A' }];
  }, close: async () => {} });
  await assert.rejects(router.call('read_project_site', { projectId: 'project-a' }), /denied/);
});

test('OAuth callback rejects swapped connection, wrong browser, expired state and replay', async t => {
  let exchanges = 0;
  const { oauth, store, a, b } = fixture(t, { authFn: async (provider, options) => {
    if (options.authorizationCode) { exchanges++; provider.saveTokens({ access_token: 'new', token_type: 'Bearer' }); return 'AUTHORIZED'; }
    provider.saveCodeVerifier('verifier'); provider.redirectToAuthorization(new URL(`https://mcp.webflow.com/oauth/authorize?state=${provider.state()}`)); return 'REDIRECT';
  } });
  const aa = await oauth.begin(a), bb = await oauth.begin(b);
  const stateA = store.connection(a).pending.state, stateB = store.connection(b).pending.state;
  await assert.rejects(oauth.complete(b, { state: stateA, code: 'A', browserNonce: bb.browserNonce }));
  await assert.rejects(oauth.complete(a, { state: stateA, code: 'A', browserNonce: 'wrong' }));
  store.connection(b).pending.createdAt = 0;
  await assert.rejects(oauth.complete(b, { state: stateB, code: 'B', browserNonce: bb.browserNonce }));
  await oauth.complete(a, { state: stateA, code: 'A', browserNonce: aa.browserNonce });
  await assert.rejects(oauth.complete(a, { state: stateA, code: 'A', browserNonce: aa.browserNonce }));
  assert.equal(exchanges, 1);
});

test('refresh rotation stays isolated and parallel refreshes are serialized', async t => {
  let active = 0, maxActive = 0, n = 0;
  const { router, store, a, b } = fixture(t, { authFn: async provider => {
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 10));
    provider.saveTokens({ access_token: `rotated-${++n}`, refresh_token: `rotated-refresh-${n}`, token_type: 'Bearer', expires_in: 3600 });
    active--; return 'AUTHORIZED';
  } });
  const originalB = JSON.stringify(store.connection(b).tokens);
  await Promise.all([router.sites(a, { refresh: true }), router.sites(a, { refresh: true })]);
  assert.equal(maxActive, 1); assert.equal(n, 2);
  assert.equal(store.connection(a).tokens.access_token, 'rotated-2');
  assert.equal(JSON.stringify(store.connection(b).tokens), originalB);
});

test('upstream revocation of A leaves B usable and never falls back to B credentials', async t => {
  const { router, store, a, b } = fixture(t);
  router.open = async provider => {
    if (provider.id === a) throw new Error('invalid_grant with secret upstream payload');
    return { listSites: async () => [{ id: b, name: 'B' }], close: async () => {} };
  };
  await assert.rejects(router.sites(a), /Connection check failed/);
  assert.equal((await router.sites(b))[0].id, b);
  assert.ok(!JSON.stringify(store.summary()).includes('secret upstream'));
});

test('duplicate upstream client registration is rejected', t => {
  const { store, a, b } = fixture(t);
  new Provider(store, a, 'http://127.0.0.1:43127').saveClientInformation({ client_id: 'shared' });
  assert.throws(() => new Provider(store, b, 'http://127.0.0.1:43127').saveClientInformation({ client_id: 'shared' }));
});

test('site parser accepts actual Webflow envelope and rejects errors and unfamiliar results', () => {
  const response = { content: [{ type: 'text', text: JSON.stringify({ action: 'list_sites', result: { sites: [{ id: 'site-a', displayName: 'A', workspaceId: 'w' }], pagination: { hasMore: false } } }) }] };
  assert.equal(parseSiteList(response).sites[0].id, 'site-a');
  assert.throws(() => parseSiteList({ isError: true }));
  assert.throws(() => parseSiteList({ content: [{ type: 'text', text: '{"sites":[]}' }] }));
});

test('dashboard enforces host, origin and CSRF while allowing same-origin management', async t => {
  const { router, oauth } = fixture(t);
  const server = createDashboard(router, oauth, 'http://127.0.0.1:43129', {managementToken:'test-owner'});
  server.listen(43129, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const root = 'http://127.0.0.1:43129';
  assert.equal((await fetch(`${root}/api/state`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get(`${root}/api/state`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  const { csrf } = await (await fetch(`${root}/api/state`, {headers:{Cookie:'router_session=test-owner'}})).json();
  assert.equal((await fetch(`${root}/api/connections`, { method: 'POST', headers: { Cookie:'router_session=test-owner', Origin: root, 'Content-Type': 'application/json' }, body: '{"name":"C"}' })).status, 403);
  assert.equal((await fetch(`${root}/api/connections`, { method: 'POST', headers: { Cookie:'router_session=test-owner', Origin: root, 'Content-Type': 'application/json', 'X-Router-CSRF': csrf }, body: '{"name":"C"}' })).status, 200);
});

test('desktop OAuth handoff sets browser cookie and consumes one-use launch link', async t => {
  const { router, oauth, a } = fixture(t, { authFn: async provider => {
    provider.saveCodeVerifier('test-verifier');
    provider.redirectToAuthorization(new URL('https://mcp.webflow.com/oauth/authorize?state=' + provider.state()));
    return 'REDIRECT';
  } });
  const root = 'http://127.0.0.1:43130';
  const server = createDashboard(router, oauth, root, {managementToken:'test-owner'});
  server.listen(43130, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const { csrf } = await (await fetch(root + '/api/state', {headers:{Cookie:'router_session=test-owner'}})).json();
  const response = await fetch(`${root}/api/connections/${a}/authorize`, { method: 'POST', headers: { Cookie:'router_session=test-owner', Origin: root, 'Content-Type': 'application/json', 'X-Router-CSRF': csrf }, body: '{}' });
  const { url } = await response.json();
  assert.ok(url.startsWith(root + '/oauth/launch/'));
  const launched = await fetch(url, { redirect: 'manual' });
  assert.equal(launched.status, 303);
  assert.ok(launched.headers.get('location').startsWith('https://mcp.webflow.com/oauth/authorize'));
  assert.ok(launched.headers.get('set-cookie').includes('HttpOnly; SameSite=Lax'));
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 400);
});

test('renaming keeps OAuth credentials and project mappings unchanged', async t => {
  const { router, store, a } = fixture(t);
  router.saveProject({ id: 'p', name: 'Before', connectionId: a, siteId: a, enabled: true });
  const tokens = JSON.stringify(store.connection(a).tokens);
  router.edit('connections', a, { name: 'Workspace renamed' });
  router.edit('projects', 'p', { name: 'Project renamed' });
  assert.equal(JSON.stringify(store.connection(a).tokens), tokens);
  assert.equal((await router.call('list_projects'))[0].name, 'Project renamed');
  assert.equal(store.data.projects.p.siteId, a);
  assert.throws(() => router.edit('projects', 'p', { write: true }));
  assert.throws(() => router.edit('projects', 'p', { siteId: 'other' }));
});

test('permission editor enforces read denial and distinguishes enabled from permission', async t => {
  const { router, a } = fixture(t);
  router.saveProject({ id: 'p', name: 'P', connectionId: a, siteId: a, enabled: true });
  router.edit('projects', 'p', { read: false });
  assert.deepEqual(await router.call('list_projects'), []);
  await assert.rejects(router.call('read_project_site', { projectId: 'p' }));
  router.edit('projects', 'p', { read: true, enabled: false });
  await assert.rejects(router.call('read_project_site', { projectId: 'p' }));
  router.edit('projects', 'p', { enabled: true });
  assert.equal((await router.call('read_project_site', { projectId: 'p' })).id, a);
});

test('project deletion is rejected and permanent connection deletion preserves other grants', async t => {
  const { router, store, a, b, dir } = fixture(t);
  router.saveProject({ id: 'p', name: 'P', connectionId: a, siteId: a, enabled: true });
  const bToken = store.connection(b).tokens.access_token;
  assert.throws(() => router.remove('projects', 'p'), /cannot be deleted/);
  assert.throws(() => router.restore('projects', 'p'), /cannot be restored/);
  assert.equal(store.data.projects.p.enabled, true);
  assert.equal(store.summary().projects.length, 1);
  assert.equal(store.summary().trash, undefined);
  router.remove('connections', a);
  assert.deepEqual(await router.call('list_projects'), []);
  await assert.rejects(router.sites(a));
  await assert.rejects(router.call('read_project_site', { projectId: 'p' }));
  assert.equal(store.summary().projects.length, 0);
  assert.equal(store.connection(b).tokens.access_token, bToken);
  assert.equal(store.data.connections[a],undefined);
  assert.equal(store.data.projects.p,undefined);
  assert.throws(()=>router.restore('connections',a),/cannot be restored/);
  const reloaded=new Store(dir);
  assert.equal(reloaded.data.connections[a],undefined);

});


test('OAuth browser redirects use a safe result page while dashboard cross-site checks remain enforced',async t=>{
 const {router,store,a}=fixture(t);let fail=false;
 const oauth={complete:async()=>{if(fail)throw new Error('rejected');}};
 const root='http://127.0.0.1:43131',server=createDashboard(router,oauth,root);
 server.listen(43131,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 // Node fetch overwrites Sec-Fetch-Mode, so use HTTP directly to model browser redirects.
 const request=(pathname,headers={})=>new Promise((resolve,reject)=>{http.get(root+pathname,{headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject);});
 const cross={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 const callback=await request(`/oauth/callback/${a}?code=test&state=test`,cross);assert.equal(callback.status,303);assert.match(callback.headers.location,/^\/oauth\/result\/[A-Za-z0-9_-]{43}$/);
 const result=await request(callback.headers.location,cross);assert.equal(result.status,200);assert.match(result.body,/Webflow connected/);assert.ok(!result.body.includes('secret-'));assert.ok(!result.body.includes('csrf'));assert.ok(!result.body.includes('Open router dashboard'));assert.match(result.body,/close this tab/);
 assert.equal((await request('/?oauth=success',cross)).status,403);assert.equal((await request('/api/state',cross)).status,403);assert.equal((await request(callback.headers.location,{...cross,Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/oauth/result/not-a-ticket',cross)).status,410);
 fail=true;const rejected=await request(`/oauth/callback/${a}`,cross);const failure=await request(rejected.headers.location,cross);assert.match(failure.body,/Authorization could not be completed/);
});
