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
  const applicationsDirectory = path.join(temp, 'Applications-' + nextFixture++);
  const messages = [], errors = [];
  let moves = 0;
  return {
    messages, errors, userData, applicationsDirectory, get moves() { return moves; },
    options: {
      platform, applicationsDirectory,
      app: { isPackaged: packaged, getVersion: () => '0.9.1', getPath: name => name === 'exe' ? '/Downloads/MCP Router.app/Contents/MacOS/MCP Router' : userData, isInApplicationsFolder: () => installed,
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

function install(f, version = '0.9.0') {
  const folder = path.join(f.applicationsDirectory, 'MCP Router.app/Contents/Resources/app');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'mcp-router', version }));
}

test('replacement shows both versions and explicitly authorizes native replacement', async () => {
  for (const version of ['0.9.0', '0.9.1', '0.10.0']) {
    const f = fixture({ move: ({ conflictHandler }) => conflictHandler('exists') });
    install(f, version);
    assert.equal(await offerApplicationMove(f.options), true);
    assert.match(f.messages[0].detail, new RegExp(`Installed version: ${version}`));
    assert.match(f.messages[0].detail, /This copy: 0.9.1/);
    assert.equal(f.messages[0].buttons[0], 'Replace and Relaunch');
    assert.equal(f.messages[0].defaultId, 1);
    assert.equal(f.messages[0].checkboxLabel, undefined);
  }
});

test('declining replacement leaves the installed app untouched', async () => {
  const f = fixture({ response: 1 }); install(f);
  assert.equal(await offerApplicationMove(f.options), false);
  assert.equal(f.moves, 0);
});

test('a running installed copy is never silently focused instead of replaced', async () => {
  const f = fixture({ move: ({ conflictHandler }) => {
    assert.equal(conflictHandler('existsAndRunning'), false); return false;
  } }); install(f);
  assert.equal(await offerApplicationMove(f.options), false);
  assert.match(f.messages[1].message, /Quit the installed app/);
});

test('unknown or changed installations are not replaced', async () => {
  const unknown = fixture(); install(unknown, 'invalid');
  assert.equal(await offerApplicationMove(unknown.options), false);
  assert.equal(unknown.moves, 0);
  const changed = fixture(); install(changed);
  changed.options.dialog.showMessageBox = async () => {
    install(changed, '0.10.0'); return { response: 0 };
  };
  assert.equal(await offerApplicationMove(changed.options), false);
  assert.equal(changed.moves, 0);
  const appeared = fixture({ move: ({ conflictHandler }) => {
    install(appeared); assert.equal(conflictHandler('exists'), false); return false;
  } });
  assert.equal(await offerApplicationMove(appeared.options), false);
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
