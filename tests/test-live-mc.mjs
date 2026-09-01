#!/usr/bin/env node
/**
 * Live test: pkg install mc — uses Node.js ReadableStream for xz decompression
 * Tests the full pipeline with real Termux repository access
 */
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { ReadableStream } from 'node:stream/web';
import { blob } from 'node:stream/consumers';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ---- Simulated browser localStorage ----
const memStore = new Map();
const localStorage = {
  getItem: (k) => memStore.get(k) || null,
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k)
};

const context = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage, JSON, Object, Array, String, Number, Boolean, Date, Math, Error,
  SyntaxError, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN,
  Infinity, NaN, encodeURIComponent, decodeURIComponent, Uint8Array, ArrayBuffer,
  Function, Symbol, URL, Headers, Response, TextEncoder, TextDecoder,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch.bind(globalThis),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  window: null,
  location: { href: 'http://localhost:8080/index.html' },
  ReadableStream
});
context.window = context;
context.globalThis = context;
context.self = context;

function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
}

// Load fflate
console.log('[setup] Loading fflate...');
const fflateCode = await fetch('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js').then(r => r.text());
vm.runInContext(fflateCode, context);

// Load xz-decompress ESM and expose XzReadableStream
console.log('[setup] Loading xz-decompress...');
try {
  const xzUrl = pathToFileURL(path.join(root, 'js', '_xz-decompress.mjs')).href;
  const xzMod = await import(xzUrl);
  const XzReadableStreamHost = xzMod.default?.XzReadableStream || xzMod.XzReadableStream;
  console.log('[setup] xz-decompress loaded OK, XzReadableStream:', typeof XzReadableStreamHost);

  // Provide xz decompression from the host realm (vm context can't use XzReadableStream
  // directly because it captures host-scope ReadableStream references that don't work
  // when called from inside a vm context).
  context._xzDecompressOverride = async (u8) => {
    const stream = new Response(u8).body;
    const decompressed = new XzReadableStreamHost(stream);
    const reader = decompressed.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  };
} catch (e) {
  console.error('[setup] xz-decompress FAILED:', e.message);
  process.exit(1);
}

console.log('[setup] Loading modules...');
load('js/fs.js');
load('js/archive.js');
load('js/pkg.js');
load('js/shell.js');

console.log('[setup] Initializing filesystem...');
await context.TermuxFS.fsInit();
context.TermuxShell.init();

const sh = (cmd) => context.TermuxShell.shRun(cmd);
const PREFIX = '/data/data/com.termux/files/usr';

let passed = 0, failed = [];
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  ' + msg); }
  else { failed.push(msg); console.log('  FAIL  ' + msg); }
}
function assertIncludes(hay, needle, msg) {
  assert(String(hay).includes(needle), msg + (String(hay).includes(needle) ? '' : ' (got: ' + JSON.stringify(String(hay).slice(0, 300)) + ')'));
}

// ============================
// TEST 1: pkg update
// ============================
console.log('\n[1] pkg update — fetch real package list');
const t0 = Date.now();
const updateResult = await sh('pkg update');
console.log('  (' + (Date.now() - t0) + 'ms)');
assertIncludes(updateResult, 'packages available', 'pkg update reports package count');

// ============================
// TEST 2: pkg search mc
// ============================
console.log('\n[2] pkg search mc');
const searchResult = await sh('pkg search mc');
assertIncludes(searchResult, 'mc/', 'pkg search mc finds mc');
assertIncludes(searchResult, 'Midnight Commander', 'pkg search mc shows description');

// ============================
// TEST 3: pkg show mc
// ============================
console.log('\n[3] pkg show mc');
const showResult = await sh('pkg show mc');
assertIncludes(showResult, 'Package: mc', 'pkg show mc shows name');
assertIncludes(showResult, 'Version:', 'pkg show mc shows version');
assertIncludes(showResult, 'Depends:', 'pkg show mc shows dependencies');
console.log('  ' + showResult.split('\n').join('\n  '));

// ============================
// TEST 4: pkg install mc — REAL
// ============================
console.log('\n[4] pkg install mc — FULL PIPELINE');
const t1 = Date.now();
const installResult = await sh('pkg install mc');
console.log('  (' + (Date.now() - t1) + 'ms)');
console.log('  ' + installResult.split('\n').join('\n  '));
assertIncludes(installResult, 'Setting up mc', 'install sets up mc');
assertIncludes(installResult, 'Setting up glib', 'install resolves glib dependency');
assertIncludes(installResult, 'Setting up libandroid-support', 'install resolves libandroid-support dependency');
assertIncludes(installResult, 'newly installed', 'install reports count');

// ============================
// TEST 5: Verify files
// ============================
console.log('\n[5] Verify installed files');
const pkgdbEntry = await context.TermuxFS.fsReadFile(PREFIX + '/lib/pkgdb/mc.json');
assert(pkgdbEntry !== null, 'pkgdb entry exists for mc');
const pkgdb = JSON.parse(pkgdbEntry);
console.log('  mc version: ' + pkgdb.version);
console.log('  mc files: ' + pkgdb.files.length);
assert(pkgdb.files.length > 5, 'mc has more than 5 files installed');
assertIncludes(pkgdb.description, 'Midnight Commander', 'pkgdb has description');

// Check key mc files
const allFiles = await context.TermuxFS.fsList();
const mcFiles = allFiles.filter(f => f.path.includes('/mc'));
console.log('  mc-related files in fs: ' + mcFiles.length);
mcFiles.slice(0, 15).forEach(f => console.log('    ' + f.path));

// Check for mc binary (might be at various paths)
const mcBinPaths = [PREFIX + '/bin/mc', PREFIX + '/usr/bin/mc'];
let foundBin = false;
for (const p of mcBinPaths) {
  const content = await context.TermuxFS.fsReadFile(p);
  if (content) { console.log('  mc binary found at: ' + p); foundBin = true; break; }
}
assert(foundBin, 'mc binary found in virtual fs');

// Check for mc lib files
const libFiles = mcFiles.filter(f => f.path.includes('/lib/') || f.path.includes('/share/'));
console.log('  mc lib/share files: ' + libFiles.length);
assert(libFiles.length > 3, 'mc has lib/share files');

// ============================
// TEST 6: pkg list
// ============================
console.log('\n[6] pkg list');
const listResult = await sh('pkg list');
assertIncludes(listResult, 'mc/', 'mc in pkg list');
assertIncludes(listResult, 'opencode/', 'opencode still in list');

// ============================
// TEST 7: pkg remove mc
// ============================
console.log('\n[7] pkg remove mc');
const removeResult = await sh('pkg remove mc');
assertIncludes(removeResult, 'Removing mc', 'pkg remove mc works');
const listAfter = await sh('pkg list');
assert(!listAfter.includes('mc/'), 'mc removed from list');

console.log('\n' + '='.repeat(60));
console.log(passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:');
  failed.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All tests passed!');
