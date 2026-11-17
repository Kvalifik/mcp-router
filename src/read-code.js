import { Worker } from 'node:worker_threads';
import { AgentError } from './agent-errors.js';
import { operation } from './permissions.js';

const active = new WeakSet();
const denied = (code, message) => new AgentError(code, message);

// A single run per daemon bounds aggregate worker memory and upstream pressure.
// Every read still traverses the normal router dispatcher and ownership checks.
export async function runReadCode(router, args) {
  if (!args || Object.keys(args).some(key => !['projectId','code'].includes(key)) ||
      typeof args.projectId !== 'string' || typeof args.code !== 'string' ||
      !args.code.trim() || Buffer.byteLength(args.code) > 32768) throw new Error('Invalid arguments');
  const policy = () => {
    if (router.store.data.settings.readCodeEnabled === false)
      throw denied('code_mode_disabled', 'Read-only code mode is disabled in Settings. Use ordinary read_webflow calls; only the owner can enable code mode.');
    const p = router.project(args.projectId, null), c = router.store.connection(p.connectionId);
    return JSON.stringify([router.store.data.settings.readCodeRevision || 0, p, router.channel(p), c.accessRevision, c.connectionPermissions,
      c.workspacePermissions, c.sites, c.stableSites, c.beta?.sites,
      c.enabled, c.deletedAt, !!c.tokens, !!c.beta?.tokens]);
  };
  const initial = policy();
  const recheck = () => {
    if (policy() !== initial) throw denied('project_policy_changed', 'Project policy changed during request');
  };
  if (active.has(router)) throw denied('code_mode_busy', 'A read-code run is already active.');
  active.add(router);
  const started = performance.now();
  let inFlight;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./read-code-worker.js', import.meta.url), {
        workerData: {code:args.code, timeoutMs:30000},
        resourceLimits: {maxOldGenerationSizeMb:64, maxYoungGenerationSizeMb:16},
      });
      let finished = false, busy = false, calls = 0, responseBytes = 0;
      const finish = (error, output) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        void worker.terminate().then(() => {
          if (error) reject(error);
          else resolve({output, stats:{calls, responseBytes, outputBytes:Buffer.byteLength(output), elapsedMs:Math.round(performance.now()-started)}});
        });
      };
      const timer = setTimeout(() => finish(denied('code_mode_timeout', 'Read-code run exceeded 30 seconds.')), 30000);
      worker.on('error', () => finish(denied('code_mode_failed', 'Read-code sandbox failed.')));
      worker.on('exit', () => { if (!finished) finish(denied('code_mode_failed', 'Read-code sandbox exited early.')); });
      worker.on('message', async message => {
        if (finished) return;
        try {
          recheck();
          if (message.type === 'done') return finish(null, message.output);
          if (message.type !== 'read' || busy) throw denied('code_mode_failed', 'Snippet failed or exceeded a sandbox limit.');
          if (++calls > 100) throw denied('code_mode_limit', 'Read-code run exceeded 100 reads.');
          busy = true;
          const request = JSON.parse(message.json);
          const p = router.project(args.projectId, null);
          const op = operation(request.operationId, router.channel(p));
          // Explicitly exclude broader workspace/account scopes from this prototype.
          if (op.mode !== 'read' || (op.scope && op.scope !== 'project'))
            throw denied('code_mode_read_only', 'Read-code supports only project-scoped read operations.');
          inFlight = router.call('read_webflow', {...request, projectId:args.projectId});
          const response = await inFlight;
          inFlight = undefined;
          if (finished) return; // An already-dispatched read may drain after timeout.
          recheck();
          const json = JSON.stringify(response), bytes = Buffer.byteLength(json);
          responseBytes += bytes;
          if (bytes > 4 * 1024 * 1024 || responseBytes > 32 * 1024 * 1024)
            throw denied('code_mode_limit', 'Read-code response size limit exceeded.');
          busy = false;
          worker.postMessage({json});
        } catch (error) { finish(error); }
      });
    });
  } finally {
    // Keep the slot occupied until a timed-out upstream read drains.
    if (inFlight) void inFlight.catch(() => {}).finally(() => active.delete(router));
    else active.delete(router);
  }
}
