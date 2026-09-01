/* =====================================================================
   Termux Web — Real Package Manager (pkg/apt/apt-get)
   Fetches from actual Termux repositories, resolves dependencies,
   downloads and extracts real .deb packages into IndexedDB filesystem.
   ===================================================================== */
'use strict';

const TermuxPkg = (() => {
  const FS = () => window.TermuxFS;
  const ARCHIVE = () => window.TermuxArchive;
  const PREFIX = '/data/data/com.termux/files/usr';
  const DB_KEY = 'termux-pkg-installed';    // JSON array of installed package names
  const CACHE_KEY = 'termux-pkg-cache';     // { ts, packages: { name: {...} } }
  const CACHE_TTL = 3600000;                 // 1 hour
  const SOURCES_LIST = PREFIX + '/etc/apt/sources.list';
  const MAX_CACHE_ENTRIES = 5000;            // max packages to keep in memory cache

  /**
   * Normalize a tar entry path to a virtual FS path.
   * Termux .deb packages store files with full paths like
   *   ./data/data/com.termux/files/usr/bin/mc
   * We need to strip the prefix and map to $PREFIX/<relative>.
   * If the path is already relative (e.g. ./bin/mc), just use it as-is.
   */
  function _normalizeEntryPath(rawPath) {
    const cleaned = rawPath.replace(/^\.\//, '');
    // Check if path already contains the Termux prefix
    const prefixDir = 'data/data/com.termux/files/usr/';
    const idx = cleaned.indexOf(prefixDir);
    if (idx !== -1) {
      // Path has full prefix: ./data/data/com.termux/files/usr/bin/mc -> bin/mc
      return cleaned.slice(idx + prefixDir.length);
    }
    return cleaned;
  }

  /* ===================================================================
     sources.list management
     =================================================================== */
  const DEFAULT_SOURCES = [
    '# Termux Web — package repositories',
    '# <repo url> <distribution> <components>',
    'deb https://packages.termux.dev/apt/termux-main stable main'
  ];

  async function getSources() {
    let content = await FS().fsReadFile(SOURCES_LIST);
    if (!content) {
      // Create default sources.list
      await FS().fsMkdir(PREFIX + '/etc/apt');
      await FS().fsWriteFile(SOURCES_LIST, DEFAULT_SOURCES.join('\n'));
      content = DEFAULT_SOURCES.join('\n');
    }
    const repos = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts[0] === 'deb' && parts.length >= 3) {
        repos.push({ url: parts[1], dist: parts[2], components: parts.slice(3).join(' ') });
      }
    }
    return repos.length > 0 ? repos : [{ url: 'https://packages.termux.dev/apt/termux-main', dist: 'stable', components: 'main' }];
  }

  /* ===================================================================
     Package cache — fetches Packages.gz from repos, parses it
     =================================================================== */
  async function readCache() {
    try {
      const raw = await FS().fsReadFile('/tmp/pkg-cache.json');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  async function writeCache(data) {
    await FS().fsWriteFile('/tmp/pkg-cache.json', JSON.stringify(data));
  }

  /**
   * Fetch and parse Packages from all configured repos.
   * Returns a map: { packageName: { version, filename, size, depends, description, arch, ... } }
   */
  async function fetchPackageList(progressCb) {
    const cached = await readCache();
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
      if (progressCb) progressCb('Reading cached package lists... Done');
      return cached.packages;
    }

    const repos = await getSources();
    const allPackages = {};

    for (const repo of repos) {
      const packagesUrl = repo.url + '/dists/' + repo.dist + '/main/binary-aarch64/Packages.gz';
      if (progressCb) progressCb('Get:1 ' + packagesUrl);

      try {
        const resp = await fetch(packagesUrl);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const compressedBuf = await resp.arrayBuffer();
        const decompressed = await ARCHIVE().gunzip(compressedBuf);
        const text = new TextDecoder().decode(decompressed);

        // Parse the Packages file — each entry is separated by blank lines
        const entries = text.split('\n\n');
        let count = 0;
        for (const entry of entries) {
          if (!entry.trim()) continue;
          const pkg = parsePackageEntry(entry);
          if (pkg && pkg.package && pkg.filename) {
            // Only keep the latest version
            if (!allPackages[pkg.package] || compareVersions(pkg.version, allPackages[pkg.package].version) > 0) {
              allPackages[pkg.package] = pkg;
              count++;
            }
          }
        }
        if (progressCb) progressCb('Get:1 ' + packagesUrl + ' [' + count + ' packages]');
      } catch (e) {
        if (progressCb) progressCb('W: Failed to fetch ' + packagesUrl + ': ' + e.message);
      }
    }

    // Save cache
    const pkgNames = Object.keys(allPackages);
    if (pkgNames.length > MAX_CACHE_ENTRIES) {
      // Keep only most common/important packages to fit in IndexedDB
      const keep = new Set(['bash', 'coreutils', 'grep', 'git', 'curl', 'wget', 'nodejs',
        'python', 'python3', 'opencode', 'vim', 'nano', 'openssh', 'mc', 'tar', 'gzip',
        'xz-utils', 'ncurses', 'glib', 'slang', 'pkg-config', 'clang', 'make', 'cmake',
        'jq', 'ripgrep', 'fd', 'bat', 'fzf', 'htop', 'tree', 'less', 'man', 'tmux',
        'screen', 'neovim', 'emacs', 'ffmpeg', ' imagemagick', 'ffmpeg', 'wget2', 'aria2',
        'rsync', 'openssh-sftp', 'stow', 'symlink-example']);
      const filtered = {};
      for (const name of pkgNames) {
        if (keep.has(name) || pkgNames.indexOf(name) < MAX_CACHE_ENTRIES) {
          filtered[name] = allPackages[name];
        }
      }
      await writeCache({ ts: Date.now(), packages: filtered });
      return filtered;
    }

    await writeCache({ ts: Date.now(), packages: allPackages });
    return allPackages;
  }

  /**
   * Parse a single entry from the Debian Packages file format.
   * Fields are "Key: Value", continuation lines start with whitespace.
   */
  function parsePackageEntry(text) {
    const pkg = {};
    let currentKey = null;
    for (const line of text.split('\n')) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (currentKey) pkg[currentKey] += '\n' + line.trimStart();
      } else {
        const colon = line.indexOf(':');
        if (colon > 0) {
          currentKey = line.slice(0, colon).trim().toLowerCase();
          pkg[currentKey] = line.slice(colon + 1).trim();
        }
      }
    }
    return pkg;
  }

  /* ===================================================================
     Version comparison (dpkg-style)
     =================================================================== */
  function parseVersion(v) {
    const match = (v || '0').match(/^(\d+[:]?)([\d\w.+~-]+)(-.+)?$/);
    if (!match) return { epoch: 0, upstream: v || '0', revision: '' };
    return {
      epoch: parseInt(match[1].replace(':', '')) || 0,
      upstream: match[2],
      revision: (match[3] || '').replace(/^-/, '')
    };
  }

  function compareVersions(a, b) {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    if (va.epoch !== vb.epoch) return va.epoch - vb.epoch;
    const ap = va.upstream.split('.');
    const bp = vb.upstream.split('.');
    const maxLen = Math.max(ap.length, bp.length);
    for (let i = 0; i < maxLen; i++) {
      const an = parseInt(ap[i]) || 0;
      const bn = parseInt(bp[i]) || 0;
      if (an !== bn) return an - bn;
    }
    // Compare revision
    if (va.revision !== vb.revision) return va.revision < vb.revision ? -1 : 1;
    return 0;
  }

  /* ===================================================================
     Dependency resolution (topological sort)
     =================================================================== */
  async function resolveDependencies(names, available, progressCb) {
    const toInstall = new Set();
    const visiting = new Set();
    const installed = getInstalled();

    function addDeps(name) {
      if (toInstall.has(name) || installed.includes(name)) return;
      if (visiting.has(name)) return; // circular dependency
      visiting.add(name);
      const pkg = available[name];
      if (pkg && pkg.depends) {
        const deps = parseDependencyList(pkg.depends);
        for (const dep of deps) {
          // dep.name is the package name, dep.version is optional constraint
          addDeps(dep.name);
        }
      }
      visiting.delete(name);
      toInstall.add(name);
    }

    for (const name of names) {
      if (!available[name]) {
        throw new Error('E: Unable to locate package ' + name);
      }
      addDeps(name);
    }

    // Remove already-installed packages from the list
    const final = [];
    for (const name of toInstall) {
      if (!installed.includes(name)) {
        final.push(name);
      }
    }
    return final;
  }

  /**
   * Parse a Debian dependency string:
   * "libc (>= 2.0), libncurses (>= 6.0)"
   * Returns: [{ name, version, constraint }]
   */
  function parseDependencyList(depsStr) {
    if (!depsStr || depsStr.trim() === '') return [];
    // Handle alternatives (|): only take the first alternative
    const alternatives = depsStr.split(/\s*\|\s*/);
    const result = [];
    for (const alt of alternatives) {
      // Skip pipe alternatives — we already took the first
      if (alt.includes('|')) continue;
      // Handle "pkgname (constraint version)" or "pkgname"
      const match = alt.trim().match(/^([\w.+-]+)\s*(?:\(([^)]+)\))?/);
      if (match) {
        const name = match[1].replace(/:any$/, '');
        let constraint = null, version = null;
        if (match[2]) {
          const cParts = match[2].trim().split(/\s+/);
          constraint = cParts[0];
          version = cParts[1];
        }
        result.push({ name, constraint, version });
      }
    }
    return result;
  }

  /* ===================================================================
     Install / Remove — real .deb download and extraction
     =================================================================== */
  function getInstalled() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || '[]'); } catch (e) { return []; }
  }

  function saveInstalled(list) {
    localStorage.setItem(DB_KEY, JSON.stringify(list));
  }

  function isInstalled(name) {
    return getInstalled().includes(name);
  }

  /**
   * Install one or more packages:
   * 1. Fetch real package metadata from Termux repos
   * 2. Resolve dependencies
   * 3. Download each .deb file
   * 4. Extract into the virtual filesystem
   * 5. Track installed files in $PREFIX/lib/pkgdb/<name>.json
   */
  async function install(names, progressCb) {
    const installed = getInstalled();
    const alreadyInstalled = names.filter(n => installed.includes(n));
    const notInstalled = names.filter(n => !installed.includes(n));
    const output = [];

    if (notInstalled.length === 0) {
      for (const n of alreadyInstalled) {
        output.push(n + ' is already the newest version.');
      }
      return { ok: true, output: output.join('\n'), installed: [] };
    }

    // 1. Fetch package list
    if (progressCb) progressCb('Reading package lists...');
    const available = await fetchPackageList(progressCb);

    if (Object.keys(available).length === 0) {
      return { ok: false, output: 'E: Could not fetch package lists from any repository.\nCheck your network connection and sources.list.' };
    }

    // 2. Resolve dependencies
    if (progressCb) progressCb('Building dependency tree...');
    let toInstall;
    try {
      toInstall = await resolveDependencies(notInstalled, available, progressCb);
    } catch (e) {
      return { ok: false, output: e.message };
    }

    // Remove already-installed from the list
    const finalList = toInstall.filter(n => !installed.includes(n));

    if (finalList.length === 0) {
      for (const n of alreadyInstalled) {
        output.push(n + ' is already the newest version.');
      }
      return { ok: true, output: output.join('\n'), installed: [] };
    }

    output.push('Reading package lists... Done');
    output.push('Building dependency tree... Done');
    output.push('The following NEW packages will be installed:');
    output.push('  ' + finalList.join(' '));
    output.push(finalList.length + ' newly installed.');

    // 3-4. Download and extract each package
    const newlyInstalled = [];
    for (const name of finalList) {
      const pkg = available[name];
      if (!pkg) {
        output.push('W: Package ' + name + ' not found in repos, skipping');
        continue;
      }

      if (progressCb) progressCb('Get: ' + name + ' ' + pkg.version);

      try {
        // The Filename field in Packages is relative to the repo base URL
        const repoUrl = (await getSources())[0]?.url || 'https://packages.termux.dev/apt/termux-main';
        const debUrl = pkg.filename.startsWith('http')
          ? pkg.filename
          : repoUrl + '/' + pkg.filename;

        const resp = await fetch(debUrl);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const debBuf = await resp.arrayBuffer();

        if (progressCb) progressCb('Extracting ' + name + '...');

        // Extract .deb → control + data
        const { entries, control } = await ARCHIVE().extractDeb(debBuf);

        // Install files into virtual filesystem
        const installedFiles = [];
        let fileCount = 0;
        for (const entry of entries) {
          const relPath = _normalizeEntryPath(entry.path);
          if (entry.type === 'dir') {
            // Create directory
            const dirPath = PREFIX + '/' + relPath;
            if (!await FS().fsIsDir(dirPath)) {
              await FS().fsMkdir(dirPath);
            }
            installedFiles.push({ path: dirPath, type: 'dir' });
          } else if (entry.type === 'file') {
            const filePath = PREFIX + '/' + relPath;

            // Check if it's a text file or binary
            const isBinary = isBinaryData(entry.data);
            let content;
            if (isBinary) {
              content = _uint8ToBase64(entry.data);
            } else {
              content = new TextDecoder().decode(entry.data);
            }

            // Create parent directories
            const parts = filePath.split('/');
            parts.pop();
            let cur = '';
            for (const part of parts) {
              cur += '/' + part;
              if (part && !await FS().fsIsDir(cur)) await FS().fsMkdir(cur);
            }

            await FS().fsWriteFile(filePath, content);
            installedFiles.push({ path: filePath, type: 'file', binary: isBinary, size: entry.data.length });
            fileCount++;
          } else if (entry.type === 'symlink') {
            const linkPath = PREFIX + '/' + relPath;
            await FS().fsWriteFile(linkPath, 'SYMLINK:' + entry.target);
            installedFiles.push({ path: linkPath, type: 'symlink', target: entry.target });
          }
        }

        // 5. Save package database entry
        const pkgDbDir = PREFIX + '/lib/pkgdb';
        if (!await FS().fsIsDir(pkgDbDir)) await FS().fsMkdir(pkgDbDir);
        await FS().fsWriteFile(pkgDbDir + '/' + name + '.json', JSON.stringify({
          name,
          version: pkg.version,
          description: pkg.description || control.description || '',
          depends: pkg.depends || control.depends || '',
          installed: new Date().toISOString(),
          files: installedFiles.map(f => f.path),
          fileCount: installedFiles.length
        }, null, 2));

        // Register as installed
        if (!installed.includes(name)) installed.push(name);
        newlyInstalled.push(name);
        output.push('Setting up ' + name + ' (' + pkg.version + ') ...');
        if (progressCb) progressCb('Setting up ' + name + ' ...');

      } catch (e) {
        output.push('E: Failed to install ' + name + ': ' + e.message);
      }
    }

    // Update installed list
    saveInstalled(installed);

    // Handle special packages
    for (const name of newlyInstalled) {
      if (name === 'opencode' && window.TermuxOpenCode) {
        window.TermuxOpenCode.install();
      }
    }

    return { ok: newlyInstalled.length > 0, output: output.join('\n'), installed: newlyInstalled };
  }

  /**
   * Remove packages:
   * 1. Read pkgdb entry to know which files belong to this package
   * 2. Remove those files from the virtual filesystem
   * 3. Remove the pkgdb entry
   * 4. Update installed list
   */
  async function remove(names) {
    const installed = getInstalled();
    const output = [];
    const removed = [];

    for (const name of names) {
      if (!installed.includes(name)) {
        output.push('Package ' + name + ' is not installed, skipping');
        continue;
      }

      // Read package database
      const pkgDbPath = PREFIX + '/lib/pkgdb/' + name + '.json';
      const dbEntry = await FS().fsReadFile(pkgDbPath);

      if (dbEntry) {
        try {
          const db = JSON.parse(dbEntry);
          // Remove files in reverse order (deepest first)
          const files = (db.files || []).sort().reverse();
          for (const filePath of files) {
            await FS().fsDel(filePath);
          }
          output.push('Removing ' + name + ' ...');
        } catch (e) {
          output.push('Warning: Could not read package database for ' + name);
        }
        await FS().fsDel(pkgDbPath);
      } else {
        output.push('Removing ' + name + ' (no file manifest) ...');
      }

      // Handle special packages
      if (name === 'opencode' && window.TermuxOpenCode) {
        window.TermuxOpenCode.uninstall();
      }

      removed.push(name);
    }

    // Update installed list
    saveInstalled(installed.filter(n => !removed.includes(n)));
    output.push('Done.');
    return { ok: true, output: output.join('\n'), removed };
  }

  /**
   * Search packages by name or description.
   * Optionally fetches fresh package lists first.
   */
  async function search(query, progressCb) {
    const available = await fetchPackageList(progressCb);
    const q = (query || '').toLowerCase();
    const results = [];

    for (const [name, pkg] of Object.entries(available)) {
      if (!q || name.toLowerCase().includes(q) ||
          (pkg.description || '').toLowerCase().includes(q)) {
        results.push({ name, version: pkg.version, description: pkg.description || '' });
      }
    }

    return results;
  }

  /**
   * Show package info.
   */
  async function show(name, progressCb) {
    const available = await fetchPackageList(progressCb);
    const pkg = available[name];
    if (!pkg) return null;

    return {
      name: pkg.package || name,
      version: pkg.version,
      description: pkg.description || '',
      depends: pkg.depends || '',
      filename: pkg.filename || '',
      size: pkg.size || '',
      installedSize: pkg['installed-size'] || '',
      maintainer: pkg.maintainer || '',
      homepage: pkg.homepage || '',
      installed: isInstalled(name)
    };
  }

  /**
   * List installed packages with versions.
   */
  async function listInstalled(progressCb) {
    const installed = getInstalled();
    if (installed.length === 0) return [];

    // Try to get versions from cache
    let available = {};
    try { available = (await readCache())?.packages || {}; } catch (e) {}

    return installed.map(name => {
      const pkg = available[name];
      return {
        name,
        version: pkg?.version || 'unknown',
        installed: true
      };
    });
  }

  /* ===================================================================
     Utility: detect binary data
     =================================================================== */
  function isBinaryData(u8) {
    if (!u8 || u8.length === 0) return false;
    // Check first 512 bytes for null bytes
    const checkLen = Math.min(u8.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (u8[i] === 0) return true;
    }
    return false;
  }

  function _uint8ToBase64(u8) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < u8.length; i += chunkSize) {
      const chunk = u8.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  /* ===================================================================
     Public API
     =================================================================== */
  return {
    getSources,
    fetchPackageList,
    resolveDependencies,
    install,
    remove,
    search,
    show,
    listInstalled,
    getInstalled,
    saveInstalled,
    isInstalled,
    parseDependencyList,
    compareVersions,
    parsePackageEntry,
    DEFAULT_SOURCES,
    PREFIX,
    DB_KEY
  };
})();

window.TermuxPkg = TermuxPkg;
