// Squirrel can install on ordinary quit once it prepares an update. Keep the
// archive outside Squirrel until the owner selects the matching install action.
function createAppUpdater({checker, autoUpdater, cache, arch, isSkipped, setSkipped, onChange = () => {}}) {
  let state = {state:'current'};
  let prepared = null;
  let pending, manualRequested, download;

  function publish(next) {
    state = next;
    onChange({...state});
    return {...state};
  }
  const installError = () => publish({state:'error', reason:'install'});
  autoUpdater?.on('error', () => { if (state.state === 'installing') installError(); });
  autoUpdater?.on('update-not-available', () => { if (state.state === 'installing') installError(); });
  autoUpdater?.on('update-downloaded', () => {
    if (state.state !== 'installing') return;
    try { autoUpdater.quitAndInstall(); } catch { installError(); }
  });

  async function discover() {
    const result = await checker.check();
    if (state.state === 'installing') return {...state};
    if (result.state !== 'available') {
      if (cache && ['current','no-release'].includes(result.state)) {
        prepared = null;
        // Cleanup is best effort. A busy cache should never change the result.
        await cache.clear().catch(() => {});
      }
      return publish(result);
    }
    const {version} = result;
    if (!manualRequested && isSkipped(version)) return publish({state:'skipped'});
    const asset = autoUpdater && checker.macArchive(arch);
    if (!asset) return publish(result);
    if (!prepared || prepared.sha256 !== asset.sha256 || prepared.version !== version) {
      prepared = null;
      download = new AbortController();
      publish({state:'downloading', version});
      try { await cache.prepare(asset, download.signal); }
      catch { return state.state === 'skipped' ? {...state} : installError(); }
      finally { download = null; }
      prepared = asset;
      if (state.state === 'skipped' && !manualRequested) return {...state};
    }
    return publish({state:'ready', version});
  }

  function check(manual = false) {
    if (state.state === 'installing') return Promise.resolve({...state});
    if (download && !download.signal.aborted) return Promise.resolve({...state});
    if (manual && download?.signal.aborted) return pending.then(() => check(true));
    if (!pending) {
      manualRequested = false;
      pending = discover().finally(() => { pending = null; });
    }
    if (manual) manualRequested = true;
    return pending;
  }

  function skip(version) {
    if (state.version !== version || !['available','ready','downloading'].includes(state.state)) throw new Error('Update offer changed');
    setSkipped(version);
    download?.abort();
    manualRequested = false;
    return publish({state:'skipped'});
  }

  async function install(version) {
    if (state.state !== 'ready' || state.version !== version || prepared?.version !== version) throw new Error('Update offer changed');
    publish({state:'installing', version});
    try {
      const url = await cache.installFeed(prepared);
      autoUpdater.setFeedURL({url, serverType:'default'});
      autoUpdater.checkForUpdates();
    } catch { installError(); }
  }

  function downloadUrl(version) {
    if (state.state !== 'available' || state.version !== version || !checker.releaseUrl()) throw new Error('Update offer changed');
    return checker.releaseUrl();
  }
  return {check, skip, install, downloadUrl};
}
module.exports = {createAppUpdater};
