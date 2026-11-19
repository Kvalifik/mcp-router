const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {pathToFileURL} = require('node:url');

// Only this main-process cache sees the pinned archive URL and private paths.
function createUpdateCache(directory, fetchImpl = fetch) {
  const archive = path.join(directory, 'update.zip');
  const part = path.join(directory, 'download.part');
  const feed = path.join(directory, 'install.json');

  async function prepare(asset, cancellation) {
    const timeout = AbortSignal.timeout(15 * 60 * 1000);
    const signal = cancellation ? AbortSignal.any([cancellation, timeout]) : timeout;
    await fs.promises.mkdir(directory, {recursive:true, mode:0o700});
    try {
      if ((await fs.promises.stat(archive)).size === asset.size) {
        const hash = createHash('sha256');
        for await (const chunk of fs.createReadStream(archive,{signal})) hash.update(chunk);
        if (hash.digest('hex') === asset.sha256) return;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }

    await fs.promises.rm(part, {force:true});
    try {
      const response = await fetchImpl(asset.url, {signal});
      if (!response.ok || !response.body) throw new Error('Archive unavailable');
      const hash = createHash('sha256');
      let size = 0;
      await pipeline(response.body, async function* (chunks) {
        for await (const chunk of chunks) {
          size += chunk.length;
          if (size > asset.size) throw new Error('Unexpected archive size');
          hash.update(chunk);
          yield chunk;
        }
      }, fs.createWriteStream(part, {flags:'wx',mode:0o600}), {signal});
      if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Archive checksum mismatch');
      await fs.promises.rename(part, archive);
    } finally { await fs.promises.rm(part, {force:true}); }
  }

  async function installFeed(asset) {
    // The dynamic feed carries the exact selected archive. Squirrel verifies its
    // digest again and enforces the running app's signing requirement.
    await fs.promises.writeFile(feed, JSON.stringify({url:pathToFileURL(archive).href,
      name:asset.version, version:asset.version, size:asset.size, sha256:asset.sha256}), {mode:0o600});
    return pathToFileURL(feed).href;
  }
  async function clear() {
    await Promise.all([archive,part,feed].map(file => fs.promises.rm(file, {force:true})));
  }
  return {prepare, installFeed, clear};
}
module.exports = {createUpdateCache};
