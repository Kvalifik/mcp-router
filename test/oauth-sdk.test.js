import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { OAuthManager } from '../src/oauth.js';
import { Router } from '../src/router.js';

test('real SDK: two DCR clients, PKCE code exchanges, refresh rotation and persistence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let registration = 0, refreshes = 0;
  const grants = new Map(), registrations = new Map();
  const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return reply({ resource: 'https://mcp.webflow.com/mcp', authorization_servers: ['https://mcp.webflow.com'], scopes_supported: ['sites:read', 'cms:write'] });
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) return reply({ issuer: 'https://mcp.webflow.com', authorization_endpoint: 'https://mcp.webflow.com/oauth/authorize', token_endpoint: 'https://mcp.webflow.com/oauth/token', registration_endpoint: 'https://mcp.webflow.com/oauth/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] });
    if (url.pathname === '/oauth/register') {
      const data = JSON.parse(init.body), client_id = `client-${++registration}`;
      registrations.set(client_id, data); return reply({ ...data, client_id });
    }
    if (url.pathname === '/oauth/token') {
      const data = new URLSearchParams(init.body), client = data.get('client_id');
      assert.ok(registrations.has(client));
      if (data.get('grant_type') === 'authorization_code') {
        const grant = grants.get(data.get('code'));
        assert.equal(grant.client, client);
        assert.equal(grant.challenge, createHash('sha256').update(data.get('code_verifier')).digest('base64url'));
        assert.equal(data.get('redirect_uri'), registrations.get(client).redirect_uris[0]);
        return reply({ scope: client === 'client-1' ? 'sites:read' : 'sites:read cms:write', access_token: `access-${client}`, refresh_token: `refresh-${client}`, token_type: 'Bearer', expires_in: 3600 });
      }
      assert.equal(data.get('refresh_token'), `refresh-${client}`); refreshes++;
      return reply({ access_token: `rotated-${client}`, refresh_token: `refresh2-${client}`, token_type: 'Bearer', expires_in: 3600 });
    }
    return new Response('', { status: 404 });
  };
  const store = new Store(dir), oauth = new OAuthManager(store, 'http://127.0.0.1:43127', { fetchFn }), router = new Router(store, oauth);
  const a = router.createConnection('A'), b = router.createConnection('B');
  for (const id of [a, b]) {
    const start = await oauth.begin(id), url = new URL(start.url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'sites:read cms:write');
    grants.set(id, { client: url.searchParams.get('client_id'), challenge: url.searchParams.get('code_challenge') });
    await oauth.complete(id, { state: url.searchParams.get('state'), code: id, browserNonce: start.browserNonce });
  }
  assert.equal(registration, 2);
  assert.notEqual(store.connection(a).client.client_id, store.connection(b).client.client_id);
  await oauth.refresh(a);
  assert.equal(refreshes, 1);
  assert.equal(store.connection(a).tokens.access_token, 'rotated-client-1');
  assert.equal(store.connection(b).tokens.access_token, 'access-client-2');
  const reloaded = new Store(dir);
  assert.equal(reloaded.connection(a).tokens.scope, 'sites:read');
  assert.equal(reloaded.connection(a).tokens.refresh_token, 'refresh2-client-1');
  assert.equal(reloaded.connection(b).tokens.refresh_token, 'refresh-client-2');
});
