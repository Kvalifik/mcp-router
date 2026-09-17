import http from 'node:http';
import paths from './paths.cjs';
import privateDirectories from './private-directory.cjs';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { OAuthManager, nonce } from './oauth.js';
import { Router } from './router.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.ROUTER_DATA_DIR || path.join(ROOT, '.local');

const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1048576) throw new Error('Request too large'); }
  return JSON.parse(text || '{}');
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));

export function createDashboard(router, oauth, origin, { managementToken = nonce(), loginTicket = nonce(), now = Date.now } = {}) {
  let loginAvailable = true;
  const loginExpires = now() + 600000;
  const csrf = nonce();
  const launches = new Map();
  const results = new Map();
  function finishOAuth(res, success) {
    for (const [key, result] of results) if (result.expires < Date.now()) results.delete(key);
    const ticket = nonce();
    results.set(ticket, { success, expires:Date.now()+600000 });
    res.writeHead(303, {Location:`/oauth/result/${ticket}`});res.end();
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let url;
    try { url = new URL(req.url, origin); } catch { return json(res, {error: 'Invalid URL'}, 400); }
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site' && !url.pathname.startsWith('/oauth/') && !url.pathname.startsWith('/dashboard/login/')) {
      return json(res, { error: 'Origin denied' }, 403);
    }
    try {
      if (req.method === 'GET' && url.pathname.startsWith('/oauth/result/')) {
        const result = results.get(url.pathname.slice('/oauth/result/'.length));
        const valid = result && result.expires > Date.now();
        const title = !valid ? 'This result has expired' : result.success ? 'Webflow connected' : 'Authorization could not be completed';
        const message = !valid ? 'Return to MCP Router to check the connection status.' : result.success ? 'You can close this tab and return to MCP Router.' : 'Return to MCP Router and try connecting again.';
        res.writeHead(valid ? 200 : 410, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;font:15px system-ui,sans-serif;background:#fafafa;color:#18181b;display:grid;place-items:center;min-height:100dvh}main{max-width:380px;margin:24px;padding:28px;border:1px solid #e4e4e7;border-radius:12px;background:white}h1{font-size:20px;margin:0 0 12px}p{color:#71717a;line-height:1.5}a{display:inline-block;margin-top:8px;color:inherit}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/oauth/launch/')) {
        const ticket = url.pathname.slice('/oauth/launch/'.length), launch = launches.get(ticket);
        launches.delete(ticket);
        if (!launch || Date.now() > launch.expires) return json(res, { error: 'Login link expired. Connect again.' }, 400);
        res.setHeader('Set-Cookie', `oauth_${launch.id}=${launch.browserNonce}; Path=/oauth/callback/${launch.id}; HttpOnly; SameSite=Lax; Max-Age=600`);
        res.writeHead(303, { Location: launch.url }); return res.end();
      }
      if (url.pathname.startsWith('/oauth/callback/') && req.method === 'GET') {
        const id = url.pathname.slice('/oauth/callback/'.length);
        try {
          const channel=await router.serial(id, () => oauth.complete(id, {
            state: url.searchParams.get('state'), code: url.searchParams.get('code'), error: url.searchParams.get('error'),
            browserNonce: cookies(req)[`oauth_${id}`]
          }));
          await router.sites(id,{channel}).catch(() => {});
          res.setHeader('Set-Cookie', `oauth_${id}=; Path=/oauth/callback/${id}; HttpOnly; SameSite=Lax; Max-Age=0`);
          finishOAuth(res, true);
        } catch {
          router.store.audit('oauth_callback_failed');
          finishOAuth(res, false);
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === `/dashboard/login/${loginTicket}`) {
        if (!loginAvailable || now() >= loginExpires) return json(res, {error:'Login link expired. Restart the router.'}, 410);
        loginAvailable = false;
        res.setHeader('Set-Cookie', `router_session=${managementToken}; Path=/; HttpOnly; SameSite=Strict`);
        res.writeHead(303, {Location:'/'}); return res.end();
      }
      const supplied = Buffer.from(cookies(req).router_session || '');
      const expected = Buffer.from(managementToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, {error:'Open MCP Router to access this dashboard.'}, 403);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, { ...router.store.summary(), csrf });
      if (req.method === 'GET' && (url.pathname === '/' || /^\/assets\/[A-Za-z0-9_-]+\.(js|css|png|svg)$/.test(url.pathname))) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'text/html');
        const file = path.join(ROOT, 'public', name);
        if (!fs.existsSync(file)) return json(res, { error: 'Not found' }, 404);
        return res.end(fs.readFileSync(file));
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-router-csrf'] !== csrf || !req.headers['content-type']?.startsWith('application/json')) return json(res, { error: 'Request denied' }, 403);
      const data = await body(req);
      const management = url.pathname.match(/^\/api\/(connections|projects)\/([A-Za-z0-9_-]+)\/(edit|delete)$/);
      if (management) {
        const [, kind, id, action] = management;
        if (action === 'edit') router.edit(kind, id, data);
        if (action === 'delete') router.remove(kind, id);
        return json(res, { ok: true });
      }
      if (url.pathname === '/api/settings/connection-order') {
        if(Object.keys(data).length!==1||!Object.hasOwn(data,'ids'))throw new Error('Invalid order');
        router.reorderConnections(data.ids);return json(res,{ok:true});
      }
      if (url.pathname === '/api/settings/default-channel') {
        if(Object.keys(data).length!==1)throw new Error('Invalid settings');
        router.setDefaultChannel(data.channel);return json(res,{ok:true});
      }
      if (url.pathname === '/api/settings/default-permissions') {
        if (Object.keys(data).length !== 1 || !Object.hasOwn(data, 'permissions')) throw new Error('Invalid settings');
        router.setDefaultPermissions(data.permissions); return json(res, { ok:true });
      }
      if (url.pathname === '/api/connections') return json(res, { id: router.createConnection(data.name) });
      if (url.pathname === '/api/projects') return json(res, { id: router.saveProject(data) });
      if (url.pathname === '/api/verify') return json(res, await router.verify(data.connectionIds));
      const match = url.pathname.match(/^\/api\/connections\/([a-f0-9-]+)\/(authorize|check|refresh|toggle)$/);
      if (match) {
        const [, id, action] = match;
        if (action === 'authorize') {
          const result = await router.serial(id, () => oauth.begin(id,data.channel));
          for (const [key, launch] of launches) if (launch.expires < Date.now()) launches.delete(key);
          const ticket = nonce();
          launches.set(ticket, { ...result, id, expires: Date.now() + 60000 });
          return json(res, { url: `${origin}/oauth/launch/${ticket}` });
        }
        if (action === 'toggle') { router.setConnection(id, data.enabled); return json(res, { ok: true }); }
        return json(res, { sites: await router.sites(id, { refresh: action === 'refresh', channel:data.channel || router.store.data.settings.defaultChannel || 'stable' }) });
      }
      if (url.pathname === '/api/read-project') return json(res, await router.call('read_project_site', data));
      return json(res, { error: 'Unknown route' }, 404);
    } catch {
      // OAuth libraries sometimes include upstream payloads in errors. Never echo them.
      return json(res, { error: 'Request failed. Check connection status, project access, or complete OAuth again.' }, 400);
    }
  });
}

