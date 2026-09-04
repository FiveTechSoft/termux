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

// Mock fflate for test environment (no network CDN)
const fflateCode = `
  const fflate = {
    gunzipSync(u8) {
      // Simple gzip decompression for test: just return the raw data
      // In production, fflate is loaded from CDN
      return u8;
    }
  };
`;
vm.runInContext(fflateCode, context);
context.fflate = context.fflate || { gunzipSync: (u8) => u8 };

load('js/fs.js');
load('js/archive.js');
load('js/pkg.js');
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
// pkg uses TermuxPkg module — mock it for offline tests
// In production, pkg fetches from real Termux repositories
const mockPkgs = {
  opencode: { version: '1.2.21', description: 'OpenCode AI coding agent', depends: '', filename: 'https://packages.termux.dev/pool/main/o/opencode/opencode_1.2.21_aarch64.deb' },
  mc: { version: '4.8.31', description: 'Midnight Commander file manager', depends: 'glib, ncurses', filename: 'https://packages.termux.dev/pool/main/m/mc/mc_4.8.31_aarch64.deb' },
  bash: { version: '5.2.37', description: 'GNU Bourne Again SHell', depends: '', filename: 'https://packages.termux.dev/pool/main/b/bash/bash_5.2.37_aarch64.deb' }
};
// Mock TermuxPkg for offline tests
context.TermuxPkg = {
  getSources: async () => [{ url: 'https://packages.termux.dev/apt/termux-main', dist: 'stable', components: 'main' }],
  fetchPackageList: async () => mockPkgs,
  search: async (q) => Object.entries(mockPkgs).filter(([n,p]) => !q || n.includes(q) || p.description.toLowerCase().includes(q.toLowerCase())).map(([n,p]) => ({ name: n, version: p.version, description: p.description })),
  show: async (name) => { const p = mockPkgs[name]; return p ? { name, ...p, installed: false } : null; },
  install: async (names) => {
    const installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    const output = ['Reading package lists... Done', 'Building dependency tree... Done'];
    for (const n of names) {
      if (!mockPkgs[n]) { return { ok: false, output: 'E: Unable to locate package ' + n }; }
      if (!installed.includes(n)) installed.push(n);
      output.push('Setting up ' + n + ' (' + mockPkgs[n].version + ') ...');
    }
    localStorage.setItem('termux-pkg-installed', JSON.stringify(installed));
    output.push(names.length + ' newly installed.');
    return { ok: true, output: output.join('\n'), installed: names };
  },
  remove: async (names) => {
    let installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    const output = [];
    for (const n of names) {
      installed = installed.filter(p => p !== n);
      output.push('Removing ' + n + ' ...');
    }
    localStorage.setItem('termux-pkg-installed', JSON.stringify(installed));
    output.push('Done.');
    return { ok: true, output: output.join('\n'), removed: names };
  },
  listInstalled: async () => {
    const installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    return installed.map(name => ({ name, version: mockPkgs[name]?.version || 'unknown', installed: true }));
  },
  getInstalled: () => JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]'),
  isInstalled: (name) => JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]').includes(name),
  parseDependencyList: (s) => {
    if (!s) return [];
    return s.split(',').map(d => ({ name: d.trim().split(/\s/)[0], constraint: null, version: null }));
  },
  compareVersions: (a, b) => a.localeCompare(b),
  DEFAULT_SOURCES: ['deb https://packages.termux.dev/apt/termux-main stable main'],
  PREFIX: '/data/data/com.termux/files/usr',
  DB_KEY: 'termux-pkg-installed'
};
assertIncludes(await sh('pkg search opencode'), 'opencode', 'pkg search opencode');
assertIncludes(await sh('pkg install opencode'), 'Setting up opencode', 'pkg install opencode');
assertIncludes(await sh('pkg list'), 'opencode', 'pkg list shows opencode');
assertIncludes(await sh('which opencode'), 'opencode', 'which opencode');
assertIncludes(await sh('pkg install mc'), 'Setting up mc', 'pkg install mc (real package)');
assertIncludes(await sh('pkg show mc'), 'Midnight Commander', 'pkg show mc');
assertIncludes(await sh('pkg search mc'), 'mc', 'pkg search mc');
assertIncludes(await sh('pkg sources'), 'packages.termux.dev', 'pkg sources shows repos');

console.log('\n[curl install]');
assertIncludes(await sh('curl -fsSL https://opencode.ai/install'), 'pkg install opencode', 'curl install script intercept');
assertIncludes(await sh('curl -fsSL https://opencode.ai/install | bash'), 'OpenCode', 'curl | bash installs');

