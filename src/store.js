import fs from 'node:fs';
import privateDirectories from './private-directory.cjs';
import { compareGrants } from './grant-comparison.js';
import { GROUPS, permissions } from './permissions.js';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const fingerprint = value => value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null;
const securedDirectory = Symbol('securedDirectory');
export class Store {
  static async open(dir) {
    await privateDirectories.privateDirectoryAsync(dir);
    return new Store(dir, securedDirectory);
  }
  constructor(dir, secured) {
    this.dir = dir;
    if (secured !== securedDirectory) privateDirectories.privateDirectory(dir);
    const keyFile = path.join(dir, 'vault.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
    fs.chmodSync(keyFile, 0o600);
    this.key = fs.readFileSync(keyFile);
    this.file = path.join(dir, 'vault.enc');
    this.data = { connections: {}, projects: {}, audit: [] };
    if (fs.existsSync(this.file)) {
      fs.chmodSync(this.file, 0o600);
      const bytes = fs.readFileSync(this.file);
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      this.data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    }
  }
  save() {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(this.data)), cipher.final()]);
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  connection(id) {
    const c = Object.hasOwn(this.data.connections, id) ? this.data.connections[id] : null;
    if (!c || c.deletedAt) throw new Error('Unknown connection');
    return c;
  }
  audit(event, details = {}) {
    // Callers supply identifiers and fixed messages only, never upstream responses or secrets.
    this.data.audit.push({ at: new Date().toISOString(), event, ...details });
    this.data.audit = this.data.audit.slice(-200);
    this.save();
  }
  summary() {
    return {
      permissionGroups: GROUPS,
      settings: this.data.settings,
      connections: Object.values(this.data.connections).filter(c => !c.deletedAt).sort((a,b)=>{const order=this.data.settings?.connectionOrder||[];const rank=id=>{const i=order.indexOf(id);return i<0?Number.MAX_SAFE_INTEGER:i;};return rank(a.id)-rank(b.id);}).map(c => ({
        id: c.id, needsName: c.namingPending === true && [c, c.beta].some(grant => grant?.tokens && grant.status === 'connected' && !grant.inventoryPending), grantComparison:compareGrants(c), betaTokenVersion:c.beta?.tokenVersion||0, channel:this.data.settings?.defaultChannel || 'stable', channels:{stable:{authorized:!!c.tokens,status:c.status,inventoryPending:!!c.inventoryPending,siteIds:c.inventoryPending?[]:(c.stableSites||c.sites||[]).map(s=>s.id)},beta:{authorized:!!c.beta?.tokens,status:c.beta?.status || 'needs_authorization',inventoryPending:!!c.beta?.inventoryPending,siteIds:c.beta?.inventoryPending?[]:(c.beta?.sites||[]).map(s=>s.id)}}, name: c.name, sourceName:c.sourceName || null, nameOverride:c.nameOverride, enabled: c.enabled, status: this.data.settings?.defaultChannel==='beta'?(c.beta?.status||'needs_authorization'):c.status,
        clientFingerprint: fingerprint(c.client?.client_id), tokenFingerprint: fingerprint((this.data.settings?.defaultChannel==='beta'?c.beta:c)?.tokens?.access_token),
        hasRefreshToken: !!c.tokens?.refresh_token, tokenVersion: c.tokenVersion || 0,
        expiresAt: c.expiresAt || null, lastChecked: c.lastChecked || null,
        siteCount: c.sites?.length || 0, sites: c.sites || [], lastError: c.lastError || null
      })),
      projects: Object.values(this.data.projects).filter(p => !p.deletedAt && p.available !== false && !this.data.connections[p.connectionId]?.deletedAt).map(p=>({...p,permissions:permissions(p)})),
      audit: this.data.audit.slice(-30).reverse()
    };
  }
}
