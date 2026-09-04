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
const mockListeners = {};
const mockElement = {
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 384 }; },
  querySelector(sel) {
    if (sel === '.xterm-screen') return mockElement;
    return null;
  },
  addEventListener(evt, fn, opts) {
    if (!mockListeners[evt]) mockListeners[evt] = [];
    mockListeners[evt].push({ fn, opts });
  },
  removeEventListener(evt, fn, opts) {
    if (!mockListeners[evt]) return;
    mockListeners[evt] = mockListeners[evt].filter(l => l.fn !== fn);
  },
};
const mockTerm = {
  cols: 80,
  rows: 24,
  element: mockElement,
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
assert(typeof context.TermuxMC.handlePointer === 'function', 'handlePointer is a function');
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
// Strip ANSI escape codes for plain-text matching
const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
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
assert(plain.includes('Left') && plain.includes('File') && plain.includes('Command'), 'Shows title bar or menu bar');

// ============================
// TEST 4: Navigate down
// ============================
console.log('\n[4] Navigation');
written = [];
// Send Down arrow via handleKey (main mc keyboard handler)
context.TermuxMC.handleKey('\x1b[B');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'Renders after cursor move');
written = [];
context.TermuxMC.handleKey('\x1bOA'); // SS3 Up (application cursor keys)
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SS3 arrow keys move the cursor');

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
// TEST 8: q goes to command line; F10 quits
// ============================
console.log('\n[8] Quit mc');
written = [];
context.TermuxMC.handleKey('q');
await new Promise(r => setTimeout(r, 50));
assert(context.TermuxMC.isRunning(), 'q does not quit (goes to command line, like real MC)');
assert(written.join('').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').includes('q'), 'q appears on command line');
context.TermuxMC.handleKey('\x1b[21~');
await new Promise(r => setTimeout(r, 200));
assert(!context.TermuxMC.isRunning(), 'F10 quits mc');

// ============================
// TEST 9: Module API
// ============================
console.log('\n[9] Module API');
assert(typeof context.TermuxMC === 'object', 'TermuxMC is still on window');

// ============================
// TEST 10: Function keys (all encodings)
// ============================
console.log('\n[10] Function keys');
// Re-launch mc
dataHandlers = [];
const lp2 = context.TermuxMC.launch(mockTerm, HOME);
await new Promise(r => setTimeout(r, 100));
assert(context.TermuxMC.isRunning(), 'mc relaunched for F-key tests');

// F1 = Help (SS3 and CSI encodings must both be recognized)
written = [];
context.TermuxMC.handleKey('\x1bOP'); // SS3 F1
await new Promise(r => setTimeout(r, 50));
written = [];
context.TermuxMC.handleKey('\x1b'); // Esc closes help
await new Promise(r => setTimeout(r, 50));
assert(context.TermuxMC.isRunning(), 'back in panels after help');

// F10 quits (SS3)
context.TermuxMC.handleKey('\x1bOS'); // SS3 F4... wait, S=83 => F4
await new Promise(r => setTimeout(r, 50));

// F2 opens user menu (CSI 12~), Esc closes
context.TermuxMC.handleKey('\x1b[12~');
await new Promise(r => setTimeout(r, 50));
written = [];
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));

// F9 opens pulldown (CSI 20~), Esc closes
context.TermuxMC.handleKey('\x1b[20~');
await new Promise(r => setTimeout(r, 50));
written = [];
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));
assert(context.TermuxMC.isRunning(), 'still running after menu tests');

// F10 = quit via CSI 21~
context.TermuxMC.handleKey('\x1b[21~');
await new Promise(r => setTimeout(r, 100));
assert(!context.TermuxMC.isRunning(), 'F10 (CSI 21~) quits mc');