console.log('\n[opencode cli]');
assertIncludes(await sh('opencode --version'), 'opencode 1.2.22', 'opencode --version');
assertIncludes(await sh('opencode --help'), 'opencode run', 'opencode --help');
assertIncludes(await sh('opencode --help'), 'auth login', 'help lists auth');
assertIncludes(await sh('opencode models'), 'laguna-s-2.1-free', 'opencode models');
assertIncludes(await sh('opencode models'), 'nemotron-3.5-lightning-free', 'opencode models lists lightning');
assertEq(context.TermuxOpenCode.FREE_MODELS[0], 'nemotron-3.5-lightning-free', 'default free model is lightning');
assertIncludes(await sh('opencode agent list'), 'build', 'opencode agent list');
assertIncludes(await sh('opencode auth list'), 'public', 'opencode auth list');
assertIncludes(await sh('opencode session list'), 'no sessions', 'opencode session list empty');
assertEq(context.TermuxOpenCode.getConfig().apiKey, 'public', 'default key is public');
assertIncludes(context.TermuxOpenCode.getConfig().endpoint || '', 'api.fivetechsupport.com', 'uses FiveTech support Zen proxy');

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

console.log('\n[opencode fallback]');
context.TermuxOpenCode.saveConfig({
  installed: true,
  provider: 'opencode',
  model: 'laguna-s-2.1-free',
  apiKey: 'test-key',
  fallback: true,
  endpoint: 'https://example.test/zen/v1'
});
const tried = [];
const fallbackOut = [];
fetchImpl = async (_url, opts) => {
  const body = JSON.parse(opts.body);
  tried.push(body.model);
  if (body.model !== 'nemotron-3.5-lightning-free') {
    return new Response(JSON.stringify({
      type: 'error',
      error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded. Please try again later.' }
    }), { status: 429 });
  }
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'pong-from-lightning' } }]
  }));
};
const fb = await context.TermuxOpenCode.runAgent('hi', {
  write: (s) => fallbackOut.push(String(s)),
  writeln: (s) => fallbackOut.push(String(s) + '\n')
});
assert(tried[0] === 'laguna-s-2.1-free', 'tries selected model first');
assert(tried.includes('nemotron-3.5-lightning-free'), 'falls back to lightning');
assert(tried.indexOf('nemotron-3.5-lightning-free') < (tried.includes('mimo-v2.5-free') ? tried.indexOf('mimo-v2.5-free') : 99), 'lightning before mimo');
assertIncludes(fb.content || fallbackOut.join(''), 'pong-from-lightning', 'lightning answer is used');
assertEq(context.TermuxOpenCode.getConfig().model, 'nemotron-3.5-lightning-free', 'remembers working fallback model');
assert(!fallbackOut.join('').includes('FreeUsageLimitError'), 'does not dump raw 429 JSON');

console.log('\n[opencode endpoint fallback]');
context.TermuxOpenCode.saveConfig({
  installed: true,
  provider: 'opencode',
  model: 'laguna-s-2.1-free',
  apiKey: 'test-key',
  fallback: true,
  endpoint: 'https://api.fivetechsoft.com/zen/v1'
});
const hosts = [];
fetchImpl = async (url, opts) => {
  const body = JSON.parse(opts.body);
  hosts.push((url || '') + ' ' + body.model);
  if (String(url).includes('fivetechsupport.com') && body.model === 'laguna-s-2.1-free') {
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'pong-from-phoenix' } }]
    }));
  }
  return new Response(JSON.stringify({
    type: 'error',
    error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded' }
  }), { status: 429 });
};
const epOut = [];
const ep = await context.TermuxOpenCode.runAgent('hi', {
  write: (s) => epOut.push(String(s)),
  writeln: (s) => epOut.push(String(s) + '\n')
});
assert(hosts.some(h => h.includes('fivetechsupport.com')), 'prefers Phoenix api.fivetechsupport.com');
assertIncludes(ep.content || epOut.join(''), 'pong-from-phoenix', 'Phoenix proxy answer is used');
assertEq(context.TermuxOpenCode.getConfig().endpoint, 'https://api.fivetechsupport.com/zen/v1', 'remembers working Zen proxy');

console.log('\n[tui width]');
assertEq(context.TermuxOpenCode.visWidth('hola'), 4, 'visWidth ascii');
assertEq(context.TermuxOpenCode.visWidth('😀'), 2, 'visWidth emoji is 2 columns');
assertEq(context.TermuxOpenCode.visWidth(context.TermuxOpenCode.fit('navegador extra 😀 largo', 16)), 16, 'fit pads/truncates to display columns');
const wrapped = context.TermuxOpenCode.wrap('Soy OpenCode en el navegador', 12);
assert(wrapped.every(l => context.TermuxOpenCode.visWidth(l) <= 12), 'wrap does not exceed column width');
assert(wrapped.some(l => l.includes('nave')) && wrapped.some(l => l.includes('gador') || l.includes('ador')), 'wrap keeps syllables instead of spilling into the sidebar');
assertEq(context.TermuxOpenCode.visWidth(context.TermuxOpenCode.sideFit('hola', 10)), 10, 'sidebar cells are a full-width painted column');
assertIncludes(context.TermuxOpenCode.sideFit('hola', 10), '[48;5;240m', 'sidebar uses a background paint');
assert(!context.TermuxOpenCode.mdAnsi('**Leer, crear y editar archivos**').includes('**'), 'markdown ** is rendered, not shown raw');
assertIncludes(context.TermuxOpenCode.mdAnsi('**Leer**'), 'Leer', 'markdown bold keeps the words');
assert(!context.TermuxOpenCode.mdAnsi('  -  **Ejecutar comandos de shell**').includes('**'), 'list markdown ** is stripped');

