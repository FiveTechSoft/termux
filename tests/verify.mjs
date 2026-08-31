#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const failed = [];
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok  ' + msg);
  } else {
    failed.push(msg);
    console.log('  FAIL  ' + msg);
  }
}

function assertEq(a, b, msg) {
  const as = String(a).trim();
  const bs = String(b).trim();
  assert(as === bs, msg + (as === bs ? '' : ' (got ' + JSON.stringify(as).slice(0, 180) + ')'));
}

function assertIncludes(hay, needle, msg) {
  assert(String(hay).includes(needle), msg + (String(hay).includes(needle) ? '' : ' (got ' + JSON.stringify(String(hay).slice(0, 220)) + ')'));
}

const store = {};
const localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

let fetchImpl = globalThis.fetch.bind(globalThis);

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  localStorage,
  JSON, Object, Array, String, Number, Boolean, Date, Math, Error, TypeError,
  SyntaxError, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN,
  Infinity, NaN, encodeURIComponent, decodeURIComponent, Uint8Array,
  Function, Symbol, URL, Headers, Response, TextEncoder, TextDecoder,
  crypto: globalThis.crypto,
  fetch: (...args) => fetchImpl(...args),
  window: null,
  location: { href: 'http://127.0.0.1:8765/index.html' }
});
context.window = context;
context.globalThis = context;
context.self = context;

function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
}

load('js/fs.js');
load('js/shell.js');
load('js/opencode.js');

await context.TermuxFS.fsInit();
context.TermuxShell.init();

const sh = (cmd) => context.TermuxShell.shRun(cmd);

console.log('\n[shell]');
assertEq(await sh('pwd'), '/data/data/com.termux/files/home', 'pwd is termux home');
assertEq(await sh('whoami'), 'user1', 'whoami');
assertEq(await sh('echo hello'), 'hello', 'echo');
assertEq(await sh('mkdir -p project/src && touch project/src/app.js && ls project/src'), 'app.js', 'mkdir/touch/ls');
assertEq(await sh('write project/src/app.js console.log(1) && cat project/src/app.js'), 'console.log(1)', 'write/cat');
assertIncludes(await sh('echo a b c | wc'), '1', 'pipe to wc');
assertEq(await sh('echo hi > /tmp/x.txt && cat /tmp/x.txt'), 'hi', 'redirect >');
assertIncludes(await sh('uname -a'), 'Linux', 'uname -a');
assertIncludes(await sh('help'), 'opencode', 'help lists opencode');

console.log('\n[pkg]');
assertIncludes(await sh('pkg search opencode'), 'OpenCode', 'pkg search opencode');
assertIncludes(await sh('pkg install opencode'), 'Setting up opencode', 'pkg install opencode');
assertIncludes(await sh('pkg list'), 'opencode', 'pkg list shows opencode');
assertIncludes(await sh('which opencode'), 'opencode', 'which opencode');

console.log('\n[curl install]');
assertIncludes(await sh('curl -fsSL https://opencode.ai/install'), 'pkg install opencode', 'curl install script intercept');
assertIncludes(await sh('curl -fsSL https://opencode.ai/install | bash'), 'OpenCode', 'curl | bash installs');

console.log('\n[opencode cli]');
assertIncludes(await sh('opencode --version'), 'opencode 1.2.0', 'opencode --version');
assertIncludes(await sh('opencode --help'), 'opencode run', 'opencode --help');
assertIncludes(await sh('opencode --help'), 'auth login', 'help lists auth');
assertIncludes(await sh('opencode models'), 'laguna-s-2.1-free', 'opencode models');
assertIncludes(await sh('opencode agent list'), 'build', 'opencode agent list');
assertIncludes(await sh('opencode auth list'), 'public', 'opencode auth list');
assertIncludes(await sh('opencode session list'), 'no sessions', 'opencode session list empty');
assertEq(context.TermuxOpenCode.getConfig().apiKey, 'public', 'default key is public');
assertIncludes(context.TermuxOpenCode.getConfig().endpoint || '', 'api.fivetechsoft.com', 'uses FiveTech Zen proxy');

console.log('\n[opencode tools]');
const writeRes = await context.TermuxOpenCode.executeTool('write', {
  path: 'hello.py',
  content: 'print("hi")\n'
});
assertIncludes(writeRes, 'hello.py', 'tool write');
assertEq(await sh('cat hello.py'), 'print("hi")', 'written file readable');
const editRes = await context.TermuxOpenCode.executeTool('edit', {
  path: 'hello.py',
  old_string: 'hi',
  new_string: 'hello'
});
assertIncludes(editRes, 'Edited', 'tool edit');
assertEq(await sh('cat hello.py'), 'print("hello")', 'edit applied');
const lsRes = await context.TermuxOpenCode.executeTool('bash', { command: 'ls' });
assertIncludes(lsRes, 'hello.py', 'tool bash ls');
const globRes = await context.TermuxOpenCode.executeTool('glob', { pattern: '**/*.py' });
assertIncludes(globRes, 'hello.py', 'tool glob');
const grepRes = await context.TermuxOpenCode.executeTool('grep', { pattern: 'print' });
assertIncludes(grepRes, 'hello.py', 'tool grep');
const patchRes = await context.TermuxOpenCode.executeTool('apply_patch', {
  patchText: '*** Add File: patched.txt\nhello patch\n'
});
assertIncludes(patchRes, 'patched.txt', 'tool apply_patch add');
assertEq(await sh('cat patched.txt'), 'hello patch', 'apply_patch wrote file');
const todoRes = await context.TermuxOpenCode.executeTool('todowrite', {
  todos: [{ id: '1', content: 'ship it', status: 'in_progress' }]
});
assertIncludes(todoRes, 'ship it', 'tool todowrite');
const planDeny = await context.TermuxOpenCode.executeTool('write', { path: 'secret.py', content: 'x' }, { agent: 'plan' });
assertIncludes(planDeny, 'Permission denied', 'plan agent denies writes');

