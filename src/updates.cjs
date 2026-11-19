const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

function newer(candidate, current) {
  const a = VERSION.exec(candidate), b = VERSION.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (a[i] !== b[i]) return BigInt(a[i]) > BigInt(b[i]);
  }
  return Boolean(b[4]) && (!a[4] || BigInt(a[4]) > BigInt(b[4]));
}

function createUpdateChecker({repository, currentVersion, fetchImpl = fetch}) {
  const valid = typeof repository === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository);
  const preview = Boolean(VERSION.exec(currentVersion)?.[4]);
  const releases = `https://github.com/${repository}/releases`;
  let release, pending;

  async function discover() {
    if (!valid) return {state:'unconfigured'};
    release = null;
    let best, eligible = false;
    const signal = AbortSignal.timeout(30000);
    for (let page = 1; ; page++) {
      const suffix = preview ? `?per_page=10&page=${page}` : '/latest';
      const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases${suffix}`, {
        headers:{Accept:'application/vnd.github+json'}, redirect:'error', signal,
      });
      if (response.status === 404) return {state:'no-release'};
      if (!response.ok) {
        const limited = response.status === 429 || response.status === 403 && response.headers?.get('x-ratelimit-remaining') === '0';
        return {state:'error', reason:limited ? 'rate-limit' : 'server'};
      }
      const text = await response.text();
      if (text.length > 1048576) return {state:'error', reason:'invalid-response'};
      const parsed = JSON.parse(text);
      const items = preview ? parsed : [parsed];
      if (!Array.isArray(items)) return {state:'error', reason:'invalid-response'};
      for (const item of items) {
        const tag = item?.tag_name;
        const version = typeof tag === 'string' && VERSION.exec(tag);
        if (!version || item.draft || Boolean(version[4]) !== Boolean(item.prerelease) || (!preview && item.prerelease)) continue;
        eligible = true;
        if (newer(tag, best?.tag_name || currentVersion)) best = item;
      }
      if (!preview || items.length < 10) break;
    }
    release = best;
    return best ? {state:'available', version:best.tag_name.replace(/^v/, '')} : {state:eligible ? 'current' : 'no-release'};
  }

  function check() {
    if (!pending) pending = discover().catch(error => ({
      state:'error', reason:['TimeoutError','AbortError'].includes(error?.name) ? 'timeout' : error instanceof SyntaxError ? 'invalid-response' : 'network',
    })).finally(() => { pending = null; });
    return pending;
  }

  function macArchive(arch) {
    if (!['arm64','x64'].includes(arch) || !Array.isArray(release?.assets)) return null;
    if (!release.assets.some(a => a.name === `update-mac-${arch}.json`)) return null;
    const version = release.tag_name.replace(/^v/, '');
    const name = `MCP-Router-${version}-mac-${arch}.zip`;
    const asset = release.assets.find(a => a.name === name);
    if (!/^sha256:[0-9a-f]{64}$/.test(asset?.digest) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 512 * 1024 * 1024) return null;
    return {version, url:`${releases}/download/${release.tag_name}/${name}`, sha256:asset.digest.slice(7), size:asset.size};
  }

  return {check, macArchive, releaseUrl:() => release ? `${releases}/tag/${release.tag_name}` : null};
}

module.exports = {createUpdateChecker, newer};
