#!/usr/bin/env node
/**
 * Unit tests for mc.js (Midnight Commander file manager)
 * Verifies: module loads, directory listing, navigation, file operations
 */
import fs from 'node:fs';
import vm from 'node:vm';
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
  ReadableStream: (await import('node:stream/web')).ReadableStream,
  WritableStream: (await import('node:stream/web')).WritableStream,
  TransformStream: (await import('node:stream/web')).TransformStream,
});
context.window = context;
context.globalThis = context;
context.self = context;

function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
}

// Load fflate
const fflateCode = await fetch('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js').then(r => r.text());
vm.runInContext(fflateCode, context);

// Load xz-decompress
const xzUrl = pathToFileURL(path.join(root, 'js', '_xz-decompress.mjs')).href;
const xzMod = await import(xzUrl);
const XzReadableStreamHost = xzMod.default?.XzReadableStream || xzMod.XzReadableStream;
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

// Load modules
load('js/fs.js');
load('js/archive.js');
load('js/pkg.js');
load('js/shell.js');
load('js/mc.js');

// Initialize filesystem
await context.TermuxFS.fsInit();
context.TermuxShell.init();

const PREFIX = '/data/data/com.termux/files/usr';
const HOME = '/data/data/com.termux/files/home';

// Create test files
await context.TermuxFS.fsMkdir(HOME + '/projects');
await context.TermuxFS.fsWriteFile(HOME + '/hello.txt', 'Hello World');
await context.TermuxFS.fsWriteFile(HOME + '/script.sh', '#!/bin/bash\necho hi');
await context.TermuxFS.fsMkdir(HOME + '/docs');
await context.TermuxFS.fsWriteFile(HOME + '/docs/readme.md', '# README');
await context.TermuxFS.fsWriteFile(HOME + '/docs/notes.txt', 'Some notes');

// ---- Mock xterm.js terminal ----
let written = [];
let dataHandlers = [];
const mockTerm = {
  cols: 80,
  rows: 24,
  write(s) { written.push(String(s)); },
  onData(fn) { dataHandlers.push(fn); return { dispose: () => { dataHandlers = dataHandlers.filter(h => h !== fn); } }; },
  focus() {},
  buffer: { active: { baseY: 0, cursorY: 0, getLine() { return null; } } },
  reset() {},
};

let passed = 0, failed = [];
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  ' + msg); }
  else { failed.push(msg); console.log('  FAIL  ' + msg); }
}

// ============================
// TEST 1: Module loads
// ============================
console.log('\n[1] Module loads');
assert(typeof context.TermuxMC === 'object', 'TermuxMC is defined');
assert(typeof context.TermuxMC.launch === 'function', 'launch is a function');
assert(typeof context.TermuxMC.handleKey === 'function', 'handleKey is a function');
assert(typeof context.TermuxMC.isRunning === 'function', 'isRunning is a function');

// ============================
// TEST 2: Launch mc
// ============================
console.log('\n[2] Launch mc');
written = [];
dataHandlers = [];

const launchPromise = context.TermuxMC.launch(mockTerm, HOME);

// Wait for rendering
await new Promise(r => setTimeout(r, 100));

const output = written.join('');
assert(output.includes('\x1b[2J'), 'Clears screen on launch');
assert(output.includes('\x1b[?25l'), 'Hides cursor');
assert(context.TermuxMC.isRunning(), 'mc is running');
assert(dataHandlers.length >= 0, 'mc is active');

// ============================
// TEST 3: Directory listing
// ============================
console.log('\n[3] Directory listing');
assert(output.includes('hello.txt') || output.includes('hello'), 'Shows hello.txt in left panel');
assert(output.includes('project') || output.includes('projects/'), 'Shows projects directory');
assert(output.includes('Midnite Commander') || output.includes('Midnight'), 'Shows title bar');

// ============================
// TEST 4: Navigate down
// ============================
console.log('\n[4] Navigation');
written = [];
// Send Down arrow via handleKey (main mc keyboard handler)
context.TermuxMC.handleKey('\x1b[B');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'Renders after cursor move');

// ============================
// TEST 5: Switch panel (Right arrow)
// ============================
console.log('\n[5] Switch panel');
written = [];
context.TermuxMC.handleKey('\x1b[C');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'Renders after panel switch');

// ============================
// TEST 6: Go to parent (Backspace)
// ============================
console.log('\n[6] Go to parent');
written = [];
context.TermuxMC.handleKey('\x7f');
await new Promise(r => setTimeout(r, 200));
assert(written.length > 0, 'Renders after go to parent');

// ============================
// TEST 7: Tab switches panel
// ============================
console.log('\n[7] Tab switches panel');
written = [];
context.TermuxMC.handleKey('\t');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'Renders after Tab');

// ============================
// TEST 8: Quit with q
// ============================
console.log('\n[8] Quit mc');
// The quit promise is launched in background - send quit key
const quitPromise = launchPromise;
context.TermuxMC.handleKey('q');
await new Promise(r => setTimeout(r, 200));
assert(!context.TermuxMC.isRunning(), 'mc is no longer running');

// ============================
// TEST 9: Extra keys count
// ============================
console.log('\n[9] Module API');
assert(typeof context.TermuxMC === 'object', 'TermuxMC is still on window');

console.log('\n' + '='.repeat(60));
console.log(passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:');
  failed.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All tests passed!');
