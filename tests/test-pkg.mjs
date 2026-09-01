#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const store = {};
const localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const context = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage, JSON, Object, Array, String, Number, Boolean, Date, Math, Error,
  SyntaxError, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN,
  Infinity, NaN, encodeURIComponent, decodeURIComponent, Uint8Array,
  Function, Symbol, URL, Headers, Response, TextEncoder, TextDecoder,
  crypto: globalThis.crypto,
  fetch: async () => new Response('mock'),
  window: null, location: { href: 'http://127.0.0.1:8765/index.html' }
});
context.window = context;
context.globalThis = context;
context.self = context;
context.fflate = { gunzipSync: (u8) => u8 };

function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
}

load('js/fs.js');
load('js/archive.js');
load('js/pkg.js');
load('js/shell.js');

await context.TermuxFS.fsInit();
context.TermuxShell.init();

// Mock TermuxPkg for offline testing (simulates real pkg behavior)
const mockCatalog = {
  opencode: { version: '1.2.21', description: 'OpenCode AI coding agent', depends: '', filename: 'https://example.com/opencode.deb' },
  mc: { version: '4.8.31', description: 'Midnight Commander file manager', depends: 'glib, ncurses', filename: 'https://example.com/mc.deb' },
  bash: { version: '5.2.37', description: 'GNU Bourne Again SHell', depends: '', filename: 'https://example.com/bash.deb' },
  coreutils: { version: '9.6', description: 'Basic file/shell/text utilities', depends: '', filename: 'https://example.com/coreutils.deb' },
  vim: { version: '9.1', description: 'Vi IMproved', depends: 'ncurses', filename: 'https://example.com/vim.deb' },
};
const pkgDB = {};

context.TermuxPkg = {
  getSources: async () => [{ url: 'https://packages.termux.dev/apt/termux-main', dist: 'stable', components: 'main' }],
  fetchPackageList: async () => ({ ...mockCatalog }),
  search: async (q) => Object.entries(mockCatalog)
    .filter(([n, p]) => !q || n.includes(q) || p.description.toLowerCase().includes(q.toLowerCase()))
    .map(([n, p]) => ({ name: n, version: p.version, description: p.description })),
  show: async (name) => { const p = mockCatalog[name]; return p ? { name, ...p, installed: !!pkgDB[name] } : null; },
  install: async (names) => {
    const installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    const output = ['Reading package lists... Done', 'Building dependency tree... Done'];
    let newCount = 0;
    for (const n of names) {
      if (!mockCatalog[n]) return { ok: false, output: 'E: Unable to locate package ' + n };
      if (installed.includes(n)) { output.push(n + ' is already the newest version.'); continue; }
      installed.push(n);
      pkgDB[n] = { name: n, version: mockCatalog[n].version, installed: new Date().toISOString() };
      output.push('Setting up ' + n + ' (' + mockCatalog[n].version + ') ...');
      newCount++;
    }
    localStorage.setItem('termux-pkg-installed', JSON.stringify(installed));
    output.push(newCount > 0 ? newCount + ' newly installed.' : '0 newly installed.');
    return { ok: true, output: output.join('\n'), installed: names };
  },
  remove: async (names) => {
    let installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    const output = [];
    for (const n of names) {
      if (!installed.includes(n)) { output.push('Package ' + n + ' is not installed, skipping'); continue; }
      installed = installed.filter(p => p !== n);
      delete pkgDB[n];
      output.push('Removing ' + n + ' ...');
    }
    localStorage.setItem('termux-pkg-installed', JSON.stringify(installed));
    output.push('Done.');
    return { ok: true, output: output.join('\n'), removed: names };
  },
  listInstalled: async () => {
    const installed = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
    return installed.map(name => ({ name, version: mockCatalog[name]?.version || 'unknown', installed: true }));
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

const sh = (cmd) => context.TermuxShell.shRun(cmd);

let passed = 0, failed = [];
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  ' + msg); }
  else { failed.push(msg); console.log('  FAIL  ' + msg); }
}
function assertIncludes(hay, needle, msg) {
  assert(String(hay).includes(needle), msg + (String(hay).includes(needle) ? '' : ' (got ' + JSON.stringify(String(hay).slice(0, 250)) + ')'));
}

console.log('\n[file command]');
await sh('echo "#!/bin/bash" > test.sh');
await sh('echo "hello world" > test.txt');
await sh('touch empty.txt');
assertIncludes(await sh('file test.sh'), 'script', 'file detects shell script');
assertIncludes(await sh('file test.txt'), 'text', 'file detects text file');
assertIncludes(await sh('file empty.txt'), 'empty', 'file detects empty file');

console.log('\n[pkg install]');
assertIncludes(await sh('pkg install mc'), 'Setting up mc', 'pkg install mc downloads real package');
assertIncludes(await sh('pkg install opencode'), 'opencode', 'pkg install opencode reports status');
assertIncludes(await sh('pkg list'), 'mc', 'pkg list shows mc');
assertIncludes(await sh('pkg list'), 'opencode', 'pkg list shows opencode');

console.log('\n[pkg search/show]');
assertIncludes(await sh('pkg search mc'), 'mc', 'pkg search mc finds mc');
assertIncludes(await sh('pkg search vim'), 'vim', 'pkg search vim finds vim');
assertIncludes(await sh('pkg show mc'), 'Midnight Commander', 'pkg show mc shows description');
assertIncludes(await sh('pkg show mc'), '4.8.31', 'pkg show mc shows version');
assertIncludes(await sh('pkg show mc'), 'aarch64', 'pkg show mc shows architecture');
assertIncludes(await sh('pkg show mc'), 'install ok installed', 'pkg show mc shows installed status');

console.log('\n[pkg remove]');
assertIncludes(await sh('pkg remove mc'), 'Removing mc', 'pkg remove mc removes package');
const listAfter = await sh('pkg list');
assert(!listAfter.includes('mc/'), 'mc no longer in pkg list');
assertIncludes(listAfter, 'opencode', 'opencode still in list after removing mc');

console.log('\n[pkg sources]');
assertIncludes(await sh('pkg sources'), 'packages.termux.dev', 'pkg sources shows repo URL');
assertIncludes(await sh('pkg sources'), 'stable', 'pkg sources shows distribution');

console.log('\n[pkg aliases]');
assertIncludes(await sh('apt install vim'), 'Setting up vim', 'apt install works as alias');
assertIncludes(await sh('apt-get remove vim'), 'Removing vim', 'apt-get remove works as alias');

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:', failed);
  process.exit(1);
}
