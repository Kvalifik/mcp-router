// Untrusted snippets run in QuickJS/WASM, never Node eval or node:vm.
import { parentPort, workerData } from 'node:worker_threads';
import { newAsyncContext } from 'quickjs-emscripten';

const vm = await newAsyncContext();
vm.runtime.setMemoryLimit(32 * 1024 * 1024);
vm.runtime.setMaxStackSize(256 * 1024);
const deadline = Date.now() + workerData.timeoutMs;
vm.runtime.setInterruptHandler(() => Date.now() >= deadline);
let output = '', failed = false;
const bridge = vm.newAsyncifiedFunction('__read', async request => {
  const json = vm.getString(request);
  if (Buffer.byteLength(json) > 32768) throw new Error('Read arguments too large');
  const response = await new Promise(resolve => {
    parentPort.once('message', resolve);
    parentPort.postMessage({ type: 'read', json });
  });
  return vm.newString(response.json);
});
vm.setProp(vm.global, '__read', bridge); bridge.dispose();
const print = vm.newFunction('__print', value => {
  const text = vm.getString(value) + '\n';
  if (Buffer.byteLength(output) + Buffer.byteLength(text) > 20000) {
    failed = true;
    throw new Error('Output limit exceeded');
  }
  output += text;
});
vm.setProp(vm.global, '__print', print); print.dispose();
try {
  const bootstrap = vm.evalCode(`
    const read = (operationId, params = {}, pageId) => JSON.parse(__read(JSON.stringify({operationId, params, ...(pageId === undefined ? {} : {pageId})})));
    const print = value => __print(JSON.stringify(value) ?? 'null');
  `);
  vm.unwrapResult(bootstrap).dispose();
  const result = await vm.evalCodeAsync(workerData.code, 'snippet.js');
  if (result.error) { result.error.dispose(); failed = true; }
  else {
    const state = vm.getPromiseState(result.value);
    if (!state.notAPromise) failed = true;
    if (state.value && state.value !== result.value) state.value.dispose();
    if (state.error && typeof state.error.dispose === 'function') state.error.dispose();
    result.value.dispose();
  }
  // Promises/timers are not the execution API. Never silently omit pending jobs.
  if (vm.runtime.hasPendingJob()) failed = true;
  parentPort.postMessage(failed ? {type:'failed'} : {type:'done', output});
} catch {
  parentPort.postMessage({type:'failed'});
} finally {
  vm.dispose();
  parentPort.close();
}
