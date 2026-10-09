import test from 'node:test';
import assert from 'node:assert/strict';
import { macSigningConfig } from '../scripts/sign-mac.mjs';

test('local builds remain ad-hoc unless Developer ID is explicitly selected', () => {
  assert.deepEqual(macSigningConfig({}), { mode: 'adhoc' });
  assert.throws(() => macSigningConfig({ MAC_SIGNING_MODE: 'auto' }), /Invalid/);
  assert.throws(() => macSigningConfig({ MAC_SIGNING_IDENTITY: 'certificate' }), /Set MAC_SIGNING_MODE/);
  assert.throws(() => macSigningConfig({ MAC_NOTARY_PROFILE: 'profile' }), /Set MAC_SIGNING_MODE/);
});

test('Developer ID mode fails closed for missing credentials or development certificates', () => {
  const env = { MAC_SIGNING_MODE: 'developer-id' };
  assert.throws(() => macSigningConfig(env), /certificate name/);
  env.MAC_SIGNING_IDENTITY = 'Apple Development: Example Developer (A1B2C3D4E5)';
  assert.throws(() => macSigningConfig(env), /certificate name/);
  env.MAC_SIGNING_IDENTITY = 'Developer ID Application: Example Developer (A1B2C3D4E5)';
  assert.throws(() => macSigningConfig(env), /MAC_NOTARY_PROFILE/);
  env.MAC_NOTARY_PROFILE = 'test-profile';
  env.MAC_SIGNING_KEYCHAIN = '/tmp/synthetic-signing.keychain-db';
  assert.deepEqual(macSigningConfig(env), {
    mode: 'developer-id', identity: env.MAC_SIGNING_IDENTITY,
    keychainProfile: 'test-profile', keychain: env.MAC_SIGNING_KEYCHAIN,
  });
});
