import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { offerApplicationMove } = createRequire(import.meta.url)('../src/mac-install.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'router-install-test-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
let nextFixture = 0;
function fixture({ platform = 'darwin', packaged = true, installed = false, response = 0, checkboxChecked = false, userData = path.join(temp, String(nextFixture++)), move = () => true } = {}) {
  const messages = [], errors = [];
  let moves = 0;
  return {
    messages, errors, userData, get moves() { return moves; },
    options: {
      platform,
      app: { isPackaged: packaged, getPath: () => userData, isInApplicationsFolder: () => installed,
        moveToApplicationsFolder: options => { moves++; return move(options); } },
      dialog: { showMessageBox: async options => { messages.push(options); return { response, checkboxChecked }; },
        showErrorBox: (...args) => errors.push(args) },
    },
  };
}

test('only packaged Macs outside Applications prompt', async () => {
  for (const options of [{ platform: 'win32' }, { platform: 'linux' }, { packaged: false }, { installed: true }]) {
    const f = fixture(options);
    assert.equal(await offerApplicationMove(f.options), false);
    assert.equal(f.messages.length, 0);
    assert.equal(f.moves, 0);
  }
});

test('Don’t ask again persists across launches without moving the app', async () => {
  const first = fixture({ response: 1, checkboxChecked: true });
  assert.equal(await offerApplicationMove(first.options), false);
  assert.equal(first.moves, 0);
  const next = fixture({ userData: first.userData });
  assert.equal(await offerApplicationMove(next.options), false);
  assert.equal(next.messages.length, 0);
  assert.equal(next.moves, 0);
});

test('Not Now without the checkbox prompts again next launch', async () => {
  const first = fixture({ response: 1 });
  await offerApplicationMove(first.options);
  const next = fixture({ response: 1, userData: first.userData });
  await offerApplicationMove(next.options);
  assert.equal(next.messages.length, 1);
});

test('unreadable preferences and failed preference writes do not block startup', async () => {
  const f = fixture({ response: 1, checkboxChecked: true });
  fs.writeFileSync(f.userData, 'not a directory');
  assert.equal(await offerApplicationMove(f.options), false);
  assert.equal(f.messages.length, 1);
  assert.equal(f.errors.length, 1);
  assert.equal(f.moves, 0);
});

test('Not Now and dialog cancellation continue startup without moving', async () => {
  for (const response of [1, -1]) {
    const f = fixture({ response });
    assert.equal(await offerApplicationMove(f.options), false);
    assert.equal(f.moves, 0);
    assert.equal(f.messages[0].cancelId, 1);
  }
});

test('successful relocation stops startup while Electron relaunches', async () => {
  const f = fixture();
  assert.equal(await offerApplicationMove(f.options), true);
  assert.equal(f.moves, 1);
});

test('existing installations are never replaced, including running copies', async () => {
  for (const conflictType of ['exists', 'existsAndRunning']) {
    const f = fixture({ move: ({ conflictHandler }) => {
      assert.equal(conflictHandler(conflictType), false);
      return false;
    } });
    assert.equal(await offerApplicationMove(f.options), false);
    assert.equal(f.messages.length, 2);
    assert.equal(f.errors.length, 0);
  }
});

test('cancelled authorization and failed moves allow startup; errors stay private', async () => {
  const cancelled = fixture({ move: () => false });
  assert.equal(await offerApplicationMove(cancelled.options), false);
  assert.equal(cancelled.errors.length, 0);
  const failed = fixture({ move: () => { throw new Error('private path'); } });
  assert.equal(await offerApplicationMove(failed.options), false);
  assert.equal(failed.errors.length, 1);
  assert.ok(!JSON.stringify(failed.errors).includes('private path'));
});
