/* =====================================================================
   Termux Web — Virtual Disk (IndexedDB)
   Adapted from FiveTechSoft/agents
   ===================================================================== */
'use strict';

const TERMUX_DB = 'termux-disk';
const TERMUX_STORE = 'files';
const TERMUX_DB_VERSION = 1;
const HAS_IDB = typeof indexedDB !== 'undefined';
const MEM = new Map();

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TERMUX_DB, TERMUX_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TERMUX_STORE)) {
        db.createObjectStore(TERMUX_STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function fsPut(path, content) {
  const rec = { path, content, mtime: Date.now() };
  if (!HAS_IDB) { MEM.set(path, rec); return; }
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TERMUX_STORE, 'readwrite');
    tx.objectStore(TERMUX_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function fsGet(path) {
  if (!HAS_IDB) return MEM.get(path) || null;
  const db = await _idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(TERMUX_STORE);
    const req = tx.objectStore(TERMUX_STORE).get(path);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function fsDel(path) {
  if (!HAS_IDB) { MEM.delete(path); return; }
  const db = await _idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(TERMUX_STORE, 'readwrite');
    tx.objectStore(TERMUX_STORE).delete(path);
    tx.oncomplete = () => resolve();
  });
}

async function fsList() {
  if (!HAS_IDB) return Array.from(MEM.values());
  const db = await _idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(TERMUX_STORE);
    const req = tx.objectStore(TERMUX_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function fsExists(path) {
  const item = await fsGet(path);
  return item !== null;
}

async function fsIsDir(path) {
  const files = await fsList();
  const prefix = path ? path + '/' : '';
  return files.some(f => f.path === path || f.path.startsWith(prefix));
}

async function fsMkdir(path) {
  const norm = path.replace(/\/+$/, '');
  await fsPut(norm + '/.keep', '');
}

async function fsRmRecursive(path) {
  const files = await fsList();
  const prefix = path + '/';
  const toDelete = files.filter(f => f.path === path || f.path.startsWith(prefix));
  for (const f of toDelete) {
    await fsDel(f.path);
  }
}

async function fsReadFile(path) {
  const item = await fsGet(path);
  return item ? item.content : null;
}

async function fsWriteFile(path, content) {
  await fsPut(path, content);
}

async function fsStat(path) {
  const item = await fsGet(path);
  if (item) {
    const files = await fsList();
    const prefix = path + '/';
    const isDir = files.some(f => f.path.startsWith(prefix));
    return { path: item.path, mtime: item.mtime, isDir, size: isDir ? 0 : (item.content || '').length };
  }
  const files = await fsList();
  const prefix = path + '/';
  if (files.some(f => f.path.startsWith(prefix))) {
    return { path, mtime: Date.now(), isDir: true, size: 0 };
  }
  return null;
}

async function fsInit() {
  const files = await fsList();
  if (files.length === 0) {
    await fsMkdir('/data/data/com.termux/files/home');
    await fsMkdir('/data/data/com.termux/files/usr');
    await fsMkdir('/tmp');
    await fsWriteFile('/data/data/com.termux/files/home/.hushlogin', '');
    await fsWriteFile('/data/data/com.termux/files/usr/etc/motd',
      'Welcome to Termux Web!\n\n' +
      'Real package manager — try:\n' +
      '  pkg update\n' +
      '  pkg install mc\n' +
      '  pkg search vim\n\n' +
      'OpenCode is installed. Try:\n' +
      '  opencode\n' +
      '  opencode run "create hello.py that prints hi"\n\n' +
      'Free models work out of the box.\n' +
      '  /connect opencode <key>     optional own key\n\n' +
      'Community: https://termux.dev/community\n');
    await fsMkdir('/data/data/com.termux/files/home/.local/bin');
    await fsMkdir('/data/data/com.termux/files/usr/bin');
    // Set up real package manager directory structure
    await fsMkdir('/data/data/com.termux/files/usr/etc/apt');
    await fsWriteFile('/data/data/com.termux/files/usr/etc/apt/sources.list',
      '# Termux Web — package repositories\n' +
      '# <repo url> <distribution> <components>\n' +
      'deb https://packages.termux.dev/apt/termux-main stable main\n');
    await fsMkdir('/data/data/com.termux/files/usr/lib/pkgdb');
    await fsWriteFile('/data/data/com.termux/files/home/.bashrc',
      'export HOME=/data/data/com.termux/files/home\n' +
      'export PREFIX=/data/data/com.termux/files/usr\n' +
      'export PATH=$HOME/.local/bin:$PREFIX/bin:$PATH\n');
    if (typeof localStorage !== 'undefined') {
      try {
        const pkgs = JSON.parse(localStorage.getItem('termux-pkg-installed') || '[]');
        const base = ['bash', 'coreutils', 'grep', 'git', 'curl', 'wget', 'nodejs', 'opencode'];
        localStorage.setItem('termux-pkg-installed', JSON.stringify(Array.from(new Set(pkgs.concat(base)))));
      } catch (e) {}
    }
  }
}

window.TermuxFS = {
  fsPut, fsGet, fsDel, fsList, fsExists, fsIsDir,
  fsMkdir, fsRmRecursive, fsReadFile, fsWriteFile, fsStat, fsInit
};
