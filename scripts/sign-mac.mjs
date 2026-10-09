import { execFileSync } from 'node:child_process';

// Explicit mode selection prevents a missing credential from silently producing
// an ad-hoc release when Developer ID signing was requested.
export function macSigningConfig(env = process.env) {
  const mode = env.MAC_SIGNING_MODE || 'adhoc';
  if (!['adhoc', 'developer-id'].includes(mode)) throw new Error('Invalid MAC_SIGNING_MODE');
  if (mode === 'adhoc') {
    if (env.MAC_SIGNING_IDENTITY || env.MAC_NOTARY_PROFILE) throw new Error('Set MAC_SIGNING_MODE=developer-id to use signing credentials');
    return { mode };
  }
  if (!/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(env.MAC_SIGNING_IDENTITY || '')) {
    throw new Error('MAC_SIGNING_IDENTITY must be the full Developer ID Application certificate name');
  }
  if (!env.MAC_NOTARY_PROFILE) throw new Error('MAC_NOTARY_PROFILE is required for Developer ID builds');
  return { mode, identity: env.MAC_SIGNING_IDENTITY, keychain: env.MAC_SIGNING_KEYCHAIN || undefined,
    keychainProfile: env.MAC_NOTARY_PROFILE };
}

export async function signMac(app, config) {
  if (config.mode === 'developer-id') {
    const { sign } = await import('@electron/osx-sign');
    const { notarize } = await import('@electron/notarize');
    // Use Electron's per-binary entitlements and hardened runtime defaults.
    await sign({ app, identity: config.identity, keychain: config.keychain,
      platform: 'darwin', type: 'distribution', preEmbedProvisioningProfile: false });
    await notarize({ appPath: app, keychainProfile: config.keychainProfile, keychain: config.keychain });
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { stdio: 'inherit' });
  } else {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none',
      '--preserve-metadata=entitlements,flags,runtime', app], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
}