console.log('\n[opencode agent with mock API]');
context.TermuxOpenCode.saveConfig({
  installed: true,
  provider: 'opencode',
  model: 'mimo-v2.5-free',
  apiKey: 'test-key',
  fallback: false
});

let round = 0;
fetchImpl = async (url, opts) => {
  assert(String(url).includes('/chat/completions'), 'agent posts to chat/completions');
  const body = JSON.parse(opts.body);
  assert(body.model === 'mimo-v2.5-free', 'uses zen free model');
  assert(Array.isArray(body.messages), 'sends messages');
  round++;
  if (round === 1) {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write',
              arguments: JSON.stringify({
                path: 'note.txt',
                content: 'created by opencode'
              })
            }
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    choices: [{
      message: { role: 'assistant', content: 'Created note.txt with a short message.' }
    }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const agentOut = await sh('opencode run "create note.txt"');
assertIncludes(agentOut, 'note.txt', 'agent output mentions file');
assertEq(await sh('cat note.txt'), 'created by opencode', 'agent actually wrote the file');

console.log('\n[opencode TUI]');
fetchImpl = async () => new Response('nope', { status: 500 });
const chunks = [];
const session = context.TermuxOpenCode.start({
  write: (s) => chunks.push(String(s)),
  writeln: (s) => chunks.push(String(s) + '\n')
});
session.onData('/');
await new Promise(r => setTimeout(r, 10));
const slashOpen = chunks.join('');
assertIncludes(slashOpen, '/connect', 'typing / lists slash commands');
assertIncludes(slashOpen, '/models', 'typing / lists /models');
for (const ch of 'he') session.onData(ch);
await new Promise(r => setTimeout(r, 10));
const slashFilt = chunks.slice(-5).join('');
assertIncludes(chunks.join(''), '/help', 'typing /he still shows /help');
session.onData('\x03');
session.onData('\x03');
await session.done;
const tui = chunks.join('');
assertIncludes(tui, 'OpenCode', 'TUI banner');
assertIncludes(tui, '/connect', 'TUI help has /connect');
assertIncludes(tui, 'Context', 'right sidebar Context');
assertIncludes(tui, 'LSPs are disabled', 'right sidebar LSP');
assertIncludes(tui, 'Todo', 'right sidebar Todo');
assertIncludes(tui, 'ses_', 'right sidebar session id');

console.log('\n[opencode /models picker]');
const pickChunks = [];
const picker = context.TermuxOpenCode.start({
  write: (s) => pickChunks.push(String(s)),
  writeln: (s) => pickChunks.push(String(s) + '\n'),
  cols: 80,
  rows: 24
});
for (const ch of '/models') picker.onData(ch);
picker.onData('\r');
await new Promise(r => setTimeout(r, 80));
assertEq(picker.getOverlayTitle(), 'Models', 'models overlay opens');
assertIncludes(picker.getBuf(), '/models', 'prompt shows /models while overlay is open');
picker.onData('\r');
assertEq(picker.getBuf(), '', 'prompt cleared after picking a model');
assertEq(picker.getOverlayTitle() || '', '', 'models overlay closed');
picker.onData('\x03');
picker.onData('\x03');
await picker.done;

const escPicker = context.TermuxOpenCode.start({
  write: () => {},
  writeln: () => {},
  cols: 80,
  rows: 24
});
for (const ch of '/models') escPicker.onData(ch);
escPicker.onData('\r');
await new Promise(r => setTimeout(r, 80));
escPicker.onData('\x1b');
assertEq(escPicker.getBuf(), '', 'escape clears prompt after /models overlay');
for (const ch of 'hello') escPicker.onData(ch);
assertEq(escPicker.getBuf(), 'hello', 'can type after escape');
escPicker.onData('\x1b');
escPicker.onData('\x1b');
assertEq(escPicker.getBuf(), '', 'double escape clears prompt');
escPicker.onData('\x03');
escPicker.onData('\x03');
await escPicker.done;

console.log('\n[live zen proxy]');
fetchImpl = globalThis.fetch.bind(globalThis);
context.TermuxOpenCode.saveConfig({
  installed: true,
  provider: 'opencode',
  model: 'laguna-s-2.1-free',
  apiKey: 'public',
  endpoint: 'https://api.fivetechsoft.com/zen/v1',
  fallback: true
});
const live = await sh('opencode run "Reply with exactly: pong"');
assertIncludes(live.toLowerCase(), 'pong', 'live opencode run via FiveTech Zen proxy');

console.log('\n[static site]');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assertIncludes(index, 'js/opencode.js', 'index loads opencode.js');
assertIncludes(index, 'js/shell.js', 'index loads shell.js');
assert(!fs.existsSync(path.join(root, '_config.yml')), 'not a jekyll copy of termux.github.io');

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:\n' + failed.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
