import { randomBytes } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

export const WEBFLOW_URL = 'https://mcp.webflow.com/mcp';
export function endpoint(channel = 'stable') {
  if (!['stable','beta'].includes(channel)) throw new Error('Invalid MCP channel');
  return channel === 'beta' ? 'https://mcp.webflow.com/beta/mcp' : WEBFLOW_URL;
}
export function session(store,id,channel='stable') {
  endpoint(channel); const c=store.connection(id);
  return channel==='stable' ? c : (c.beta ||= {status:'needs_authorization',sites:[]});
}
export const nonce = () => randomBytes(32).toString('base64url');

// OAuth discovery cannot send credentials to arbitrary hosts or follow HTTP redirects.
export async function webflowFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'https://mcp.webflow.com') throw new Error('Unexpected OAuth or MCP origin');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(input, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  } finally { clearTimeout(timeout); }
}

export class Provider {
  constructor(store, id, origin, interactive = false, channel = 'stable') {
    this.store = store; this.id = id; this.origin = origin; this.interactive = interactive; this.channel=channel; endpoint(channel);
  }
  get c() { return session(this.store,this.id,this.channel); }
  get serverUrl() { return endpoint(this.channel); }
  get redirectUrl() { return `${this.origin}/oauth/callback/${this.id}`; }
  get clientMetadata() {
    return {
      client_name: `MCP Router ${this.store.connection(this.id).name} ${this.channel} ${this.id.slice(0, 8)}`,
      redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none'
    };
  }
  state() {
    if (!this.interactive || !this.c.pending) throw new Error('Reconnect this connection in the dashboard');
    return this.c.pending.state;
  }
  clientInformation() { return this.c.client; }
  saveClientInformation(client) {
    // Separate registrations must stay separate even if the provider unexpectedly reuses an ID.
    if (Object.values(this.store.data.connections).some(c => [c,c.beta].some(s => s && s !== this.c && s.client?.client_id === client.client_id))) {
      throw new Error('Webflow reused an OAuth client ID across connections');
    }
    this.c.client = client; this.store.save();
  }
  tokens() { return this.c.tokens; }
  saveTokens(tokens) {
    const old = this.c.tokens;
    this.c.tokens = { ...tokens, ...(tokens.refresh_token ? {} : old?.refresh_token ? { refresh_token: old.refresh_token } : {}),
      // A refresh response may omit unchanged scopes. Interactive authorization
      // starts with no old tokens, so a new grant cannot inherit old scope claims.
      ...(tokens.scope === undefined && old?.scope !== undefined ? { scope: old.scope } : {}) };
    this.c.expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
    this.c.tokenVersion = (this.c.tokenVersion || 0) + 1;
    this.c.status = 'authorized'; this.c.lastError = null;
    this.store.audit('oauth_tokens_saved', { connectionId: this.id, tokenVersion: this.c.tokenVersion });
  }
  redirectToAuthorization(url) {
    if (!this.interactive) throw new Error('Reconnect this connection in the dashboard');
    if (url.origin !== 'https://mcp.webflow.com') throw new Error('Unexpected authorization origin');
    this.store.save();
    this.authorizationUrl = url.toString();
  }
  saveCodeVerifier(verifier) {
    if (!this.interactive || !this.c.pending) throw new Error('No pending browser authorization');
    this.c.pending.verifier = verifier; this.store.save();
  }
  codeVerifier() {
    if (!this.c.pending?.verifier) throw new Error('No pending authorization');
    return this.c.pending.verifier;
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') delete this.c.client;
    if (scope === 'all' || scope === 'tokens') { delete this.c.tokens; this.c.status = 'needs_authorization'; }
    if (scope === 'all' || scope === 'verifier') delete this.c.pending;
    this.store.save();
  }
}

export class OAuthManager {
  constructor(store, origin, { authFn = auth, fetchFn = webflowFetch } = {}) {
    this.store = store; this.origin = origin; this.authFn = authFn; this.fetchFn = fetchFn;
  }
  provider(id, interactive = false, channel = 'stable') { return new Provider(this.store, id, this.origin, interactive, channel); }
  async begin(id, channel = this.store.data.settings?.defaultChannel || 'stable') {
    const root=this.store.connection(id), c=session(this.store,id,channel);
    delete root.pending; if(root.beta)delete root.beta.pending; root.oauthChannel=channel;
    delete c.tokens; c.inventoryPending=true;
    c.pending = { state: nonce(), browserNonce: nonce(), createdAt: Date.now() };
    c.status = 'awaiting_authorization'; this.store.save();
    const provider = this.provider(id, true, channel);
    try {
      const result = await this.authFn(provider, { serverUrl: endpoint(channel), fetchFn: this.fetchFn });
      if (result !== 'REDIRECT' || !provider.authorizationUrl || root.deletedAt || !c.pending) throw new Error('OAuth did not produce an authorization URL');
      return { url: provider.authorizationUrl, browserNonce: c.pending.browserNonce };
    } catch {
      delete c.pending; c.status = 'needs_authorization';
      c.lastError = 'OAuth setup failed. Retry Connect with OAuth.';
      this.store.audit('oauth_start_failed', { connectionId: id });
      throw new Error(c.lastError);
    }
  }
  async complete(id, { state, code, browserNonce, error }) {
    const root=this.store.connection(id), channel=root.oauthChannel || 'stable', c=session(this.store,id,channel), pending=c.pending;
    if (root.deletedAt || !pending || !state || pending.state !== state || !browserNonce || pending.browserNonce !== browserNonce || Date.now() - pending.createdAt > 10 * 60_000 || pending.used) {
      throw new Error('Invalid or expired OAuth callback');
    }
    pending.used = true; this.store.save();
    try {
      if (error || !code) throw new Error('Authorization was not completed');
      const result = await this.authFn(this.provider(id, true, channel), { serverUrl: endpoint(channel), authorizationCode: code, fetchFn: this.fetchFn });
      if (result !== 'AUTHORIZED') throw new Error('Authorization was not completed');
      return channel;
    } finally { delete c.pending; this.store.save(); }
  }
  async refresh(id, channel='stable') {
    const c=session(this.store,id,channel);
    if (!this.store.connection(id).enabled || !c.tokens?.refresh_token) throw new Error('No enabled connection with a refresh token');
    if (await this.authFn(this.provider(id, false, channel), { serverUrl: endpoint(channel), fetchFn: this.fetchFn }) !== 'AUTHORIZED') throw new Error('Reconnect required');
  }
}
