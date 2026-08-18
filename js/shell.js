/* =====================================================================
   Termux Web — POSIX Shell Interpreter
   Adapted from FiveTechSoft/agents
   ===================================================================== */
'use strict';

const TermuxShell = (() => {
  const FS = () => window.TermuxFS;
  let SHCWD = '/data/data/com.termux/files/home';
  const HOME = '/data/data/com.termux/files/home';
  const PREFIX = '/data/data/com.termux/files/usr';
  let SH_EXIT = 0;
  const SH_VARS = {};
  let SH_BRK = false, SH_CONT = false;

  function shPrompt() {
    let dir = SHCWD || '/';
    if (dir.startsWith(HOME)) dir = '~' + dir.slice(HOME.length);
    if (!dir) dir = '~';
    return dir + ' $ ';
  }

  function shVarSub(s) {
    return (s || '')
      .replace(/\$\?/g, () => String(SH_EXIT))
      .replace(/\$\{(\w+)\}/g, (m, n) => SH_VARS[n] !== undefined ? SH_VARS[n] : '')
      .replace(/\$(\w+)/g, (m, n) => SH_VARS[n] !== undefined ? SH_VARS[n] : '');
  }

  async function shExpandSubst(line) {
    let g = 0;
    let m;
    while (g++ < 60) {
      if (m = line.match(/\$\(\(([^()]*)\)\)/)) {
        const expr = shVarSub(m[1]);
        let v = '';
        try {
          if (/^[\d\s+\-*/%().]+$/.test(expr)) v = String(Function('return(' + expr + ')')());
        } catch (e) { }
        line = line.slice(0, m.index) + v + line.slice(m.index + m[0].length);
        continue;
      }
      if (m = line.match(/\$\(([^()]*)\)/)) {
        const out = (await shRun(m[1])).replace(/\n+/g, ' ').trim();
        line = line.slice(0, m.index) + out + line.slice(m.index + m[0].length);
        continue;
      }
      if (m = line.match(/`([^`]*)`/)) {
        const out = (await shRun(m[1])).replace(/\n+/g, ' ').trim();
        line = line.slice(0, m.index) + out + line.slice(m.index + m[0].length);
        continue;
      }
      break;
    }
    return line;
  }

  function shNorm(p) {
    const out = [];
    (p || '').split('/').forEach(s => {
      if (s === '' || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return out.join('/');
  }

  function shResolve(arg) {
    if (!arg) return shNorm(SHCWD);
    if (arg === '~' || arg.startsWith('~/')) arg = HOME + arg.slice(1);
    return shNorm(arg.startsWith('/') ? arg : (SHCWD + '/' + arg));
  }

  async function shList(dir) {
    const items = await FS().fsList();
    const pre = dir ? dir + '/' : '';
    const dirs = new Set(), files = [];
    items.forEach(f => {
      if (dir && f.path !== dir && !f.path.startsWith(pre)) return;
      const rest = dir ? f.path.slice(pre.length) : f.path;
      if (!rest) return;
      const sl = rest.indexOf('/');
      if (sl >= 0) dirs.add(rest.slice(0, sl));
      else if (rest !== '.keep') files.push(rest);
    });
    return { dirs: [...dirs].sort(), files: files.sort() };
  }

  async function shGlob(item) {
    if (item.indexOf('*') < 0 && item.indexOf('?') < 0) return [item];
    const mkRe = s => new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    if (item.indexOf('/') >= 0) {
      const re = mkRe(shResolve(item));
      const all = await FS().fsList();
      const m = all.map(f => f.path).filter(p => re.test(p));
      return m.length ? m.map(p => '/' + p) : [item];
    }
    const { dirs, files } = await shList(shResolve(''));
    const all = dirs.map(d => d + '/').concat(files);
    const re = mkRe(item);
    const m = all.filter(x => re.test(x) || re.test(x.replace(/\/$/, '')));
    return m.length ? m.map(x => x.replace(/\/$/, '')) : [item];
  }

  function shSplitTop(line, seps) {
    const out = [];
    let buf = '', q = null, i = 0;
    while (i < line.length) {
      const c = line[i];
      if (q) { buf += c; if (c === q) q = null; i++; continue; }
      if (c === '"' || c === "'") { q = c; buf += c; i++; continue; }
      let m = null;
      for (const s of seps) { if (line.startsWith(s, i)) { m = s; break; } }
      if (m) { out.push(buf, m); buf = ''; i += m.length; continue; }
      buf += c; i++;
    }
    out.push(buf);
    return out;
  }

  function shArgs(line) {
    const args = [];
    let buf = '', q = null, i = 0;
    while (i < line.length) {
      const c = line[i];
      if (q) {
        if (c === q) { q = null; i++; continue; }
        buf += c; i++; continue;
      }
      if (c === '"' || c === "'") { q = c; i++; continue; }
      if (c === ' ' || c === '\t') {
        if (buf) { args.push(buf); buf = ''; }
        i++; continue;
      }
      buf += c; i++;
    }
    if (buf) args.push(buf);
    return args;
  }

  function shUnquote(s) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  /* ===================================================================
     Command Interpreter
     =================================================================== */
  async function shOne(line, stdin) {
    line = (line || '').trim();
    if (!line) return '';
    const origLine = line;
    const args0 = shArgs(line);
    const cmd = args0[0];
    const args = args0.slice(1).map(shUnquote);

    switch (cmd) {
      case '': return '';
      case 'true': SH_EXIT = 0; return '';
      case 'false': SH_EXIT = 1; return '';

      case 'pwd': return SHCWD || '/';
      case 'hostname': return 'termux';
      case 'whoami': return 'user1';
      case 'id': return 'uid=10123(u0_a123) gid=10123(u0_a123) groups=10123(u0_a123)';
      case 'uname': return args.includes('-a') ? 'Linux termux 4.14.141+ #1 SMP PREEMPT aarch64 Android' : (args.includes('-r') ? '4.14.141+' : 'Linux');
      case 'date': return new Date().toString();
      case 'echo': {
        let out = args.join(' ');
        if (args.includes('-n')) { out = args.filter(a => a !== '-n').join(''); }
        return out;
      }
      case 'printf': {
        if (args.length === 0) return '';
        let fmt = args[0];
        let out = '';
        let ai = 1;
        fmt.replace(/%[sd]/g, (m) => { out += m === '%s' ? (args[ai++] || '') : (args[ai++] || '0'); return ''; });
        if (!fmt.includes('%')) out = args.slice(1).join(' ');
        return out;
      }
      case 'env': {
        const vars = [
          'HOME=' + HOME,
          'PREFIX=' + PREFIX,
          'SHELL=' + PREFIX + '/bin/bash',
          'TERM=xterm-256color',
          'USER=user1',
          'LANG=en_US.UTF-8',
          'PATH=' + HOME + '/.local/bin:' + PREFIX + '/bin:' + HOME + '/bin',
          'TMPDIR=/tmp',
          'PREFIX=' + PREFIX
        ];
        return vars.join('\n');
      }
      case 'export': {
        for (const a of args) {
          const eq = a.indexOf('=');
          if (eq > 0) SH_VARS[a.slice(0, eq)] = a.slice(eq + 1);
        }
        return '';
      }
      case 'unset': {
        for (const a of args) delete SH_VARS[a];
        return '';
      }

      case 'cd': {
        const target = shResolve(shUnquote(args[0] || '~'));
        const st = await FS().fsStat(target);
        if (st && st.isDir) { SHCWD = shNorm(target); SH_EXIT = 0; }
        else { SH_EXIT = 1; return 'cd: ' + (args[0] || '~') + ': No such file or directory'; }
        return '';
      }

      case 'ls': {
        const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
        const showLong = args.includes('-l') || args.includes('-la') || args.includes('-al');
        const target = shResolve(shUnquote(args.filter(a => !a.startsWith('-'))[0] || ''));
        const { dirs, files } = await shList(target);
        let items = [...dirs.map(d => d + '/'), ...files];
        if (showAll) items = ['.', '..', ...items];
        if (showLong) {
          return items.map(f => {
            const isDir = f.endsWith('/');
            const mode = isDir ? 'drwxr-x---' : '-rw-r-----';
            return mode + ' 1 u0_a123 u0_a123  ' + String(Math.floor(Math.random() * 9000) + 100).padStart(5) + ' ' + new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' ' + f;
          }).join('\n');
        }
        return items.join('  ');
      }

      case 'cat': {
        if (args.length === 0) return stdin || '';
        const out = [];
        for (const a of args) {
          const p = shResolve(a);
          const content = await FS().fsReadFile(p);
          if (content === null) { SH_EXIT = 1; return 'cat: ' + a + ': No such file or directory'; }
          out.push(content);
        }
        SH_EXIT = 0;
        return out.join('\n');
      }

      case 'head': {
        let n = 10;
        const na = args.indexOf('-n');
        if (na >= 0) n = parseInt(args[na + 1]) || 10;
        const file = args.filter(a => !a.startsWith('-') && a !== String(n))[0];
        if (!file) return stdin || '';
        const content = await FS().fsReadFile(shResolve(file));
        if (content === null) return 'cat: ' + file + ': No such file or directory';
        return content.split('\n').slice(0, n).join('\n');
      }

      case 'tail': {
        let n = 10;
        const na = args.indexOf('-n');
        if (na >= 0) n = parseInt(args[na + 1]) || 10;
        const file = args.filter(a => !a.startsWith('-') && a !== String(n))[0];
        if (!file) return stdin || '';
        const content = await FS().fsReadFile(shResolve(file));
        if (content === null) return 'cat: ' + file + ': No such file or directory';
        return content.split('\n').slice(-n).join('\n');
      }

      case 'wc': {
        const file = args.filter(a => !a.startsWith('-'))[0];
        const content = file ? await FS().fsReadFile(shResolve(file)) : (stdin || '');
        if (file && content === null) return 'wc: ' + file + ': No such file or directory';
        const lines = content.split('\n').length;
        const words = content.split(/\s+/).filter(Boolean).length;
        const chars = content.length;
        return `  ${lines}  ${words} ${chars}` + (file ? ' ' + file : '');
      }

      case 'sort': {
        const content = stdin || '';
        const lines = content.split('\n').sort();
        return lines.join('\n');
      }

      case 'uniq': {
        const content = stdin || '';
        return content.split('\n').filter((v, i, a) => a.indexOf(v) === i).join('\n');
      }

      case 'rev': {
        const content = stdin || '';
        return content.split('\n').map(l => l.split('').reverse().join('')).join('\n');
      }

      case 'tac': {
        const content = stdin || '';
        return content.split('\n').reverse().join('\n');
      }

      case 'nl': {
        const content = stdin || '';
        return content.split('\n').map((l, i) => String(i + 1).padStart(6) + '\t' + l).join('\n');
      }

      case 'tr': {
        if (args.length < 2) return stdin || '';
        const content = stdin || '';
        if (args[0] === '-d') return content.split('').filter(c => !args[1].includes(c)).join('');
        const from = args[0], to = args[1];
        return content.split('').map(c => { const idx = from.indexOf(c); return idx >= 0 && idx < to.length ? to[idx] : c; }).join('');
      }

      case 'cut': {
        if (args.length < 2) return stdin || '';
        const delim = args.includes('-d') ? args[args.indexOf('-d') + 1] : '\t';
        const fields = args.includes('-f') ? args[args.indexOf('-f') + 1].split(',').map(Number) : [1];
        const content = stdin || '';
        return content.split('\n').map(line => {
          const parts = line.split(delim);
          return fields.map(f => parts[f - 1] || '').join(delim);
        }).join('\n');
      }

      case 'tee': {
        const content = stdin || '';
        for (const a of args) {
          const existing = await FS().fsReadFile(shResolve(a)) || '';
          await FS().fsWriteFile(shResolve(a), existing + (existing && !existing.endsWith('\n') ? '\n' : '') + content);
        }
        return content;
      }

      case 'diff': {
        if (args.length < 2) return 'diff: missing operand';
        const a1 = await FS().fsReadFile(shResolve(args[0]));
        const a2 = await FS().fsReadFile(shResolve(args[1]));
        if (a1 === null) return 'diff: ' + args[0] + ': No such file or directory';
        if (a2 === null) return 'diff: ' + args[1] + ': No such file or directory';
        const l1 = a1.split('\n'), l2 = a2.split('\n');
        const max = Math.max(l1.length, l2.length);
        const out = [];
        for (let i = 0; i < max; i++) {
          if (l1[i] !== l2[i]) out.push('@@ line ' + (i + 1) + ' @@');
          if (l1[i] !== undefined && l1[i] !== l2[i]) out.push('- ' + l1[i]);
          if (l2[i] !== undefined && l1[i] !== l2[i]) out.push('+ ' + l2[i]);
        }
        return out.length ? out.join('\n') : '';
      }

      case 'touch': {
        for (const a of args) {
          const p = shResolve(a);
          const existing = await FS().fsReadFile(p);
          if (existing === null) await FS().fsWriteFile(p, '');
        }
        SH_EXIT = 0;
        return '';
      }

      case 'mkdir': {
        const parents = args.includes('-p');
        const dirs = args.filter(a => !a.startsWith('-'));
        for (const d of dirs) {
          const p = shResolve(d);
          if (parents) {
            const parts = p.split('/');
            let cur = '';
            for (const part of parts) {
              cur += '/' + part;
              const st = await FS().fsStat(cur);
              if (!st) await FS().fsMkdir(cur);
            }
          } else {
            await FS().fsMkdir(p);
          }
        }
        SH_EXIT = 0;
        return '';
      }

      case 'rm': {
        const recursive = args.includes('-r') || args.includes('-rf') || args.includes('-fr');
        const force = args.includes('-f') || args.includes('-rf') || args.includes('-fr');
        const files = args.filter(a => !a.startsWith('-'));
        for (const f of files) {
          const p = shResolve(f);
          const st = await FS().fsStat(p);
          if (!st) {
            if (!force) { SH_EXIT = 1; return 'rm: cannot remove \'' + f + '\': No such file or directory'; }
            continue;
          }
          if (st.isDir && !recursive) { SH_EXIT = 1; return 'rm: cannot remove \'' + f + '\': Is a directory'; }
          await FS().fsRmRecursive(p);
        }
        SH_EXIT = 0;
        return '';
      }

      case 'mv': {
        if (args.length < 2) return 'mv: missing destination';
        const src = shResolve(args[0]);
        const dst = shResolve(args[1]);
        const content = await FS().fsReadFile(src);
        if (content === null) return 'mv: cannot stat \'' + args[0] + '\': No such file or directory';
        await FS().fsWriteFile(dst, content);
        await FS().fsDel(src);
        SH_EXIT = 0;
        return '';
      }

      case 'cp': {
        if (args.length < 2) return 'cp: missing destination';
        const recursive = args.includes('-r');
        const src = shResolve(args[0]);
        const dst = shResolve(args[1]);
        const content = await FS().fsReadFile(src);
        if (content === null) return 'cp: cannot stat \'' + args[0] + '\': No such file or directory';
        await FS().fsWriteFile(dst, content);
        SH_EXIT = 0;
        return '';
      }

      case 'grep': {
        let ignoreCase = args.includes('-i');
        let invert = args.includes('-v');
        let countOnly = args.includes('-c');
        let lineNums = args.includes('-n');
        let maxCount = 1;
        if (args.includes('-m')) maxCount = parseInt(args[args.indexOf('-m') + 1]) || 1;
        const pattern = args.filter(a => !a.startsWith('-') && a !== String(maxCount))[0];
        if (!pattern) return 'grep: missing pattern';
        let re;
        try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); } catch (e) { return 'grep: invalid pattern'; }
        const content = stdin || '';
        const lines = content.split('\n');
        let matches = lines.filter((l, i) => {
          const hit = re.test(l);
          return invert ? !hit : hit;
        });
        if (countOnly) return String(matches.length);
        matches = matches.slice(0, maxCount);
        return matches.join('\n');
      }

      case 'find': {
        let namePattern = null, maxDepth = null, typeFilter = null;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '-name') namePattern = args[++i];
          else if (args[i] === '-maxdepth') maxDepth = parseInt(args[++i]);
          else if (args[i] === '-type') typeFilter = args[++i];
        }
        const all = await FS().fsList();
        const base = args.filter(a => !a.startsWith('-'))[0];
        const baseResolved = base ? shResolve(base) : SHCWD;
        let results = all.map(f => '/' + f.path);
        if (base) results = results.filter(p => p === baseResolved || p.startsWith(baseResolved + '/'));
        if (namePattern) {
          const re = new RegExp('^' + namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          results = results.filter(p => re.test(p.split('/').pop()));
        }
        if (typeFilter === 'f') results = results.filter(async p => { const s = await FS().fsStat(p); return s && !s.isDir; });
        if (typeFilter === 'd') results = results.filter(async p => { const s = await FS().fsStat(p); return s && s.isDir; });
        if (maxDepth !== null) results = results.filter(p => p.slice(baseResolved.length).split('/').filter(Boolean).length <= maxDepth);
        return results.join('\n');
      }

      case 'which': {
        const out = [];
        for (const a of args) {
          if (SHELL_CMDS.has(a)) out.push(PREFIX + '/bin/' + a);
          else {
            const termuxBinPath = HOME + '/.local/bin/' + a;
            const st = await FS().fsStat(termuxBinPath);
            if (st) out.push(termuxBinPath);
            else out.push(a + ' not found');
          }
        }
        return out.join('\n');
      }

      case 'type': {
        const out = [];
        for (const a of args) {
          if (SHELL_CMDS.has(a)) out.push(a + ' is /data/data/com.termux/files/usr/bin/' + a);
          else out.push(a + ': not found');
        }
        return out.join('\n');
      }

      case 'basename': return (args[0] || '').split('/').pop() || '';
      case 'dirname': { const p = (args[0] || '').split('/'); p.pop(); return p.join('/') || '/'; }

      case 'seq': {
        let start = 1, end = 1, step = 1;
        if (args.length === 1) end = parseInt(args[0]) || 1;
        else if (args.length === 2) { start = parseInt(args[0]) || 1; end = parseInt(args[1]) || 1; }
        else { start = parseInt(args[0]) || 1; step = parseInt(args[1]) || 1; end = parseInt(args[2]) || 1; }
        const out = [];
        if (step > 0) for (let i = start; i <= end; i += step) out.push(String(i));
        else for (let i = start; i >= end; i += step) out.push(String(i));
        return out.join('\n');
      }

      case 'sleep': return new Promise(r => setTimeout(r, (parseFloat(args[0]) || 1) * 1000));

      case 'test':
      case '[': {
        const a = args.filter(a => a !== ']').map(shUnquote);
        if (a.length < 2) { SH_EXIT = 1; return ''; }
        if (a[0] === '-f') { const s = await FS().fsStat(shResolve(a[1])); SH_EXIT = (s && !s.isDir) ? 0 : 1; return ''; }
        if (a[0] === '-d') { const s = await FS().fsStat(shResolve(a[1])); SH_EXIT = (s && s.isDir) ? 0 : 1; return ''; }
        if (a[0] === '-e') { const s = await FS().fsStat(shResolve(a[1])); SH_EXIT = s ? 0 : 1; return ''; }
        if (a[0] === '-z') { SH_EXIT = (!a[1] || a[1].length === 0) ? 0 : 1; return ''; }
        if (a[0] === '-n') { SH_EXIT = (a[1] && a[1].length > 0) ? 0 : 1; return ''; }
        if (a[1] === '=' || a[1] === '==') { SH_EXIT = (a[0] === a[2]) ? 0 : 1; return ''; }
        if (a[1] === '!=') { SH_EXIT = (a[0] !== a[2]) ? 0 : 1; return ''; }
        if (a[1] === '-eq') { SH_EXIT = (Number(a[0]) === Number(a[2])) ? 0 : 1; return ''; }
        if (a[1] === '-ne') { SH_EXIT = (Number(a[0]) !== Number(a[2])) ? 0 : 1; return ''; }
        if (a[1] === '-lt') { SH_EXIT = (Number(a[0]) < Number(a[2])) ? 0 : 1; return ''; }
        if (a[1] === '-le') { SH_EXIT = (Number(a[0]) <= Number(a[2])) ? 0 : 1; return ''; }
        if (a[1] === '-gt') { SH_EXIT = (Number(a[0]) > Number(a[2])) ? 0 : 1; return ''; }
        if (a[1] === '-ge') { SH_EXIT = (Number(a[0]) >= Number(a[2])) ? 0 : 1; return ''; }
        SH_EXIT = 1;
        return '';
      }

      case 'write': {
        if (args.length < 2) return 'write: usage: write <file> <content>';
        await FS().fsWriteFile(shResolve(args[0]), args.slice(1).join(' '));
        SH_EXIT = 0;
        return '';
      }

      case 'del': {
        for (const a of args) await FS().fsDel(shResolve(a));
        SH_EXIT = 0;
        return '';
      }

      case 'clear': return '\x1B[2J\x1B[H';

      case 'help': {
        return [
          'Termux Web - Supported Commands:',
          '',
          '\x1b[1mFiles:\x1b[0m     ls, cat, cd, mkdir, touch, rm, mv, cp, find, basename, dirname',
          '\x1b[1mText:\x1b[0m      echo, printf, grep, head, tail, wc, sort, uniq, tr, cut, tee, rev, nl, tac, diff',
          '\x1b[1mSystem:\x1b[0m    pwd, whoami, hostname, uname, id, date, env, which, type, clear',
          '\x1b[1mShell:\x1b[0m     export, unset, test, [, true, false, for, while, until, if, break, continue',
          '\x1b[1mPackages:\x1b[0m  pkg, apt, npm, pip',
          '\x1b[1mRuntimes:\x1b[0m  node, python, php',
          '\x1b[1mAI:\x1b[0m        ai (Mimo V2.5 Free via OpenCode Zen)',
          '\x1b[1mNetwork:\x1b[0m   curl, wget',
          '\x1b[1mGit:\x1b[0m       git (init, status, add, commit, log, diff, branch)',
          '\x1b[1mSystem:\x1b[0m    ps, top, free, df',
          '\x1b[1mFeatures:\x1b[0m  pipes (|), redirects (> >>), $(), $(( )), && ||, ;, glob (* ?)',
          ''
        ].join('\n');
      }

      case 'pkg':
      case 'apt':
      case 'apt-get': {
        if (args[0] === 'update') return 'Reading package lists... Done\nBuilding dependency tree... Done\nAll packages are up to date.';
        if (args[0] === 'upgrade') return 'Reading package lists... Done\nBuilding dependency tree... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.';
        if (args[0] === 'install') return 'Reading package lists... Done\nBuilding dependency tree... Done\nE: Unable to locate package ' + (args[1] || '');
        if (args[0] === 'list' || args[0] === 'list-installed') return 'Listing... Done\nbash/stable,now 5.2.37 aarch64 [installed]\ncoreutils/stable,now 9.6 aarch64 [installed]\ngrep/stable,now 3.11 aarch64 [installed]\nsed/stable,now 4.9 aarch64 [installed]\nnginx/stable 1.27.4 aarch64 [installed]';
        if (args[0] === 'search') return 'Sorting... Done\nFull Text Search... Done\n' + (args[1] || '') + '/stable 1.0.0 aarch64\n  A package';
        return 'Usage: pkg [install|remove|update|upgrade|list|search|show]';
      }

      case 'node':
      case 'nodejs': {
        if (args[0] === '-v' || args[0] === '--version') {
          return window._almostnode ? 'v22.0.0 (almostnode WASM)' : 'v0.0.0 (not loaded)';
        }
        if (!window._almostnode) {
          try {
            const mod = await import('https://esm.sh/almostnode');
            window._almostnode = mod.createContainer();
          } catch (e) { return 'node: failed to load almostnode: ' + e.message; }
        }
        if (!window._almostnode) return 'node: almostnode init returned null';
        const { vfs, runtime } = window._almostnode;
        if (args.length === 0 || args[0] === '-i') {
          return 'Welcome to Node.js v22.0.0 (almostnode WASM)\n> Use "node -e <code>" to evaluate.\n> Use "node <file>" to run a .js file.';
        }
        if (args[0] === '-p' || args[0] === '-pe') {
          const code = args.slice(1).join(' ');
          try { const r = eval(code); return r === undefined ? 'undefined' : String(r); } catch (e) { SH_EXIT = 1; return 'ReferenceError: ' + e.message; }
        }
        if (args[0] === '-e') {
          const code = args.slice(1).join(' ');
          try {
            vfs.writeFileSync('/eval.js', code);
            let output = '';
            const origLog = console.log;
            console.log = (...a) => { output += a.join(' ') + '\n'; };
            runtime.runFile('/eval.js');
            console.log = origLog;
            return output.trimEnd();
          } catch (e) { SH_EXIT = 1; return e.name + ': ' + e.message; }
        }
        const file = shResolve(args[0]);
        const content = await FS().fsReadFile(file);
        if (content === null) { SH_EXIT = 1; return 'node: Cannot find module \'' + args[0] + '\''; }
        try {
          vfs.writeFileSync('/script.js', content);
          let output = '';
          const origLog = console.log;
          console.log = (...a) => { output += a.join(' ') + '\n'; };
          runtime.runFile('/script.js');
          console.log = origLog;
          return output.trimEnd();
        } catch (e) { SH_EXIT = 1; return e.name + ': ' + e.message; }
      }

      case 'ai': {
        const AI_KEY = 'termux-ai-config';
        function getAiConfig() {
          try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch(e) { return {}; }
        }
        function saveAiConfig(cfg) { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); }

        if (args[0] === 'config') {
          if (args[1] === 'set') {
            const cfg = getAiConfig();
            if (args[2] === 'key') { cfg.apiKey = args[3]; saveAiConfig(cfg); return '\x1b[1;32mAPI key saved.\x1b[0m'; }
            if (args[2] === 'provider') { cfg.provider = args[3]; saveAiConfig(cfg); return '\x1b[1;32mProvider set to ' + args[3] + '.\x1b[0m'; }
            if (args[2] === 'model') { cfg.model = args[3]; saveAiConfig(cfg); return '\x1b[1;32mModel set to ' + args[3] + '.\x1b[0m'; }
            return 'Usage: ai config set [key|provider|model] <value>';
          }
          if (args[1] === 'show' || args[1] === 'get') {
            const cfg = getAiConfig();
            return [
              'AI Configuration:',
              '  provider: ' + (cfg.provider || 'opencode (default)'),
              '  model:    ' + (cfg.model || 'opencode/mimo-v2-5-free'),
              '  apiKey:   ' + (cfg.apiKey ? cfg.apiKey.slice(0,8) + '...' : '(free — no key needed)')
            ].join('\n');
          }
          if (args[1] === 'models') {
            return [
              'Available free models (no key needed):',
              '  mimo-v2.5-free           (MiMo V2.5 - reasoning)',
              '  deepseek-v4-flash-free    (DeepSeek V4 Flash)',
              '  minimax-m2.5-free         (MiniMax M2.5)',
              '  hy3-free                  (Hy3)',
              '  nemotron-3-ultra-free     (Nemotron 3 Ultra)',
              '  nemotron-3.5-lightning-free (Nemotron 3.5 Lightning)',
              '  laguna-s-2.1-free         (Laguna S 2.1)'
            ].join('\n');
          }
          if (args[1] === 'clear') { localStorage.removeItem(AI_KEY); return '\x1b[1;32mAI config cleared.\x1b[0m'; }
          return 'Usage: ai config [set|show|models|clear]';
        }

        const cfg = getAiConfig();
        const apiKey = cfg.apiKey || 'public';
        const model = cfg.model || 'mimo-v2.5-free';
        const baseUrl = 'https://opencode.ai/zen/v1';

        const prompt = args.join(' ');
        if (!prompt) {
          return '\x1b[1;33mAI Chat — ' + model + '\x1b[0m (free, no key needed)\n' +
            'Type your message after "ai". Examples:\n' +
            '  ai hello, how are you?\n' +
            '  ai explain quicksort in 3 lines\n' +
            '  ai config models\n\n' +
            '\x1b[1mCurrent model:\x1b[0m ' + model;
        }

        try {
          const messages = [{ role: 'user', content: prompt }];
          const body = { model, messages, max_tokens: 2048, stream: false };

          const resp = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body)
          });

          if (!resp.ok) {
            const err = await resp.text();
            SH_EXIT = 1;
            return '\x1b[1;31mAPI error ' + resp.status + ':\x1b[0m ' + err.slice(0, 200);
          }

          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content || '(no response)';
          SH_EXIT = 0;
          return reply;
        } catch (e) {
          SH_EXIT = 1;
          return '\x1b[1;31mNetwork error:\x1b[0m ' + e.message;
        }
      }

      case 'npm': {
        if (args[0] === '-v' || args[0] === '--version') return '10.9.2';
        if (args[0] === 'init') {
          await FS().fsWriteFile(SHCWD + '/package.json', JSON.stringify({ name: "termux-web", version: "1.0.0", description: "", main: "index.js", scripts: { start: "node index.js" }, keywords: [], author: "", license: "ISC" }, null, 2));
          return 'Wrote to ' + SHCWD + '/package.json';
        }
        if (args[0] === 'install' || args[0] === 'i' || args[0] === 'add') {
          const global = args.includes('-g');
          const packages = args.filter(a => !a.startsWith('-') && a !== 'install' && a !== 'i' && a !== 'add');
          if (packages.length === 0) return 'npm WARN npm with no arguments\n\nUsage: npm install <package>';
          const binBase = global ? '/data/data/com.termux/files/usr/bin' : HOME + '/.local/bin';
          const libBase = global ? '/data/data/com.termux/files/usr/lib/node_modules' : SHCWD + '/node_modules';
          const results = [];
          for (const pkg of packages) {
            const name = pkg.includes('@') ? pkg.split('@')[0] : pkg;
            const version = pkg.includes('@') ? pkg.split('@')[1] : '1.0.0';
            await FS().fsWriteFile(libBase + '/' + name + '/package.json', JSON.stringify({ name, version, main: 'index.js' }, null, 2));
            await FS().fsWriteFile(libBase + '/' + name + '/index.js', 'console.log("' + name + ' v' + version + '");');
            await FS().fsWriteFile(libBase + '/' + name + '/bin/' + name, '#!/usr/bin/env node\ntry {\n  const mod = require("' + name + '");\n  if (typeof mod === "function") mod();\n} catch(e) {\n  console.error("' + name + ': " + e.message);\n  process.exit(1);\n}');
            await FS().fsWriteFile(binBase + '/' + name, '#!/usr/bin/env node\ntry {\n  const mod = require("' + name + '");\n  if (typeof mod === "function") mod();\n} catch(e) {\n  console.error("' + name + ': " + e.message);\n  process.exit(1);\n}');
            results.push('added ' + Math.floor(Math.random() * 50 + 10) + ' packages in ' + (Math.random() * 2 + 0.5).toFixed(1) + 's');
          }
          return results.join('\n');
        }
        if (args[0] === 'uninstall' || args[0] === 'rm') {
          const global = args.includes('-g');
          const packages = args.filter(a => !a.startsWith('-') && a !== 'uninstall' && a !== 'rm');
          for (const pkg of packages) {
            const libDir = global ? '/data/data/com.termux/files/usr/lib/node_modules' : SHCWD + '/node_modules';
            await FS().fsRmRecursive(libDir + '/' + pkg);
            if (global) await FS().fsDel('/data/data/com.termux/files/usr/bin/' + pkg);
          }
          return 'removed ' + packages.length + ' packages in 0.3s';
        }
        if (args[0] === 'list' || args[0] === 'ls') {
          const dir = args.includes('-g') ? '/data/data/com.termux/files/usr/lib/node_modules' : SHCWD + '/node_modules';
          const files = await FS().fsList();
          const prefix = dir + '/';
          const pkgs = files.filter(f => f.path.startsWith(prefix)).map(f => f.path.slice(prefix.length).split('/')[0]);
          const unique = [...new Set(pkgs)];
          if (unique.length === 0) return '(empty)';
          return unique.join('\n');
        }
        return 'npm <command>\n\nUsage:\nnpm install <pkg>  Install a package\nnpm uninstall <pkg> Remove a package\nnpm list           List installed packages\nnpm init           Initialize package.json\nnpm -v             Show npm version';
      }

      case 'python':
      case 'python3':
      case 'py': {
        if (args[0] === '--version' || args[0] === '-V') return 'Python 3.12.0 (web)';
        if (args[0] === '-c') {
          const code = args.slice(1).join(' ');
          try { return String(Function('return (' + code + ')')()); } catch (e) { SH_EXIT = 1; return 'SyntaxError: ' + e.message; }
        }
        return 'Python 3.12.0 (web) — limited to JavaScript eval\nUse "python -c <expr>" to evaluate expressions';
      }

      case 'php': {
        if (args[0] === '-v' || args[0] === '--version') return 'PHP 8.3.0 (web)';
        return 'PHP 8.3.0 (web) — not available in browser environment';
      }

      case 'ps': return '  PID USER          VSS RSS STAT  CMD\n    1 u0_a123     12345 6789 S     /system/bin/sh\n  123 u0_a123     23456 7890 S     ps';

      case 'top': return 'top - 12:00:00 up 1 day, 0:00, 0 users, load average: 0.00, 0.01, 0.05\nTasks:  67 total,   1 running,  66 sleeping,   0 stopped\n%Cpu(s):  0.3 us,  0.1 sy,  0.0 ni, 99.5 id,  0.0 wa\nMiB Mem:   3840.0 total,   2560.0 free,    512.0 used,    768.0 buff/cache\nMiB Swap:   960.0 total,    960.0 free,      0.0 used.   3072.0 avail Mem\n\n  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n    1 root      20   0   12345   6789   5678 S   0.0   0.2   0:00.10 sh';

      case 'free': return '              total        used        free      shared  buff/cache   available\nMem:        3932160      524288     2621440       131072      786432     3145728\nSwap:        983040           0      983040';

      case 'df': return 'Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/root        32768000  5242880  27545600  17% /';

      case 'git': {
        const sub = args[0];
        if (!sub) return 'usage: git <command> [<args>]';
        const gitDir = SHCWD + '/.git';
        const gitInit = async () => {
          await FS().fsMkdir(gitDir);
          await FS().fsMkdir(gitDir + '/objects');
          await FS().fsMkdir(gitDir + '/refs');
          await FS().fsWriteFile(gitDir + '/HEAD', 'ref: refs/heads/main\n');
          await FS().fsWriteFile(gitDir + '/config', '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n');
          await FS().fsWriteFile(gitDir + '/description', 'Unnamed repository; edit this file to name the repository.\n');
        };
        const gitReadIndex = async () => {
          const raw = await FS().fsReadFile(gitDir + '/index');
          return raw ? JSON.parse(raw) : {};
        };
        const gitWriteIndex = async (idx) => {
          await FS().fsWriteFile(gitDir + '/index', JSON.stringify(idx));
        };
        const gitReadLog = async () => {
          const raw = await FS().fsReadFile(gitDir + '/logs/main');
          return raw ? JSON.parse(raw) : [];
        };
        const gitWriteLog = async (log) => {
          await FS().fsWriteFile(gitDir + '/logs/main', JSON.stringify(log));
        };

        switch (sub) {
          case 'init': {
            const st = await FS().fsStat(gitDir);
            if (st) return 'Reinitialized existing Git repository in ' + SHCWD + '/.git/';
            await gitInit();
            return 'Initialized empty Git repository in ' + SHCWD + '/.git/';
          }
          case 'status': {
            const st = await FS().fsStat(gitDir);
            if (!st) return 'fatal: not a git repository (or any of the parent directories): .git';
            const index = await gitReadIndex();
            const log = await gitReadLog();
            const allFiles = await FS().fsList();
            const files = allFiles
              .map(f => f.path)
              .filter(p => p.startsWith(SHCWD + '/') && !p.startsWith(gitDir + '/'))
              .map(p => p.slice(SHCWD.length + 1));
            const staged = [];
            const untracked = [];
            for (const f of files) {
              const content = await FS().fsReadFile(SHCWD + '/' + f);
              if (index[f]) {
                if (index[f] !== content) staged.push('modified:   ' + f);
              } else {
                untracked.push(f);
              }
            }
            const head = log.length > 0 ? log[log.length - 1].hash.slice(0, 7) : 'HEAD';
            let out = 'On branch main\n';
            if (log.length === 0) out += 'No commits yet\n';
            out += 'Changes ' + (staged.length > 0 ? 'to be committed' : 'not staged for commit') + ':\n';
            if (staged.length === 0 && untracked.length === 0) out += '\t(nothing to commit, working tree clean)\n';
            for (const s of staged) out += '\t' + s + '\n';
            if (untracked.length > 0) {
              out += 'Untracked files:\n';
              for (const u of untracked) out += '\t' + u + '\n';
            }
            return out.trim();
          }
          case 'add': {
            const st = await FS().fsStat(gitDir);
            if (!st) return 'fatal: not a git repository';
            const index = await gitReadIndex();
            const files = args.slice(1);
            if (files.includes('.')) {
              const allFiles = await FS().fsList();
              for (const f of allFiles) {
                if (f.path.startsWith(SHCWD + '/') && !f.path.startsWith(gitDir + '/')) {
                  const rel = f.path.slice(SHCWD.length + 1);
                  const content = await FS().fsReadFile(f.path);
                  index[rel] = content;
                }
              }
            } else {
              for (const f of files) {
                const content = await FS().fsReadFile(SHCWD + '/' + f);
                if (content === null) return 'fatal: pathspec \'' + f + '\' did not match any files';
                index[f] = content;
              }
            }
            await gitWriteIndex(index);
            return '';
          }
          case 'commit': {
            const st = await FS().fsStat(gitDir);
            if (!st) return 'fatal: not a git repository';
            const msgIdx = args.indexOf('-m');
            const msg = msgIdx >= 0 ? args.slice(msgIdx + 1).join(' ').replace(/^["']|["']$/g, '') : '';
            if (!msg) return 'error: switch \'m\' requires a value';
            const index = await gitReadIndex();
            const log = await gitReadLog();
            const hash = Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join('');
            log.push({ hash, message: msg, time: new Date().toISOString(), files: Object.keys(index) });
            await gitWriteLog(log);
            await gitWriteIndex({});
            return '[main ' + hash.slice(0, 7) + '] ' + msg + '\n ' + Object.keys(index).length + ' file(s) changed';
          }
          case 'log': {
            const st = await FS().fsStat(gitDir);
            if (!st) return 'fatal: not a git repository';
            const log = await gitReadLog();
            if (log.length === 0) return 'fatal: your current branch \'main\' does not have any commits yet';
            return log.slice().reverse().map(c =>
              'commit ' + c.hash + '\nAuthor: u0_a123 <u0_a123@termux>\nDate:   ' + c.time + '\n\n    ' + c.message
            ).join('\n\n');
          }
          case 'diff': {
            const index = await gitReadIndex();
            const files = args.slice(1).filter(a => !a.startsWith('-'));
            const out = [];
            for (const f of files.length > 0 ? files : Object.keys(index)) {
              const current = await FS().fsReadFile(SHCWD + '/' + f);
              const staged = index[f];
              if (current !== staged) {
                out.push('--- a/' + f);
                out.push('+++ b/' + f);
                out.push('@@ -1 +1 @@');
                if (staged) out.push('-' + staged.split('\n')[0]);
                if (current) out.push('+' + current.split('\n')[0]);
              }
            }
            return out.length ? out.join('\n') : '';
          }
          case 'branch': return '* main';
          case 'checkout': return 'Switched to branch \'' + (args[1] || 'main') + '\'';
          case 'remote': return '';
          case 'clone': return 'Cloning into \'' + (args[1] || 'repo') + '\'...\nfatal: repository not found';
          case 'push': return 'fatal: No configured push destination.';
          case 'pull': return 'Already up to date.';
          default: return 'git: \'' + sub + '\' is not a git command.';
        }
      }
    }

    const termuxBinDir = HOME + '/.local/bin';
    const termuxBin = termuxBinDir + '/' + cmd;
    const termuxBinContent = await FS().fsReadFile(termuxBin);
    if (termuxBinContent) {
      try {
        if (window._almostnode) {
          const { vfs, runtime } = window._almostnode;
          vfs.writeFileSync('/bin-exec.js', termuxBinContent);
          let output = '';
          const origLog = console.log;
          console.log = (...a) => { output += a.join(' ') + '\n'; };
          runtime.runFile('/bin-exec.js');
          console.log = origLog;
          return output.trimEnd();
        }
        let output = '';
        const fakeConsole = { log: (...a) => { output += a.join(' ') + '\n'; }, error: (...a) => { output += a.join(' ') + '\n'; }, warn: (...a) => { output += a.join(' ') + '\n'; } };
        const fakeRequire = (m) => { throw new Error('Cannot find module \'' + m + '\''); };
        const script = termuxBinContent.replace(/^#!.*\n/, '');
        const fn = new Function('console', 'require', 'process', 'module', 'exports', '__filename', '__dirname', script);
        fn(fakeConsole, fakeRequire, { env: {}, argv: [termuxBin], exit: () => {} }, { exports: {} }, {}, termuxBin, termuxBinDir);
        return output.trimEnd();
      } catch (e) { SH_EXIT = 1; return cmd + ': ' + e.message; }
    }

    let searchDir = SHCWD;
    while (searchDir && searchDir !== '/') {
      const binPath = searchDir + '/node_modules/.bin/' + cmd;
      const binContent = await FS().fsReadFile(binPath);
      if (binContent) {
        try {
          if (window._almostnode) {
            const { vfs, runtime } = window._almostnode;
            vfs.writeFileSync('/bin-exec.js', binContent);
            let output = '';
            const origLog = console.log;
            console.log = (...a) => { output += a.join(' ') + '\n'; };
            runtime.runFile('/bin-exec.js');
            console.log = origLog;
            return output.trimEnd();
          }
          let output = '';
          const fakeConsole = { log: (...a) => { output += a.join(' ') + '\n'; }, error: (...a) => { output += a.join(' ') + '\n'; }, warn: (...a) => { output += a.join(' ') + '\n'; } };
          const fakeRequire = (m) => { throw new Error('Cannot find module \'' + m + '\''); };
          const script = binContent.replace(/^#!.*\n/, '');
          const fn = new Function('console', 'require', 'process', 'module', 'exports', '__filename', '__dirname', script);
          fn(fakeConsole, fakeRequire, { env: {}, argv: [binPath], exit: () => {} }, { exports: {} }, {}, binPath, searchDir + '/node_modules/.bin');
          return output.trimEnd();
        } catch (e) { SH_EXIT = 1; return cmd + ': ' + e.message; }
      }
      searchDir = searchDir.substring(0, searchDir.lastIndexOf('/')) || '/';
    }

    return cmd + ': command not found';
  }

  /* ===================================================================
     Pipe + Redirection
     =================================================================== */
  async function shPipe(line) {
    line = (line || '').trim();
    if (!line) return '';
    let redir = null, app = false;
    {
      let q = null, ri = -1;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '>') {
          if (i > 0 && /\d/.test(line[i - 1]) && (i < 2 || /\s/.test(line[i - 2]))) continue;
          ri = i; break;
        }
      }
      if (ri >= 0) {
        app = line[ri + 1] === '>';
        redir = line.slice(ri + (app ? 2 : 1)).trim().split(/\s+/)[0] || null;
        line = line.slice(0, ri);
      }
    }
    let stdin = null, out = '';
    const stages = shSplitTop(line, ['|']).filter((_, i) => i % 2 === 0).map(s => s.trim()).filter(Boolean);
    for (const st of stages) {
      out = await shOne(st, stdin);
      stdin = out;
    }
    if (redir) {
      const k = shResolve(shVarSub(redir));
      const prev = app ? ((await FS().fsReadFile(k)) || '') : '';
      await FS().fsWriteFile(k, app ? (prev + (prev && !prev.endsWith('\n') ? '\n' : '') + out) : out);
      return '';
    }
    return out;
  }

  /* ===================================================================
     Top-level loop: for/while/until/if, && || ;
     =================================================================== */
  async function shRun(line) {
    line = (line || '').replace(/\s*2>\s*\/dev\/null/g, '').replace(/\s*2>&1/g, '').replace(/\s*1>&2/g, '').trim();
    if (!line) return '';
    line = await shExpandSubst(line);

    const fm = line.match(/^for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+([\s\S]+?)\s*;?\s*done\s*$/);
    if (fm) {
      const v = fm[1], body = fm[3];
      let items = [];
      for (const tok of fm[2].trim().split(/\s+/)) items = items.concat(await shGlob(tok));
      const out = [];
      for (const it of items) {
        SH_VARS[v] = it;
        const o = await shRun(body);
        if (o) out.push(o);
        if (SH_BRK) { SH_BRK = false; break; }
        if (SH_CONT) SH_CONT = false;
      }
      return out.join('\n');
    }

    const wm = line.match(/^while\s+([\s\S]+?)\s*;\s*do\s+([\s\S]+?)\s*;?\s*done\s*$/);
    if (wm) {
      const out = [];
      let g = 0;
      while (g++ < 2000) {
        await shRun(wm[1]);
        if (SH_EXIT !== 0) break;
        const o = await shRun(wm[2]);
        if (o) out.push(o);
        if (SH_BRK) { SH_BRK = false; break; }
        if (SH_CONT) { SH_CONT = false; continue; }
      }
      if (g >= 2000) out.push('while: limit');
      return out.join('\n');
    }

    const um = line.match(/^until\s+([\s\S]+?)\s*;\s*do\s+([\s\S]+?)\s*;?\s*done\s*$/);
    if (um) {
      const out = [];
      let g = 0;
      while (g++ < 2000) {
        await shRun(um[1]);
        if (SH_EXIT === 0) break;
        const o = await shRun(um[2]);
        if (o) out.push(o);
        if (SH_BRK) { SH_BRK = false; break; }
        if (SH_CONT) { SH_CONT = false; continue; }
      }
      if (g >= 2000) out.push('until: limit');
      return out.join('\n');
    }

    const im = line.match(/^if\s+([\s\S]+?)\s*;\s*then\s+([\s\S]+?)(?:\s*;\s*else\s+([\s\S]+?))?\s*;?\s*fi\s*$/);
    if (im) {
      await shRun(im[1]);
      if (SH_EXIT === 0) return await shRun(im[2]);
      if (im[3]) return await shRun(im[3]);
      return '';
    }

    const parts = shSplitTop(line, ['&&', '||', ';']);
    const acc = [];
    for (let i = 0; i < parts.length; i += 2) {
      const op = parts[i - 1];
      const seg = (parts[i] || '').trim();
      if (!seg) continue;
      if (op === '&&' && SH_EXIT !== 0) continue;
      if (op === '||' && SH_EXIT === 0) continue;
      const o = await shPipe(seg);
      if (o) acc.push(o);
      if (SH_BRK || SH_CONT) break;
    }
    return acc.join('\n');
  }

  const SHELL_CMDS = new Set([
    'ls', 'cat', 'echo', 'printf', 'pwd', 'cd', 'mkdir', 'touch', 'rm', 'mv', 'cp',
    'grep', 'head', 'tail', 'wc', 'find', 'which', 'type', 'clear', 'help',
    'date', 'whoami', 'hostname', 'uname', 'id', 'env', 'export', 'unset',
    'test', '[', 'true', 'false', 'seq', 'sleep', 'break', 'continue',
    'for', 'while', 'until', 'if', 'then', 'else', 'fi', 'do', 'done', 'in',
    'sort', 'uniq', 'tr', 'cut', 'tee', 'rev', 'nl', 'tac', 'diff',
    'basename', 'dirname', 'write', 'del', 'ps', 'top', 'free', 'df',
    'pkg', 'apt', 'apt-get',
    'node', 'nodejs', 'npm', 'python', 'python3', 'py', 'php',
    'git', 'ai'
  ]);

  function init() {
    SHCWD = HOME;
  }

  return { shRun, shPrompt, init, setCwd: (d) => { SHCWD = d; }, SHELL_CMDS, HOME, PREFIX, get cwd() { return SHCWD; } };
})();

window.TermuxShell = TermuxShell;
