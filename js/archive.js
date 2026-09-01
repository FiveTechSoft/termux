/* =====================================================================
   Termux Web — Archive Extraction (ar, tar, gzip, xz)
   Real .deb extraction pipeline for browser environment
   ===================================================================== */
'use strict';

const TermuxArchive = (() => {

  /* ===================================================================
     ar format parser — extracts members from .deb archives
     =================================================================== */
  function extractAr(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // ar magic: "!<arch>\n"
    const magic = String.fromCharCode(...u8.slice(0, 8));
    if (magic !== '!<arch>\n') throw new Error('Not a valid ar archive');
    const members = [];
    let pos = 8;
    while (pos + 60 <= u8.length) {
      const header = u8.slice(pos, pos + 60);
      let name = String.fromCharCode(...header.slice(0, 16)).trim();
      const sizeStr = String.fromCharCode(...header.slice(48, 58)).trim();
      const size = parseInt(sizeStr, 10);
      if (isNaN(size) || size < 0) break;
      let dataStart = pos + 60;
      // Handle #1/<len> long names (BSD ar extension, used by some .deb files)
      const longNameMatch = name.match(/^#1\/(\d+)$/);
      if (longNameMatch) {
        const nameLen = parseInt(longNameMatch[1], 10);
        if (nameLen > 0 && nameLen < size) {
          name = String.fromCharCode(...u8.slice(dataStart, dataStart + nameLen)).replace(/\0/g, '');
          dataStart += nameLen;
        }
      }
      const actualSize = (pos + 60 + size) - dataStart;
      members.push({ name, data: u8.slice(dataStart, dataStart + actualSize) });
      pos = pos + 60 + size;
      // ar entries are 2-byte aligned
      if (pos % 2 !== 0) pos++;
    }
    return members;
  }

  /* ===================================================================
     tar parser — extracts file entries from a tar stream
     =================================================================== */
  function extractTar(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const entries = [];
    let pos = 0;
    while (pos + 512 <= u8.length) {
      // end-of-archive: 1024 zero bytes
      if (u8[pos] === 0 && u8.slice(pos, pos + 512).every(b => b === 0)) break;
      // filename: bytes 0-99
      let nameRaw = '';
      for (let i = 0; i < 100 && u8[pos + i] !== 0; i++) nameRaw += String.fromCharCode(u8[pos + i]);
      // typeflag: byte 156
      const typeflag = String.fromCharCode(u8[pos + 156]);
      // size: bytes 124-135 (octal)
      let sizeStr = '';
      for (let i = 124; i < 136 && u8[pos + i] !== 0; i++) sizeStr += String.fromCharCode(u8[pos + i]);
      const size = parseInt(sizeStr.trim(), 8) || 0;
      // prefix: bytes 345-499 (for ustar long names)
      let prefix = '';
      for (let i = 345; i < 500 && u8[pos + i] !== 0; i++) prefix += String.fromCharCode(u8[pos + i]);
      const fullName = prefix ? prefix + '/' + nameRaw : nameRaw;

      const dataStart = pos + 512;
      const dataEnd = dataStart + size;

      if (typeflag === '0' || typeflag === '\0') {
        // regular file
        entries.push({ path: fullName, type: 'file', data: u8.slice(dataStart, dataEnd), size });
      } else if (typeflag === '5') {
        // directory
        entries.push({ path: fullName, type: 'dir', data: null, size: 0 });
      } else if (typeflag === '2') {
        // symlink
        let target = '';
        for (let i = 157; i < 257 && u8[pos + i] !== 0; i++) target += String.fromCharCode(u8[pos + i]);
        entries.push({ path: fullName, type: 'symlink', target, data: null, size: 0 });
      } else if (typeflag === '1') {
        // hardlink — treat as regular file
        entries.push({ path: fullName, type: 'file', data: u8.slice(dataStart, dataEnd), size });
      }

      // advance to next entry (data padded to 512-byte boundary)
      pos = dataStart + Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  /* ===================================================================
     Decompression: gzip and xz via fflate (CDN-loaded)
     =================================================================== */
  function gunzipSync(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (typeof fflate !== 'undefined') {
      return fflate.gunzipSync(u8);
    }
    // Fallback: try native DecompressionStream (gzip only)
    return _decompressNative(u8, 'gzip');
  }

  function xzDecompressSync(buf) {
    throw new Error('xz decompression requires async — use xzDecompress() instead');
  }

  // DecompressionStream polyfill (gzip/deflate)
  async function _decompressStream(u8, format) {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      writer.write(u8);
      writer.close();
      const reader = ds.readable.getReader();
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
    }
    throw new Error('DecompressionStream not available');
  }

  function _decompressNative(u8, format) {
    // Sync wrapper is not possible with DecompressionStream; throw to signal caller to use async
    throw new Error('Need async decompression — use gunzip instead of gunzipSync');
  }

  async function gunzip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // Try fflate sync first (fast, no async overhead)
    if (typeof fflate !== 'undefined') {
      return fflate.gunzipSync(u8);
    }
    // Fallback to DecompressionStream
    return await _decompressStream(u8, 'gzip');
  }

  // Wait for xz-decompress to load (loaded as ESM module asynchronously)
  let _xzReady = null;
  function _waitForXz(timeoutMs) {
    if (typeof XzReadableStream !== 'undefined') return Promise.resolve();
    if (_xzReady) return _xzReady;
    _xzReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (window.removeEventListener) window.removeEventListener('xz-ready', onReady);
        reject(new Error('xz-decompress library did not load within ' + timeoutMs + 'ms'));
      }, timeoutMs);
      function onReady() {
        clearTimeout(timer);
        resolve();
      }
      if (window.addEventListener) {
        window.addEventListener('xz-ready', onReady);
      } else {
        // No addEventListener (e.g. Node.js vm) — poll
        const poll = setInterval(() => {
          if (typeof XzReadableStream !== 'undefined') {
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(poll); }, timeoutMs);
      }
      if (typeof XzReadableStream !== 'undefined') {
        clearTimeout(timer);
        if (window.removeEventListener) window.removeEventListener('xz-ready', onReady);
        resolve();
      }
    });
    return _xzReady;
  }

  async function xzDecompress(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // Allow external override (e.g. from host realm when running in vm context)
    if (typeof _xzDecompressOverride === 'function') {
      return await _xzDecompressOverride(u8);
    }
    // Wait up to 15 seconds for xz-decompress ESM to load
    if (typeof XzReadableStream === 'undefined') {
      await _waitForXz(15000);
    }
    if (typeof XzReadableStream !== 'undefined') {
      const stream = new Response(u8).body;
      const decompressed = new XzReadableStream(stream);
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
    }
    if (typeof XZDecompress !== 'undefined') {
      return XZDecompress(u8);
    }
    throw new Error(
      'xz decompression not available.\n' +
      'Load xz-decompress (ESM) before using pkg.\n' +
      'Only gzip-compressed packages will work without it.'
    );
  }

  /* ===================================================================
     .deb extraction: ar → control.tar + data.tar → entries
     =================================================================== */
  async function extractDeb(debBuf) {
    const u8 = debBuf instanceof Uint8Array ? debBuf : new Uint8Array(debBuf);
    const members = extractAr(u8);

    // Find control.tar.* and data.tar.*
    let controlTarBuf = null;
    let dataTarBuf = null;
    let controlName = '';
    let dataName = '';

    for (const m of members) {
      if (m.name.startsWith('control.tar')) {
        controlTarBuf = m.data;
        controlName = m.name;
      } else if (m.name.startsWith('data.tar')) {
        dataTarBuf = m.data;
        dataName = m.name;
      }
    }

    if (!dataTarBuf) throw new Error('Invalid .deb: no data.tar found');

    // Decompress the tar archives
    async function decompressTar(buf, name) {
      // Strip trailing / (ar format convention) before checking extension
      const cleanName = name.replace(/\/$/, '');
      if (cleanName.endsWith('.xz')) return await xzDecompress(buf);
      if (cleanName.endsWith('.gz')) return await gunzip(buf);
      if (cleanName.endsWith('.zst')) {
        // zstd: try fflate or skip
        if (typeof fflate !== 'undefined' && fflate.decompressSync) {
          return fflate.decompressSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
        }
        throw new Error('zstd decompression not available');
      }
      return buf; // uncompressed
    }

    const dataTar = await decompressTar(dataTarBuf, dataName);
    const entries = extractTar(dataTar);

    // Extract control metadata
    let control = {};
    if (controlTarBuf) {
      try {
        const controlTar = await decompressTar(controlTarBuf, controlName);
        const controlEntries = extractTar(controlTar);
        for (const e of controlEntries) {
          if (e.path === './control' || e.path === 'control') {
            const text = new TextDecoder().decode(e.data);
            control = parseControl(text);
            break;
          }
        }
      } catch (e) {
        // control extraction is optional; continue with data
        console.warn('Could not extract control:', e.message);
      }
    }

    return { entries, control };
  }

  /* ===================================================================
     Debian control file parser
     =================================================================== */
  function parseControl(text) {
    const fields = {};
    let currentKey = null;
    for (const line of text.split('\n')) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // continuation line
        if (currentKey) fields[currentKey] += '\n' + line.trimStart();
      } else {
        const colon = line.indexOf(':');
        if (colon > 0) {
          currentKey = line.slice(0, colon).trim().toLowerCase();
          fields[currentKey] = line.slice(colon + 1).trim();
        }
      }
    }
    return fields;
  }

  /* ===================================================================
     Deb info extraction (without full data extraction)
     =================================================================== */
  async function extractDebControl(debBuf) {
    const u8 = debBuf instanceof Uint8Array ? debBuf : new Uint8Array(debBuf);
    const members = extractAr(u8);
    let controlTarBuf = null;
    let controlName = '';
    for (const m of members) {
      if (m.name.startsWith('control.tar')) {
        controlTarBuf = m.data;
        controlName = m.name;
      }
    }
    if (!controlTarBuf) return {};
    const controlTar = await decompressTarBuf(controlTarBuf, controlName);
    const entries = extractTar(controlTar);
    for (const e of entries) {
      if (e.path === './control' || e.path === 'control') {
        return parseControl(new TextDecoder().decode(e.data));
      }
    }
    return {};

    async function decompressTarBuf(buf, name) {
      if (name.endsWith('.xz')) return await xzDecompress(buf);
      if (name.endsWith('.gz')) return await gunzip(buf);
      return buf;
    }
  }

  return {
    extractAr,
    extractTar,
    extractDeb,
    extractDebControl,
    parseControl,
    gunzip,
    gunzipSync: (buf) => {
      if (typeof fflate !== 'undefined') return fflate.gunzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
      throw new Error('Sync gzip not available — load fflate first');
    },
    xzDecompress
  };
})();

window.TermuxArchive = TermuxArchive;
