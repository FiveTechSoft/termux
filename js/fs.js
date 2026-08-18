/* =====================================================================
   Termux Web — Virtual Disk (IndexedDB)
   Adapted from FiveTechSoft/agents
   ===================================================================== */
'use strict';

const TERMUX_DB = 'termux-disk';
const TERMUX_STORE = 'files';
const TERMUX_DB_VERSION = 1;

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
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TERMUX_STORE, 'readwrite');
    tx.objectStore(TERMUX_STORE).put({ path, content, mtime: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function fsGet(path) {
  const db = await _idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(TERMUX_STORE);
    const req = tx.objectStore(TERMUX_STORE).get(path);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function fsDel(path) {
  const db = await _idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(TERMUX_STORE, 'readwrite');
    tx.objectStore(TERMUX_STORE).delete(path);
    tx.oncomplete = () => resolve();
  });
}

async function fsList() {
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
      'Welcome to Termux!\n\n' +
      'Community: https://termux.dev/community\n' +
      'Donate:    https://termux.dev/donate\n\n' +
      'Learn more: https://termux.dev/wiki/Termux\n');
  }
}

window.TermuxFS = {
  fsPut, fsGet, fsDel, fsList, fsExists, fsIsDir,
  fsMkdir, fsRmRecursive, fsReadFile, fsWriteFile, fsStat, fsInit
};