export function createIPC(router, token = null) {
  return http.createServer(async (req, res) => {
    try {
      if (token && req.headers.authorization !== `Bearer ${token}`) return json(res, {error:'Access denied'}, 403);
      if (req.method !== 'POST' || req.url !== '/call') return json(res, { error: 'Not found' }, 404);
      const { name, arguments: args } = await body(req);
      return json(res, { result: await router.call(name, args) });
    } catch { return json(res, { error: 'Request denied or upstream connection unavailable' }, 400); }
  });
}

export async function main() {
  await privateDirectories.privateDirectoryAsync(DATA_DIR);
  const lockFile = path.join(DATA_DIR, 'daemon.lock');
  if (fs.existsSync(lockFile)) {
    const oldPid = Number(fs.readFileSync(lockFile, 'utf8'));
    try { process.kill(oldPid, 0); throw new Error('Router already running'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; fs.unlinkSync(lockFile); }
  }
  fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 });
  const port = Number(process.env.ROUTER_PORT || 43127);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const origin = `http://127.0.0.1:${port}`;
  const store = await Store.open(DATA_DIR), oauth = new OAuthManager(store, origin), router = new Router(store, oauth);
  const managementToken = nonce(), loginTicket = nonce();
  const ipcToken = process.platform === 'win32' ? nonce() : null;
  if (ipcToken) fs.writeFileSync(path.join(DATA_DIR, 'ipc-token'), ipcToken, {mode:0o600});
  const dashboard = createDashboard(router, oauth, origin, {managementToken, loginTicket}), ipc = createIPC(router, ipcToken);
  // Keep Unix socket path below the macOS limit, under the private state directory.
  const socket = paths.ipcEndpoint(path.join(DATA_DIR, 'router.sock'));
  const windows = process.platform === 'win32';
  if (!windows && Buffer.byteLength(socket) > 103) throw new Error('Project path too long for Unix socket');
  if (!windows && fs.existsSync(socket)) fs.unlinkSync(socket);
  const cleanup = () => { try { fs.unlinkSync(lockFile); } catch {} };
  process.on('exit', cleanup);
  await new Promise((resolve, reject) => { dashboard.once('error', reject); dashboard.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => { ipc.once('error', reject); ipc.listen(socket, resolve); });
  if (!windows) fs.chmodSync(socket, 0o600);
  router.startProjectResync();
  dashboard.once('close', () => router.stopProjectResync());
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { dashboard.close(); ipc.close(); process.exit(0); });
  const loginFile = path.join(DATA_DIR, 'dashboard-login.txt');
  fs.writeFileSync(loginFile, `${origin}/dashboard/login/${loginTicket}\n`, {mode:0o600});
  fs.chmodSync(loginFile, 0o600);
  console.log(`MCP Router: ${origin}. Private browser login: ${loginFile}`);
  return { dashboard, ipc, router, managementToken };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Router failed to start. Check whether it is already running, the port is available, and the project path is short enough.'); process.exit(1);
});
