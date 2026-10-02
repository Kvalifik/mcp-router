import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, CATALOG, allowed } from '../src/permissions.js';
import { presetGrants, accessLabel } from '../ui/permission-presets.js';

test('No publishing blocks every publishing operation and retains other capabilities', () => {
  const permissions = presetGrants(PERMISSIONS, 'no-publishing');
  for (const op of CATALOG) {
    const publishing = [op.permission, ...op.extraPermissions].some(key => key.endsWith(':publish'));
    assert.equal(allowed({ permissions }, op), !publishing, op.id);
  }
  assert.equal(accessLabel(PERMISSIONS, permissions), 'No publishing');
  assert.equal(accessLabel(PERMISSIONS, {...permissions, 'site:read':false}), 'Custom access');
  assert.equal(accessLabel(PERMISSIONS, presetGrants(PERMISSIONS, 'all')), 'Full access');
  assert.equal(accessLabel(PERMISSIONS, presetGrants(PERMISSIONS, 'read')), 'Read-only');
  assert.equal(accessLabel(PERMISSIONS, presetGrants(PERMISSIONS, 'none')), 'No permissions');
});

test('Read & write blocks delete and publish operations, including extra requirements', () => {
  const permissions = presetGrants(PERMISSIONS, 'read-write');
  for (const op of CATALOG) {
    const editable = [op.permission, ...op.extraPermissions].every(key => key.endsWith(':read') || key.endsWith(':write'));
    assert.equal(allowed({ permissions }, op), editable, op.id);
  }
  assert.equal(accessLabel(PERMISSIONS, permissions), 'Read & write');
  assert.equal(accessLabel(PERMISSIONS, {...permissions, 'site:read':false}), 'Custom access');
});