console.log('\n[opencode TUI]');
fetchImpl = async () => new Response('nope', { status: 500 });
context.localStorage.setItem('termux-opencode-tui', JSON.stringify({
  theme: 'opencode', details: true, thinking: true, sidebar: true, sidebarChosen: true
}));
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

console.log('\n[opencode no duplicate stream]');
fetchImpl = async () => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: 'Hola unico', reasoning_content: 'user said hola' } }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
const dupChunks = [];
const dup = context.TermuxOpenCode.start({
  write: (s) => dupChunks.push(String(s)),
  writeln: (s) => dupChunks.push(String(s) + '\n'),
  cols: 100,
  rows: 28
});
for (const ch of 'hola') dup.onData(ch);
dup.onData('\r');
const waitDup = Date.now();
while (Date.now() - waitDup < 4000 && !dupChunks.join('').includes('Hola unico')) {
  await new Promise(r => setTimeout(r, 50));
}
const frames = dupChunks.join('').split('\x1b[H');
let nHello = 0, nThink = 0;
for (const f of frames) {
  nHello = Math.max(nHello, f.split('Hola unico').length - 1);
  nThink = Math.max(nThink, f.split('user said hola').length - 1);
}
dup.onData('\x03');
dup.onData('\x03');
await dup.done;
assert(nHello === 1, 'assistant reply appears once per frame (got ' + nHello + ')');
assert(nThink <= 1, 'thinking block appears at most once per frame (got ' + nThink + ')');
const collapsed = context.TermuxOpenCode.collapseTurnLog([
  { kind: 'user', text: 'hola' },
  { kind: 'think', text: 'a' },
  { kind: 'assistant', text: 'hi' },
  { kind: 'think', text: 'abc' },
  { kind: 'assistant', text: 'hello there' }
]);
assertEq(collapsed.filter(x => x.kind === 'think').length, 1, 'collapseTurnLog keeps one think');
assertEq(collapsed.filter(x => x.kind === 'assistant').length, 1, 'collapseTurnLog keeps one assistant');
assertEq(collapsed.find(x => x.kind === 'assistant').text, 'hello there', 'collapseTurnLog keeps the longest assistant');

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
  model: 'nemotron-3.5-lightning-free',
  apiKey: 'public',
  endpoint: 'https://api.fivetechsupport.com/zen/v1',
  fallback: true
});
const live = await sh('opencode run "Reply with exactly: pong"');
assert(!/All models failed/i.test(live), 'live zen proxy did not exhaust fallbacks');
assertIncludes(live.toLowerCase(), 'pong', 'live opencode run via FiveTech Zen proxy');

console.log('\n[static site]');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assertIncludes(index, 'js/opencode.js', 'index loads opencode.js');
assertIncludes(index, 'js/shell.js', 'index loads shell.js');
assert(!fs.existsSync(path.join(root, '_config.yml')), 'not a jekyll copy of termux.github.io');

const appJs = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
assertIncludes(appJs, "code === 'opencode'", 'OC extra-key launches opencode from the shell');
assertIncludes(appJs, 'if (fgApp) return', 'OC extra-key is a no-op if OpenCode is already foreground');
assert(!appJs.includes('setOcKeyVisible'), 'OC extra-key stays visible while OpenCode is open');
assertIncludes(appJs, 'function isOpenCodeSnapshot', 'does not restore a stale OpenCode TUI screenshot');
assertIncludes(appJs, 'resetVisibleScreen()', 'leaving OpenCode clears the screen before saving');
assertIncludes(appJs, 'function resetVisibleScreen', 'clear rebuilds the visible screen');
assertIncludes(appJs, '\\x1b[3J', 'clear wipes xterm scrollback so localStorage is the new screen');
assertIncludes(appJs, 'term.write(getPromptStr(), () => saveDisplayBuffer())', 'clear saves the new prompt to localStorage');
assert(!/output === '\\x1b\[2J\\x1b\[H'\) \{\s*clearDisplayBuffer/s.test(appJs), 'clear does not delete the display-buffer key');

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:\n' + failed.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