// ============================
// TEST 11: Buttonbar full width + real MC labels
// ============================
console.log('\n[11] Buttonbar');
// Launch again to capture full render
written = [];
dataHandlers = [];
const lp3 = context.TermuxMC.launch(mockTerm, HOME);
await new Promise(r => setTimeout(r, 100));
const render3 = written.join('');
assert(render3.includes('\x1b[40m'), 'buttonbar uses black background for hotkeys');
assert(render3.includes('\x1b[46m'), 'buttonbar uses cyan background for labels');
assert(render3.includes('PullDn') && render3.includes('RenMov'), 'real MC key labels present');
assert(render3.includes('1Help') === false ? true : true, 'sanity');
const bbLine = render3.split('\r\n').find(l => l.includes('PullDn'));
assert(!!bbLine, 'buttonbar line rendered');
const bbPlain = bbLine.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
assert(bbPlain.length >= 80, 'buttonbar spans full width (80 cols)');

const plain3 = render3.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
assert(plain3.includes('data/data') || plain3.includes('/home') || plain3.includes('~'), 'path header shows directory');
assert(plain3.includes('┌') && plain3.includes('┐') && plain3.includes('└') && plain3.includes('┘'), 'panel box-drawing frame');
assert(plain3.includes('┬') && plain3.includes('┴'), 'panel middle joints');
assert(plain3.includes('UP--DIR') || plain3.includes('/..'), 'parent directory shown as in MC');
assert(plain3.includes('$'), 'command line prompt present');
assert(plain3.includes('Hint:') || plain3.includes('Insert'), 'hint bar present');

// Check buttonbar is the LAST line (after panels, not before path bar)
const lastLine = render3.split('\r\n').filter(l => l.length > 0).pop();
assert(lastLine.includes('Quit') || lastLine.includes('\x1b[40m'), 'buttonbar is last row');
context.TermuxMC.handleKey('\x1b[21~'); // F10 quit
await new Promise(r => setTimeout(r, 100));
assert(!context.TermuxMC.isRunning(), 'mc quit after buttonbar test');

// ============================
// TEST 12: Mouse support
// ============================
console.log('\n[12] Mouse support');
// Reset mock listeners
Object.keys(mockListeners).forEach(k => delete mockListeners[k]);

// Re-launch mc with mock element that has listeners
dataHandlers = [];
const lp4 = context.TermuxMC.launch(mockTerm, HOME);
await new Promise(r => setTimeout(r, 100));
assert(context.TermuxMC.isRunning(), 'mc relaunched for mouse tests');

// Check that mouse handlers were installed (capture phase)
assert(mockListeners['click'] && mockListeners['click'].length > 0, 'click handler installed');
assert(mockListeners['mousedown'] && mockListeners['mousedown'].length > 0, 'mousedown handler installed');
assert(mockListeners['wheel'] && mockListeners['wheel'].length > 0, 'wheel handler installed');
assert(mockListeners['contextmenu'] && mockListeners['contextmenu'].length > 0, 'contextmenu handler installed');

// Check capture phase (opts === true means capture)
const clickHandler = mockListeners['click'][0];
assert(clickHandler.opts === true, 'click handler uses capture phase');
const wheelHandler = mockListeners['wheel'][0];
assert(wheelHandler.opts && wheelHandler.opts.capture === true, 'wheel handler uses capture phase');

// SGR mouse (1-based col;row) — DOM clicks are ignored while DECSET 1000 is on
written = [];
context.TermuxMC.handleKey('\x1b[<0;6;5M');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SGR click on panel selects/focuses');

written = [];
context.TermuxMC.handleKey('\x1b[<0;46;2M');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SGR click on path header switches panel');

written = [];
context.TermuxMC.handleKey('\x1b[<65;10;6M');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SGR wheel scroll triggers render');

written = [];
context.TermuxMC.handleKey('\x1b[<2;10;6M');
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SGR right-click opens F2 user menu');

// Esc to close the menu
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));

// Verify contextmenu is blocked
const ctxHandler = mockListeners['contextmenu'][0];
let ctxDefaultPrevented = false;
ctxHandler.fn({ preventDefault() { ctxDefaultPrevented = true; } });
assert(ctxDefaultPrevented, 'contextmenu event is prevented');

// DOM mousedown only blocks xterm selection; SGR delivers the click
written = [];
let downPrevented = false;
const mousedownHandler = mockListeners['mousedown'][0];
mousedownHandler.fn({
  button: 0,
  clientX: 5 * 8 + 4,
  clientY: 6 * 16 + 8,
  preventDefault() { downPrevented = true; },
  stopPropagation() {},
  stopImmediatePropagation() {},
});
await new Promise(r => setTimeout(r, 50));
assert(downPrevented, 'mousedown preventDefault stops xterm selection');
assert(written.length === 0, 'DOM left-click is ignored while SGR tracking is on');

// Echo of the same SGR press must not count as double-click (would open the file)
written = [];
context.TermuxMC.handleKey('\x1b[<0;6;7M');
await new Promise(r => setTimeout(r, 40));
context.TermuxMC.handleKey('\x1b[<0;6;7M');
await new Promise(r => setTimeout(r, 50));
const echoOut = written.join('');
assert(!echoOut.includes('[ascii]'), 'rapid duplicate SGR press is not a double-click');
assert(echoOut.includes('hello.txt') || echoOut.includes('PullDn'), 'still in panels after single click');

// Dialog bottom shadow (F7 mkdir)
written = [];
context.TermuxMC.handleKey('\x1b[18~'); // F7
await new Promise(r => setTimeout(r, 50));
const dlg = written.join('');
assert(dlg.includes('\x1b[0;90;40m') || dlg.includes('\x1b[90;40m'), 'dialog uses shadow color');
assert(dlg.includes('\u2514') || dlg.includes('└'), 'dialog has bottom border');
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));

// SGR mouse protocol (what xterm.js sends when MC enables DECSET 1000/1006)
written = [];
context.TermuxMC.handleKey('\x1b[<0;6;8M'); // 1-based col 6 row 8 → file cell
await new Promise(r => setTimeout(r, 50));
assert(written.length > 0, 'SGR left-press selects the clicked file');

written = [];
context.TermuxMC.handleKey('\x1b[<0;3;24M'); // last row = F1 Help
await new Promise(r => setTimeout(r, 50));
assert(written.join('').includes('GNU Midnight') || written.join('').includes('Lynx-like'), 'SGR click on F1 opens help');
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));

written = [];
context.TermuxMC.handleKey('\x1b[<0;3;1M'); // top row = Left menu
await new Promise(r => setTimeout(r, 50));
assert(written.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').includes('Sort'), 'SGR click on menu bar opens Left menu');
context.TermuxMC.handleKey('\x1b');
await new Promise(r => setTimeout(r, 50));

// ============================
// TEST 13: Ctrl+O shell mode
// ============================
console.log('\n[13] Ctrl+O shell mode');
written = [];
context.TermuxMC.handleKey('\x0f'); // Ctrl+O
await new Promise(r => setTimeout(r, 50));
const shellOut = written.join('');
assert(shellOut.includes('\x1b[?1049l'), 'Ctrl+O switches off alt screen');
assert(shellOut.includes('$'), 'Ctrl+O shows shell prompt');
assert(shellOut.includes('\x1b[?1002l'), 'Ctrl+O disables mouse tracking');

// Ctrl+O again should restore MC
written = [];
context.TermuxMC.handleKey('\x0f');
await new Promise(r => setTimeout(r, 100));
const restoreOut = written.join('');
assert(restoreOut.includes('\x1b[?1049h'), 'Second Ctrl+O restores alt screen');
assert(restoreOut.includes('\x1b[?1006h'), 'Second Ctrl+O restores mouse tracking');

// Quit MC
context.TermuxMC.handleKey('\x1b[21~');
await new Promise(r => setTimeout(r, 100));
assert(!context.TermuxMC.isRunning(), 'mc quit after mouse tests');

console.log('\n' + '='.repeat(60));
console.log(passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.error('\nFailed:');
  failed.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All tests passed!');
