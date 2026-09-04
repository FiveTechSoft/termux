/* =====================================================================
   Termux Web — Midnight Commander
   Layout, colors and keys follow GNU MC default.ini + mc.default.keymap
   ===================================================================== */
'use strict';

const TermuxMC = (() => {
  const FS = () => window.TermuxFS;
  const PREFIX = '/data/data/com.termux/files/usr';
  const HOME = '/data/data/com.termux/files/home';

  /* default.ini → 16-color SGR */
  const C = {
    reset:       '\x1b[0m',
    normal:      '\x1b[37;44m',
    selected:    '\x1b[30;46m',
    marked:      '\x1b[1;33;44m',
    markselect:  '\x1b[1;33;46m',
    header:      '\x1b[1;33;44m',
    reverse:     '\x1b[30;47m',
    frame:       '\x1b[37;44m',
    dir:         '\x1b[1;37m',
    exec:        '\x1b[1;32m',
    symlink:     '\x1b[37m',
    device:      '\x1b[1;35m',
    stale:       '\x1b[1;31m',
    file:        '\x1b[37m',
    menu:        '\x1b[1;37;46m',
    menuHot:     '\x1b[1;33;46m',
    menuSel:     '\x1b[1;37;40m',
    menuHotSel:  '\x1b[1;33;40m',
    menuInact:   '\x1b[30;46m',
    bbHot:       '\x1b[1;37m\x1b[40m',
    bbBtn:       '\x1b[30m\x1b[46m',
    dlg:         '\x1b[30;47m',
    dlgTitle:    '\x1b[1;34;47m',
    dlgFocus:    '\x1b[30;46m',
    dlgHot:      '\x1b[34;47m',
    dlgHotFocus: '\x1b[34;46m',
    shadow:      '\x1b[0;90;40m',
    status:      '\x1b[30;46m',
    input:       '\x1b[30;46m',
    error:       '\x1b[1;37;41m',
    view:        '\x1b[37;44m',
    help:        '\x1b[30;47m',
    helpTitle:   '\x1b[1;34;47m',
    editorBar:   '\x1b[1;37;41m',
  };

  const L = {
    h: '─', v: '│',
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    tm: '┬', bm: '┴', lm: '├', rm: '┤', x: '┼',
  };

  const HINTS = [
    'Hint: Insert tags files. + selects a group. * reverses the selection.',
    'Hint: C-u swaps panels. C-r rereads the directory.',
    'Hint: M-c quick cd. C-s incremental search in the panel.',
    'Hint: Tab changes panel. F9 opens the menu. F10 quits.',
    'Hint: F3 view, F4 edit, F5 copy, F6 rename/move, F7 mkdir, F8 delete.',
    'Hint: Type a command below and press Enter to run it.',
    'Hint: Backspace goes to the parent directory. Left/Right are Lynx-like.',
    'Hint: Alt-. toggles hidden files. Alt-o opens the dir in the other panel.',
    'Hint: F2 user menu. Double-click or Enter opens a file or directory.',
  ];

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function newPanel(path) {
    return {
      path,
      files: [],
      cursor: 0,
      scroll: 0,
      selected: new Set(),
      sort: 'name',
      sortDir: 1,
      filter: '',
      history: [],
    };
  }

  let term = null;
  let left = newPanel(HOME);
  let right = newPanel(PREFIX);
  let activePanel = 'left';
  let statusMsg = '';
  let running = false;
  let resolveExit = null;
  let showHidden = false;
  let lynxLike = true;
  let mixFiles = false;
  let cmdLine = '';
  let cmdHistory = [];
  let cmdHistIdx = -1;
  let searchMode = false;
  let searchStr = '';
  let hintIdx = 0;
  let keyModal = null;
  let mouseModal = null;
  let shellMode = false;
  let shellBuf = '';
  let shellBusy = false;

  function panel() { return activePanel === 'left' ? left : right; }
  function otherPanel() { return activePanel === 'left' ? right : left; }

  function visLen(s) {
    return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
  }

  function clip(str, len) {
    str = String(str);
    if (str.length <= len) return str;
    if (len <= 1) return str.slice(0, len);
    return str.slice(0, len - 1) + '~';
  }

  function clipPad(str, len) {
    const plain = String(str).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    if (plain.length === len) return str;
    if (plain.length < len) return str + ' '.repeat(len - plain.length);
    let out = '', n = 0, i = 0;
    const s = String(str);
    while (i < s.length && n < len) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z]/);
        if (m) { out += m[0]; i += m[0].length; continue; }
      }
      out += s[i++];
      n++;
    }
    return out;
  }

  function pad(str, len) { return clipPad(str, len); }

  function truncPath(p) {
    if (p === HOME) return '~';
    if (p.startsWith(HOME + '/')) return '~' + p.slice(HOME.length);
    return p;
  }

  function isDir(entry) {
    return entry && (entry.type === 'dir' || entry.isParent);
  }

  function classifyFile(entry) {
    if (!entry || entry.isParent) return 'parent';
    if (isDir(entry)) return 'dir';
    if (entry.type === 'symlink') return 'symlink';
    if (entry.type === 'block' || entry.type === 'char') return 'device';
    const name = entry.name || '';
    const ext = name.split('.').pop().toLowerCase();
    const executableExts = ['sh','bash','zsh','py','pyc','js','mjs','ts','rb','pl','php','lua','ex','exs','fish'];
    const execBase = ['configure','Makefile','Rakefile','Gemfile'];
    if (executableExts.includes(ext) || execBase.includes(name)) return 'executable';
    return 'file';
  }

  function fileColor(entry) {
    switch (classifyFile(entry)) {
      case 'parent':
      case 'dir':        return C.dir;
      case 'executable': return C.exec;
      case 'symlink':    return C.symlink;
      case 'device':     return C.device;
      default:           return C.file;
    }
  }

  function formatSize(bytes, w) {
    w = w || 7;
    if (bytes == null || isNaN(bytes)) return ' '.repeat(w);
    if (bytes < 10000000) return String(bytes).padStart(w);
    if (bytes < 1048576) return (bytes / 1024).toFixed(1).padStart(w - 1) + 'K';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1).padStart(w - 1) + 'M';
    return (bytes / 1073741824).toFixed(1).padStart(w - 1) + 'G';
  }

  function formatMTime(ms) {
    if (!ms) return '            ';
    const d = new Date(ms);
    const mon = MONTHS[d.getMonth()];
    const day = String(d.getDate()).padStart(2, ' ');
    const now = new Date();
    if (d.getFullYear() === now.getFullYear()) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return (mon + ' ' + day + ' ' + hh + ':' + mm).padEnd(12).slice(0, 12);
    }
    return (mon + ' ' + day + '  ' + d.getFullYear()).padEnd(12).slice(0, 12);
  }

  function formatPermissions(entry) {
    if (!entry || entry.isParent) return 'drwxr-xr-x';
    if (isDir(entry)) return 'drwxr-xr-x';
    if (classifyFile(entry) === 'executable') return '-rwxr-xr-x';
    if (classifyFile(entry) === 'symlink') return 'lrwxrwxrwx';
    return '-rw-r--r--';
  }

  function entryName(entry) {
    if (!entry) return '';
    if (entry.isParent) return '/..';
    if (isDir(entry)) return '/' + entry.name;
    return ' ' + entry.name;
  }

  function globToRe(pat) {
    const s = String(pat || '*')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp('^' + s + '$', 'i');
  }

  function joinPath(dir, name) {
    if (dir === '/') return '/' + name;
    return dir.endsWith('/') ? dir + name : dir + '/' + name;
  }

  function parentPath(p) {
    if (p === '/') return '/';
    const parts = p.split('/').filter(Boolean);
    parts.pop();
    return parts.length ? '/' + parts.join('/') : '/';
  }

  function layout() {
    const cols = term.cols;
    const rows = term.rows;
    const showHint = rows >= 16;
    const menuR = 0;
    const keyR = rows - 1;
    const cmdR = rows - 2;
    const hintR = showHint ? rows - 3 : -1;
    const panelTop = 1;
    const panelBot = showHint ? rows - 4 : rows - 3;
    const headerR = panelTop + 1;
    const sepR = panelBot - 2;
    const miniR = panelBot - 1;
    const fileTop = panelTop + 2;
    const fileBot = panelBot - 3;
    const fileRows = Math.max(1, fileBot - fileTop + 1);
    const leftW = Math.floor(cols / 2);
    const rightW = cols - leftW;
    return {
      cols, rows, showHint,
      menuR, panelTop, panelBot, headerR, sepR, miniR, fileTop, fileBot, fileRows,
      keyR, cmdR, hintR, leftW, rightW,
      leftInner: leftW - 2,
      rightInner: rightW - 1,
    };
  }

  function panelCols(innerW) {
    const sizeW = 8;
    const timeW = 12;
    if (innerW >= 10 + sizeW + timeW) {
      return { nameW: innerW - sizeW - timeW - 1, sizeW, timeW, showTime: true, showSize: true };
    }
    if (innerW >= 12 + sizeW) {
      return { nameW: innerW - sizeW - 1, sizeW, timeW: 0, showTime: false, showSize: true };
    }
    return { nameW: innerW, sizeW: 0, timeW: 0, showTime: false, showSize: false };
  }

  async function listDir(dirPath, pstate) {
    const items = await FS().fsList();
    const entries = [];
    if (dirPath !== '/') {
      entries.push({ name: '..', display: '/..', type: 'dir', size: 0, mtime: 0, isParent: true });
    }
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const seen = new Set();
    for (const item of items) {
      if (item.path === dirPath) continue;
      if (!item.path.startsWith(prefix)) continue;
      const rel = item.path.slice(prefix.length);
      if (!rel) continue;
      const slashIdx = rel.indexOf('/');
      const name = slashIdx === -1 ? rel : rel.slice(0, slashIdx);
      if (seen.has(name)) continue;
      seen.add(name);
      if (name === '.keep') continue;
      if (!showHidden && name.startsWith('.')) continue;
      const isDirEntry = item.type === 'directory' || item.type === 'dir' || slashIdx !== -1;
      if (pstate && pstate.filter) {
        try {
          if (!globToRe(pstate.filter).test(name) && !isDirEntry) continue;
        } catch (_) { /* keep */ }
      }
      let size = 0;
      if (!isDirEntry) {
        const c = item.content;
        size = c == null ? 0 : (typeof c === 'string' ? c.length : (c.length || 0));
      }
      entries.push({
        name,
        display: (isDirEntry ? '/' : ' ') + name,
        type: isDirEntry ? 'dir' : (item.type === 'symlink' ? 'symlink' : 'file'),
        size,
        mtime: item.mtime || 0,
      });
    }
    const sort = (pstate && pstate.sort) || 'name';
    const dirn = (pstate && pstate.sortDir) || 1;
    entries.sort((a, b) => {
      if (a.isParent) return -1;
      if (b.isParent) return 1;
      if (!mixFiles) {
        const aDir = a.type === 'dir';
        const bDir = b.type === 'dir';
        if (aDir !== bDir) return aDir ? -1 : 1;
      }
      let cmp = 0;
      if (sort === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (sort === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
      else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return cmp * dirn;
    });
    return entries;
  }

  async function refreshPanel(p) {
    const prevName = p.files[p.cursor] ? p.files[p.cursor].name : null;
    p.files = await listDir(p.path, p);
    if (prevName) {
      const idx = p.files.findIndex(e => e.name === prevName);
      if (idx >= 0) p.cursor = idx;
    }
    if (p.cursor >= p.files.length) p.cursor = Math.max(0, p.files.length - 1);
    if (p.cursor < 0) p.cursor = 0;
    const names = new Set(p.files.map(f => f.name));
    p.selected = new Set([...p.selected].filter(n => names.has(n)));
  }

  async function refreshPanelsKeepSel() {
    await Promise.all([refreshPanel(left), refreshPanel(right)]);
  }

  const BUTTONBAR_LABELS_NUM = 10;
  function bbButtonWidths(cols) {
    if (cols < BUTTONBAR_LABELS_NUM * 7) {
      const n = Math.floor(cols / 7);
      return Array.from({ length: BUTTONBAR_LABELS_NUM }, (_, i) => (i < n ? 7 : 0));
    }
    const dv = Math.floor(cols / BUTTONBAR_LABELS_NUM);
    const md = cols % BUTTONBAR_LABELS_NUM;
    const widths = [];
    for (let i = 0; i < BUTTONBAR_LABELS_NUM; i++) widths.push(dv + (i < md ? 1 : 0));
    return widths;
  }

  function drawButtonBar(keys, cols) {
    const widths = bbButtonWidths(cols);
    let out = '';
    for (let i = 0; i < BUTTONBAR_LABELS_NUM; i++) {
      const w = widths[i];
      if (w <= 0) continue;
      const [num, label] = keys[i];
      const numText = String(num).padStart(2, ' ');
      let labelText = label.slice(0, Math.max(0, w - 2));
      if (labelText.length < w - 2) labelText += ' '.repeat(w - 2 - labelText.length);
      out += C.bbHot + numText + C.bbBtn + labelText;
    }
    const stripped = visLen(out);
    out += C.bbBtn + ' '.repeat(Math.max(0, cols - stripped));
    out += C.reset;
    return out;
  }

  function makeTop(path, w, active, lch, rch) {
    let label = path;
    const inner = w - 2;
    const maxLabel = Math.max(1, inner - 3);
    if (label.length > maxLabel) label = label.slice(0, Math.max(1, maxLabel - 1)) + '~';
    const lab = ' ' + label + ' ';
    const dashAfter = Math.max(0, inner - 1 - lab.length);
    const leftPart = lch + L.h;
    const rightDashes = L.h.repeat(dashAfter) + rch;
    if (active) return C.frame + leftPart + C.reverse + lab + C.frame + rightDashes;
    return C.frame + leftPart + lab + rightDashes;
  }

  function makeH(w, lch, rch) {
    return C.frame + lch + L.h.repeat(Math.max(0, w - 2)) + rch;
  }

  function sortMark(p, field) {
    if (p.sort !== field) return ' ';
    return p.sortDir >= 0 ? "'" : '.';
  }

  function headerLine(p, innerW) {
    const col = panelCols(innerW);
    const mark = sortMark(p, col.showTime && p.sort === 'mtime' ? 'mtime'
      : (col.showSize && p.sort === 'size' ? 'size' : 'name'));
    let s = mark;
    if (p.sort === 'name') s += 'n';
    else if (p.sort === 'size') s += 's';
    else s += 'm';
    s += ' Name';
    s = s.padEnd(col.nameW).slice(0, col.nameW);
    if (col.showSize) s += 'Size'.padStart(col.sizeW);
    if (col.showTime) s += (' ' + 'Modify time'.slice(0, col.timeW)).padStart(col.timeW + 1);
    return C.header + clipPad(s, innerW);
  }

  function fileLine(p, innerW, row, isActive) {
    const col = panelCols(innerW);
    const idx = row + p.scroll;
    if (idx >= p.files.length) return C.normal + ' '.repeat(innerW);
    const e = p.files[idx];
    const isCur = isActive && idx === p.cursor;
    const isMark = p.selected.has(e.name);
    let bg = C.normal;
    if (isCur && isMark) bg = C.markselect;
    else if (isCur) bg = C.selected;
    else if (isMark) bg = C.marked;

    let name = clip(entryName(e), col.nameW).padEnd(col.nameW);
    let size = '';
    if (col.showSize) {
      size = e.isParent ? 'UP--DIR'.padStart(col.sizeW) : formatSize(e.size, col.sizeW);
    }
    let time = '';
    if (col.showTime) time = ' ' + formatMTime(e.mtime);
    let body = (name + size + time).padEnd(innerW);
    if (body.length > innerW) body = body.slice(0, innerW);

    if (isCur || isMark) return bg + body;
    return bg + fileColor(e) + body;
  }

  function miniLine(p, innerW, isActive) {
    if (searchMode && isActive) {
      return C.input + clipPad(' Search: ' + searchStr + '_', innerW);
    }
    const e = p.files[p.cursor];
    if (!e) return C.normal + ' '.repeat(innerW);
    const perm = formatPermissions(e);
    const size = e.isParent ? 'UP--DIR' : String(e.size || 0);
    const txt = perm + '  1 user     user ' + size.padStart(8) + ' ' + formatMTime(e.mtime) + ' ' + e.name;
    return C.normal + clipPad(txt, innerW);
  }

  function drawMenuBar(ly) {
    const items = ['Left', 'File', 'Command', 'Options', 'Right'];
    let s = C.menu;
    for (const m of items) {
      s += ' ' + C.menuHot + m[0] + C.menu + m.slice(1) + ' ';
    }
    return clipPad(s, ly.cols) + C.reset;
  }

  function panelKeys() {
    return [
      ['1', 'Help'], ['2', 'Menu'], ['3', 'View'], ['4', 'Edit'],
      ['5', 'Copy'], ['6', 'RenMov'], ['7', 'Mkdir'], ['8', 'Delete'],
      ['9', 'PullDn'], ['10', 'Quit']
    ];
  }

  function render() {
    if (!term) return;
    const ly = layout();
    const lines = new Array(ly.rows);
    const leftAct = activePanel === 'left';

    lines[ly.menuR] = drawMenuBar(ly);

    lines[ly.panelTop] =
      makeTop(truncPath(left.path), ly.leftW, leftAct, L.tl, L.tm) +
      makeTop(truncPath(right.path), ly.rightW, !leftAct, L.h, L.tr) + C.reset;

    lines[ly.headerR] =
      C.frame + L.v + headerLine(left, ly.leftInner) +
      C.frame + L.v + headerLine(right, ly.rightInner) +
      C.frame + L.v + C.reset;

    for (let i = 0; i < ly.fileRows; i++) {
      lines[ly.fileTop + i] =
        C.frame + L.v + fileLine(left, ly.leftInner, i, leftAct) +
        C.frame + L.v + fileLine(right, ly.rightInner, i, !leftAct) +
        C.frame + L.v + C.reset;
    }

    lines[ly.sepR] =
      makeH(ly.leftW, L.lm, L.x) + makeH(ly.rightW, L.h, L.rm) + C.reset;

    lines[ly.miniR] =
      C.frame + L.v + miniLine(left, ly.leftInner, leftAct) +
      C.frame + L.v + miniLine(right, ly.rightInner, !leftAct) +
      C.frame + L.v + C.reset;

    lines[ly.panelBot] =
      makeH(ly.leftW, L.bl, L.bm) + makeH(ly.rightW, L.h, L.br) + C.reset;

    if (ly.showHint) {
      const hint = statusMsg ? statusMsg : HINTS[hintIdx % HINTS.length];
      lines[ly.hintR] = C.reset + clipPad(hint, ly.cols);
    }

    const prompt = truncPath(panel().path) + '$ ';
    const cmd = clipPad(prompt + cmdLine, ly.cols);
    lines[ly.cmdR] = C.reset + cmd;

    lines[ly.keyR] = drawButtonBar(panelKeys(), ly.cols);

    for (let r = 0; r < ly.rows; r++) {
      if (!lines[r]) lines[r] = C.reset + ' '.repeat(ly.cols);
    }

    let out = '\x1b[2J\x1b[H\x1b[?25l';
    out += lines.join('\r\n');
    if (cmdLine.length > 0 && !searchMode) {
      const col = Math.min(ly.cols, visLen(prompt) + cmdLine.length + 1);
      out += '\x1b[' + (ly.cmdR + 1) + ';' + col + 'H\x1b[?25h';
    }
    term.write(out);
  }

  function matchFnKey(data) {
    if (data.length === 3 && data[0] === '\x1b' && data[1] === 'O') {
      const fNum = data.charCodeAt(2) - 80;
      if (fNum >= 1 && fNum <= 4) return fNum;
    }
    if (data.startsWith('\x1b[')) {
      const m = data.match(/^\x1b\[(\d+)~$/);
      if (m) {
        const fMap = { 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 17: 6, 18: 7, 19: 8, 20: 9, 21: 10, 23: 11, 24: 12 };
        return fMap[parseInt(m[1], 10)] || 0;
      }
    }
    return 0;
  }

  function matchAlt(data) {
    if (data.length === 2 && data[0] === '\x1b' && data[1] !== '[' && data[1] !== 'O') return data[1];
    return null;
  }

  function parseSgrMouse(data) {
    const m = String(data).match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
    if (!m) return null;
    return {
      btn: parseInt(m[1], 10),
      col: Math.max(0, parseInt(m[2], 10) - 1),
      row: Math.max(0, parseInt(m[3], 10) - 1),
      press: m[4] === 'M',
    };
  }

  function handleSgrMouse(m) {
    if (!running || shellMode) return;
    if (!m.press) return;
    if (m.btn >= 64) {
      if (keyModal && !mouseModal) return;
      const ly = layout();
      const want = m.col < ly.leftW ? 'left' : 'right';
      if (activePanel !== want) activePanel = want;
      const delta = m.btn === 64 ? -3 : 3;
      const p = panel();
      p.cursor = Math.max(0, Math.min(p.files.length - 1, p.cursor + delta));
      ensureVisible(p);
      render();
      return;
    }
    if (m.btn & 32) return;
    const button = m.btn & 3;
    if (keyModal && !mouseModal) return;
    if (button === 2) {
      const ly = layout();
      if (m.row >= ly.fileTop && m.row <= ly.fileBot) handleFnKey(2);
      return;
    }
    if (button === 0) {
      handleCellClick(m.row, m.col);
      focusTerm();
    }
  }

  function shellPromptStr() {
    if (window.TermuxShell && typeof window.TermuxShell.shPrompt === 'function') {
      return window.TermuxShell.shPrompt();
    }
    return truncPath(panel().path) + '$ ';
  }

  function enterShellMode() {
    shellMode = true;
    shellBuf = '';
    shellBusy = false;
    sgrTracking = false;
    if (window.TermuxShell) window.TermuxShell.setCwd(panel().path);
    term.write('\x1b[?1002l\x1b[?1000l\x1b[?1006l');
    term.write('\x1b[?1049l\x1b[?25h\x1b[0m');
    term.write('\r\n' + shellPromptStr());
    focusTerm();
  }

  function leaveShellMode() {
    if (!shellMode) return;
    shellMode = false;
    shellBuf = '';
    term.write('\x1b[?1049h\x1b[?1006h\x1b[?1000h\x1b[?1002h');
    sgrTracking = true;
    refreshPanelsKeepSel().then(() => { render(); focusTerm(); });
  }

  function handleShellKey(data) {
    if (data === '\x0f') { leaveShellMode(); return; }
    if (shellBusy) return;
    if (data === '\x03') {
      shellBuf = '';
      term.write('^C\r\n' + shellPromptStr());
      return;
    }
    if (data === '\x0c') {
      shellBuf = '';
      term.write('\x1b[2J\x1b[H\x1b[0m\x1b[?25h' + shellPromptStr());
      return;
    }
    if (data === '\r' || data === '\n') {
      const cmd = shellBuf;
      shellBuf = '';
      term.write('\r\n');
      runShellLine(cmd);
      return;
    }
    if (data === '\x7f' || data === '\b') {
      if (!shellBuf.length) return;
      shellBuf = shellBuf.slice(0, -1);
      term.write('\b \b');
      return;
    }
    if (data === '\x1b[A') {
      if (!cmdHistory.length) return;
      if (cmdHistIdx < 0) cmdHistIdx = cmdHistory.length - 1;
      else cmdHistIdx = Math.max(0, cmdHistIdx - 1);
      rewriteShellLine(cmdHistory[cmdHistIdx] || '');
      return;
    }
    if (data === '\x1b[B') {
      if (cmdHistIdx < 0) return;
      cmdHistIdx = Math.min(cmdHistory.length - 1, cmdHistIdx + 1);
      rewriteShellLine(cmdHistIdx >= cmdHistory.length ? '' : (cmdHistory[cmdHistIdx] || ''));
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      shellBuf += data;
      term.write(data);
    }
  }

  function rewriteShellLine(s) {
    const n = shellBuf.length;
    if (n) term.write('\b'.repeat(n) + ' '.repeat(n) + '\b'.repeat(n));
    shellBuf = s;
    term.write(s);
  }

  async function runShellLine(cmd) {
    cmd = String(cmd || '').trim();
    if (!cmd) {
      if (shellMode) term.write(shellPromptStr());
      return;
    }
    cmdHistory.push(cmd);
    cmdHistIdx = -1;
    if (cmd === 'exit') { leaveShellMode(); return; }
    shellBusy = true;
    try {
      if (window.TermuxShell) {
        const out = await window.TermuxShell.shRun(cmd);
        if (out && out !== '\x1b]termux:mc\x07' && out !== '\x1b]termux:opencode\x07') {
          term.write(String(out).replace(/\n/g, '\r\n'));
          if (!String(out).endsWith('\n')) term.write('\r\n');
        }
      }
    } catch (e) {
      term.write(String(e.message || e) + '\r\n');
    }
    shellBusy = false;
    if (shellMode) {
      term.write(shellPromptStr());
      focusTerm();
    }
  }

  function handleKey(data) {
    const sgr = parseSgrMouse(data);
    if (sgr) { handleSgrMouse(sgr); return; }
    if (data.length === 6 && data[0] === '\x1b' && data[1] === '[' && data[2] === 'M') {
      const b = data.charCodeAt(3) - 32;
      handleSgrMouse({
        btn: b,
        col: data.charCodeAt(4) - 33,
        row: data.charCodeAt(5) - 33,
        press: (b & 3) !== 3,
      });
      return;
    }
    /* Application-cursor (SS3) → CSI so arrows work after DECSET 1049/smcup. */
    if (data.length === 3 && data[0] === '\x1b' && data[1] === 'O') {
      const app = { A: '\x1b[A', B: '\x1b[B', C: '\x1b[C', D: '\x1b[D', H: '\x1b[H', F: '\x1b[F' };
      if (app[data[2]]) data = app[data[2]];
    }
    if (data === '\x0f') {
      if (keyModal) return;
      if (shellMode) leaveShellMode();
      else enterShellMode();
      return;
    }
    if (shellMode) { handleShellKey(data); return; }
    if (keyModal) { keyModal(data); return; }
    if (!running) return;

    if (searchMode) {
      handleSearchKey(data);
      return;
    }

    const fk = matchFnKey(data);
    if (fk >= 1 && fk <= 10) { handleFnKey(fk); return; }

    const alt = matchAlt(data);
    if (alt !== null) {
      handleAlt(alt);
      return;
    }

    if (data.startsWith('\x1b[')) {
      const m = data.match(/^\x1b\[(\d+)(?:;(\d+))?~/);
      if (m) {
        const fNum = parseInt(m[1], 10);
        const mod = parseInt(m[2] || '0', 10);
        if (fNum === 3 && !m[2]) { handleFnKey(8); return; }
        if (fNum === 2 && !m[2]) { toggleSelect(true); return; }
        if (fNum === 5) { moveCursor(-(layout().fileRows)); return; }
        if (fNum === 6) { moveCursor(layout().fileRows); return; }
        if (fNum === 1) { goToFirst(); return; }
        if (fNum === 4) { goToLast(); return; }
        if (mod === 2) {
          if (fNum === 1) { toggleSelect(false); moveCursor(-1); return; }
          if (fNum === 2) { toggleSelect(false); moveCursor(1); return; }
        }
      }
      if (data === '\x1b[A') { moveCursor(-1); return; }
      if (data === '\x1b[B') { moveCursor(1); return; }
      if (data === '\x1b[C') {
        if (lynxLike) enterDirectory();
        return;
      }
      if (data === '\x1b[D') {
        if (lynxLike) goToParent();
        return;
      }
      if (data === '\x1b[H') { goToFirst(); return; }
      if (data === '\x1b[F') { goToLast(); return; }
      if (data === '\x1b[1;2A') { toggleSelect(false); moveCursor(-1); return; }
      if (data === '\x1b[1;2B') { toggleSelect(false); moveCursor(1); return; }
      return;
    }

    if (data === '\r' || data === '\n') {
      if (cmdLine.length) { executeCommand(cmdLine); cmdLine = ''; return; }
      enterDirectory();
      return;
    }
    if (data === '\t') { switchPanel(); return; }
    if (data === '\x7f' || data === '\b') {
      if (cmdLine.length) { cmdLine = cmdLine.slice(0, -1); render(); return; }
      goToParent();
      return;
    }

    if (data === '\x01') { goToFirst(); return; }
    if (data === '\x05') { goToLast(); return; }
    if (data === '\x0e') { moveCursor(1); return; }
    if (data === '\x10') { moveCursor(-1); return; }
    if (data === '\x12') { refreshPanel(panel()).then(render); return; }
    if (data === '\x13') { startSearch(); return; }
    if (data === '\x14') { toggleSelect(false); render(); return; }
    if (data === '\x15') { swapPanels(); return; }
    if (data === '\x18') { /* Ctrl-X prefix ignored as chord */ return; }

    if (data === '+') { selectGroup('select'); return; }
    if (data === '-') { selectGroup('unselect'); return; }
    if (data === '*') { invertSelection(); return; }

    if (data === '\x1b') {
      if (cmdLine.length) { cmdLine = ''; render(); }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      cmdLine += data;
      render();
    }
  }

  function handleAlt(ch) {
    const c = ch.toLowerCase();
    if (c === 'c') { promptCommand('cd', 'Quick cd'); return; }
    if (c === 's') { startSearch(); return; }
    if (c === '.') { showHidden = !showHidden; refreshPanelsKeepSel().then(render); return; }
    if (c === 'i') {
      const o = otherPanel();
      o.path = panel().path;
      o.cursor = 0; o.scroll = 0; o.selected.clear();
      refreshPanel(o).then(render);
      return;
    }
    if (c === 'o') {
      const p = panel();
      const e = p.files[p.cursor];
      if (e && isDir(e) && !e.isParent) {
        const o = otherPanel();
        o.path = joinPath(p.path, e.name);
        o.cursor = 0; o.scroll = 0; o.selected.clear();
        refreshPanel(o).then(render);
      }
      return;
    }
    if (c === 'p') {
      if (!cmdHistory.length) return;
      if (cmdHistIdx < 0) cmdHistIdx = cmdHistory.length - 1;
      else cmdHistIdx = Math.max(0, cmdHistIdx - 1);
      cmdLine = cmdHistory[cmdHistIdx];
      render();
      return;
    }
    if (c === 'n') {
      if (!cmdHistory.length) return;
      cmdHistIdx = Math.min(cmdHistory.length - 1, cmdHistIdx + 1);
      cmdLine = cmdHistory[cmdHistIdx] || '';
      render();
      return;
    }
    if (c === 'h') { showHelp(); return; }
    if (c >= '1' && c <= '9') { handleFnKey(c.charCodeAt(0) - 48); return; }
    if (c === '0') { handleFnKey(10); return; }
  }

  function handleSearchKey(data) {
    if (data === '\x1b' || matchFnKey(data) === 10) {
      searchMode = false; searchStr = ''; render(); return;
    }
    if (data === '\r' || data === '\n') {
      searchMode = false; render(); return;
    }
    if (data === '\x7f' || data === '\b') {
      searchStr = searchStr.slice(0, -1);
      jumpSearch();
      render();
      return;
    }
    if (data === '\x13' || matchAlt(data) === 's') {
      jumpSearch(true);
      render();
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      searchStr += data;
      jumpSearch();
      render();
    }
  }

  function startSearch() {
    searchMode = true;
    searchStr = '';
    render();
  }

  function jumpSearch(next) {
    const p = panel();
    const q = searchStr.toLowerCase();
    if (!q) return;
    let start = next ? p.cursor + 1 : 0;
    for (let k = 0; k < p.files.length; k++) {
      const i = (start + k) % p.files.length;
      if ((p.files[i].name || '').toLowerCase().startsWith(q)) {
        p.cursor = i;
        ensureVisible(p);
        return;
      }
    }
  }

  async function handleFnKey(num) {
    switch (num) {
      case 1: showHelp(); break;
      case 2: await showUserMenu(); break;
      case 3: await viewFile(); break;
      case 4: await editFile(); break;
      case 5: await copyFiles(); break;
      case 6: await moveFiles(); break;
      case 7: await makeDirectory(); break;
      case 8: await deleteFiles(); break;
      case 9: await showPullDownMenu(); break;
      case 10: quit(); break;
    }
  }

  function moveCursor(delta) {
    const p = panel();
    p.cursor = Math.max(0, Math.min(p.files.length - 1, p.cursor + delta));
    ensureVisible(p);
    hintIdx++;
    render();
  }

  function goToFirst() {
    const p = panel();
    p.cursor = 0; p.scroll = 0;
    render();
  }

  function goToLast() {
    const p = panel();
    p.cursor = Math.max(0, p.files.length - 1);
    ensureVisible(p);
    render();
  }

  function ensureVisible(p) {
    if (!term) return;
    const viewRows = layout().fileRows;
    if (p.cursor < p.scroll) p.scroll = p.cursor;
    else if (p.cursor >= p.scroll + viewRows) p.scroll = p.cursor - viewRows + 1;
  }

  function switchPanel() {
    activePanel = activePanel === 'left' ? 'right' : 'left';
    render();
  }

  async function swapPanels() {
    const tmp = left;
    left = right;
    right = tmp;
    render();
  }

  function toggleSelect(moveDown) {
    const p = panel();
    const e = p.files[p.cursor];
    if (!e || e.isParent) {
      if (moveDown) moveCursor(1);
      return;
    }
    if (p.selected.has(e.name)) p.selected.delete(e.name);
    else p.selected.add(e.name);
    if (moveDown) moveCursor(1);
    else render();
  }

  function invertSelection() {
    const p = panel();
    for (const f of p.files) {
      if (f.isParent || isDir(f)) continue;
      if (p.selected.has(f.name)) p.selected.delete(f.name);
      else p.selected.add(f.name);
    }
    render();
  }

  async function selectGroup(mode) {
    const pat = await promptInput(mode === 'select' ? 'Select: ' : 'Unselect: ', '*');
    if (pat == null) { render(); return; }
    const re = globToRe(pat);
    const p = panel();
    for (const f of p.files) {
      if (f.isParent) continue;
      if (re.test(f.name)) {
        if (mode === 'select') p.selected.add(f.name);
        else p.selected.delete(f.name);
      }
    }
    render();
  }

  function pushHist(p, path) {
    if (p.history[p.history.length - 1] !== path) p.history.push(path);
    if (p.history.length > 32) p.history.shift();
  }

  async function enterDirectory() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry) return;
    if (entry.isParent) { goToParent(); return; }
    if (isDir(entry)) {
      pushHist(p, p.path);
      p.path = joinPath(p.path, entry.name);
      p.cursor = 0; p.scroll = 0; p.selected.clear();
      await refreshPanel(p);
      render();
    } else {
      await viewFile();
    }
  }

  function goToParent() {
    const p = panel();
    if (p.path === '/') return;
    const leftName = p.path.split('/').filter(Boolean).pop();
    pushHist(p, p.path);
    p.path = parentPath(p.path);
    p.selected.clear();
    refreshPanel(p).then(() => {
      const idx = p.files.findIndex(e => e.name === leftName);
      p.cursor = idx >= 0 ? idx : 0;
      ensureVisible(p);
      render();
    });
  }

  async function chdirPanel(p, target) {
    if (target === '~') target = HOME;
    else if (target.startsWith('~/')) target = HOME + target.slice(1);
    else if (target === '-') target = p.history[p.history.length - 1] || p.path;
    else if (!target.startsWith('/')) target = joinPath(p.path, target);
    pushHist(p, p.path);
    p.path = target.replace(/\/+$/, '') || '/';
    p.cursor = 0; p.scroll = 0; p.selected.clear();
    await refreshPanel(p);
    render();
  }

  async function getSelectedFiles() {
    const p = panel();
    if (p.selected.size > 0) {
      return p.files.filter(f => p.selected.has(f.name) && !f.isParent);
    }
    const entry = p.files[p.cursor];
    if (entry && !entry.isParent) return [entry];
    return [];
  }

  async function waitKey() {
    return new Promise(resolve => {
      keyModal = (data) => { keyModal = null; resolve(data); };
    });
  }

  async function executeCommand(cmd) {
    cmd = cmd.trim();
    if (!cmd) return;
    cmdHistory.push(cmd);
    cmdHistIdx = -1;
    if (cmd === 'exit' || cmd === 'quit') { quit(); return; }
    term.write('\x1b[2J\x1b[H\x1b[0m\x1b[?25h');
    term.write('$ ' + cmd + '\r\n');
    try {
      if (window.TermuxShell) {
        window.TermuxShell.setCwd(panel().path);
        const out = await window.TermuxShell.shRun(cmd);
        if (out && out !== '\x1b]termux:mc\x07') {
          term.write(String(out).replace(/\n/g, '\r\n'));
          if (!String(out).endsWith('\n')) term.write('\r\n');
        }
      } else {
        term.write('mc: no shell\r\n');
      }
    } catch (e) {
      term.write('mc: ' + e.message + '\r\n');
    }
    term.write('\r\nPress any key to continue...');
    await waitKey();
    await refreshPanelsKeepSel();
    render();
  }

  async function viewFile() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry || isDir(entry)) return;
    const filePath = joinPath(p.path, entry.name);
    const content = await FS().fsReadFile(filePath);
    if (content == null) {
      statusMsg = 'Cannot read file';
      render();
      return;
    }
    await showViewer(entry.name, typeof content === 'string' ? content : new TextDecoder().decode(content));
  }

  async function showViewer(title, content, helpMode) {
    const cols = term.cols;
    const rows = term.rows;
    const lines = String(content).split('\n');
    let scroll = 0;
    const viewRows = rows - 2;
    const bg = helpMode ? C.help : C.view;

    function drawViewer() {
      let v = '\x1b[2J\x1b[H\x1b[?25l';
      v += (helpMode ? C.helpTitle : C.status) + C.reset;
      const head = helpMode
        ? pad(' ' + title, cols)
        : pad(' ' + title + '   [ascii]   ' + content.length + ' bytes', cols);
      v += (helpMode ? C.helpTitle : C.status) + head + C.reset;
      for (let i = 0; i < viewRows; i++) {
        v += '\r\n' + bg;
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          let line = lines[lineIdx].replace(/\t/g, '    ');
          if (line.length > cols) line = line.slice(0, cols - 1) + '$';
          v += clipPad(' ' + line, cols);
        } else {
          v += ' '.repeat(cols);
        }
      }
      v += '\r\n';
      const viewKeys = helpMode
        ? [['1','Help'],['2','Index'],['3','Prev'],['4','Next'],['5','Contents'],['6',' '],['7','Search'],['8',' '],['9',' '],['10','Quit']]
        : [['1','Help'],['2','UnWrap'],['3','Quit'],['4','Hex'],['5','Goto'],['6',' '],['7','Search'],['8','Raw'],['9',' '],['10','Quit']];
      term.write(v + drawButtonBar(viewKeys, cols));
    }

    drawViewer();
    return new Promise(resolve => {
      function close() {
        keyModal = null;
        mouseModal = null;
        render();
        resolve();
      }
      keyModal = function onKey(data) {
        if (data === '\x1b' || data === 'q' || data === '\x03' || matchFnKey(data) === 10 || matchFnKey(data) === 3) {
          close();
          return;
        }
        if (data === '\x1b[A') { if (scroll > 0) { scroll--; drawViewer(); } return; }
        if (data === '\x1b[B') { if (scroll < Math.max(0, lines.length - viewRows)) { scroll++; drawViewer(); } return; }
        if (data === '\x1b[5~') { scroll = Math.max(0, scroll - viewRows); drawViewer(); return; }
        if (data === '\x1b[6~' || data === ' ') { scroll = Math.min(Math.max(0, lines.length - viewRows), scroll + viewRows); drawViewer(); return; }
        if (data === '\x1b[H' || data === '\x01') { scroll = 0; drawViewer(); return; }
        if (data === '\x1b[F' || data === '\x05') { scroll = Math.max(0, lines.length - viewRows); drawViewer(); return; }
      };
    });
  }

  async function editFile() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry || isDir(entry)) {
      statusMsg = 'Cannot edit a directory';
      render();
      return;
    }
    const filePath = joinPath(p.path, entry.name);
    let content = await FS().fsReadFile(filePath);
    if (content == null) content = '';
    await showEditor(filePath, entry.name, typeof content === 'string' ? content : new TextDecoder().decode(content));
  }

  async function showEditor(filePath, title, initialContent) {
    const cols = term.cols;
    const rows = term.rows;
    const lines = initialContent.split('\n');
    if (!lines.length) lines.push('');
    let cursorRow = 0, cursorCol = 0, scroll = 0, modified = false;
    const editRows = rows - 2;

    function drawEditor() {
      let e = '\x1b[2J\x1b[H';
      const t = ' ' + title + (modified ? ' [*]' : '    ') +
        '  L:[' + (cursorRow + 1) + '+' + (cursorCol + 1) + ' ' + lines.length + ']';
      e += C.status + pad(t, cols) + C.reset;
      for (let i = 0; i < editRows; i++) {
        e += '\r\n' + C.view;
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          let line = lines[lineIdx];
          if (line.length > cols) line = line.slice(0, cols);
          e += clipPad(line, cols);
        } else {
          e += ' '.repeat(cols);
        }
      }
      e += '\r\n';
      const editKeys = [
        ['1', 'Help'], ['2', 'Save'], ['3', 'Mark'], ['4', 'Replac'],
        ['5', 'Copy'], ['6', 'Move'], ['7', 'Search'], ['8', 'Delete'],
        ['9', 'PullDn'], ['10', 'Quit']
      ];
      e += drawButtonBar(editKeys, cols);
      e += '\x1b[' + (cursorRow - scroll + 2) + ';' + (cursorCol + 1) + 'H';
      e += '\x1b[?25h';
      term.write(e);
    }

    drawEditor();
    return new Promise(resolve => {
      let askSave = false;
      let saveBtn = 0;
      function finish() {
        keyModal = null;
        mouseModal = null;
        term.write('\x1b[?25l');
        render();
        resolve();
      }
      function drawSaveAsk() {
        const msg = 'File was modified. Save it?';
        const cols = term.cols;
        const boxW = Math.min(48, cols - 6);
        const startCol = Math.floor((cols - boxW) / 2);
        const startRow = Math.floor(term.rows / 2) - 2;
        const yesT = saveBtn === 0 ? '[ < Yes > ]' : '[  Yes  ]';
        const noT = saveBtn === 1 ? '[ < No > ]' : '[  No  ]';
        const cT = saveBtn === 2 ? '[ < Cancel > ]' : '[ Cancel ]';
        let box = drawShadow(startRow, startCol, boxW, 4, cols, term.rows) + C.dlg;
        box += '\x1b[' + (startRow + 1) + ';' + (startCol + 1) + 'H';
        box += L.tl + L.h.repeat(boxW - 2) + L.tr;
        box += '\x1b[' + (startRow + 2) + ';' + (startCol + 1) + 'H' + L.v + ' ' + clipPad(msg, boxW - 4) + ' ' + L.v;
        const btns = yesT + ' ' + noT + ' ' + cT;
        const bpad = Math.max(0, Math.floor((boxW - 2 - visLen(btns)) / 2));
        box += '\x1b[' + (startRow + 3) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(bpad);
        box += (saveBtn === 0 ? C.dlgFocus : C.dlg) + yesT + C.dlg + ' ';
        box += (saveBtn === 1 ? C.dlgFocus : C.dlg) + noT + C.dlg + ' ';
        box += (saveBtn === 2 ? C.dlgFocus : C.dlg) + cT + C.dlg;
        box += ' '.repeat(Math.max(0, boxW - 2 - bpad - visLen(btns))) + L.v;
        box += '\x1b[' + (startRow + 4) + ';' + (startCol + 1) + 'H' + L.bl + L.h.repeat(boxW - 2) + L.br + C.reset + '\x1b[?25l';
        term.write(box);
      }
      function tryQuit() {
        if (modified) { askSave = true; saveBtn = 0; drawSaveAsk(); return; }
        finish();
      }
      keyModal = function onKey(data) {
        if (askSave) {
          if (data === '\x1b') { askSave = false; drawEditor(); return; }
          if (data === 'y' || data === 'Y') {
            FS().fsWriteFile(filePath, lines.join('\n')).then(() => finish());
            return;
          }
          if (data === 'n' || data === 'N') { finish(); return; }
          if (data === '\x1b[C' || data === '\t') { saveBtn = (saveBtn + 1) % 3; drawSaveAsk(); return; }
          if (data === '\x1b[D') { saveBtn = (saveBtn + 2) % 3; drawSaveAsk(); return; }
          if (data === '\r' || data === '\n') {
            if (saveBtn === 2) { askSave = false; drawEditor(); return; }
            if (saveBtn === 0) { FS().fsWriteFile(filePath, lines.join('\n')).then(() => finish()); return; }
            finish();
          }
          return;
        }
        const efk = matchFnKey(data);
        if (efk === 10 || data === '\x1b') { tryQuit(); return; }
        if (efk === 2 || data === '\x13') {
          FS().fsWriteFile(filePath, lines.join('\n')).then(() => {
            modified = false;
            statusMsg = 'Saved: ' + title;
            drawEditor();
          });
          return;
        }
        if (data === '\x1b[A') {
          if (cursorRow > 0) cursorRow--;
          if (cursorRow < scroll) scroll = cursorRow;
          cursorCol = Math.min(cursorCol, lines[cursorRow].length);
          drawEditor(); return;
        }
        if (data === '\x1b[B') {
          if (cursorRow < lines.length - 1) cursorRow++;
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          cursorCol = Math.min(cursorCol, lines[cursorRow].length);
          drawEditor(); return;
        }
        if (data === '\x1b[C') {
          if (cursorCol < lines[cursorRow].length) cursorCol++;
          else if (cursorRow < lines.length - 1) { cursorRow++; cursorCol = 0; }
          drawEditor(); return;
        }
        if (data === '\x1b[D') {
          if (cursorCol > 0) cursorCol--;
          else if (cursorRow > 0) { cursorRow--; cursorCol = lines[cursorRow].length; }
          drawEditor(); return;
        }
        if (data === '\r') {
          const before = lines[cursorRow].slice(0, cursorCol);
          const after = lines[cursorRow].slice(cursorCol);
          lines[cursorRow] = before;
          lines.splice(cursorRow + 1, 0, after);
          cursorRow++; cursorCol = 0; modified = true;
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          drawEditor(); return;
        }
        if (data === '\x7f' || data === '\b') {
          if (cursorCol > 0) {
            lines[cursorRow] = lines[cursorRow].slice(0, cursorCol - 1) + lines[cursorRow].slice(cursorCol);
            cursorCol--; modified = true;
          } else if (cursorRow > 0) {
            cursorCol = lines[cursorRow - 1].length;
            lines[cursorRow - 1] += lines[cursorRow];
            lines.splice(cursorRow, 1);
            cursorRow--; modified = true;
          }
          drawEditor(); return;
        }
        if (data === '\x1b[3~') {
          if (cursorCol < lines[cursorRow].length) {
            lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + lines[cursorRow].slice(cursorCol + 1);
            modified = true;
          } else if (cursorRow < lines.length - 1) {
            lines[cursorRow] += lines[cursorRow + 1];
            lines.splice(cursorRow + 1, 1);
            modified = true;
          }
          drawEditor(); return;
        }
        if (data === '\t') {
          lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + '    ' + lines[cursorRow].slice(cursorCol);
          cursorCol += 4; modified = true; drawEditor(); return;
        }
        if (data === '\x1b[H' || data === '\x01') { cursorCol = 0; drawEditor(); return; }
        if (data === '\x1b[F' || data === '\x05') { cursorCol = lines[cursorRow].length; drawEditor(); return; }
        if (data === '\x1b[5~') {
          cursorRow = Math.max(0, cursorRow - editRows);
          scroll = Math.max(0, scroll - editRows);
          drawEditor(); return;
        }
        if (data === '\x1b[6~') {
          cursorRow = Math.min(lines.length - 1, cursorRow + editRows);
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          drawEditor(); return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + data + lines[cursorRow].slice(cursorCol);
          cursorCol++; modified = true; drawEditor();
        }
      };
    });
  }

  async function copyFiles() {
    const p = panel();
    const op = otherPanel();
    const files = await getSelectedFiles();
    if (files.length === 0) { statusMsg = 'No file selected'; render(); return; }
    const def = files.length === 1 ? joinPath(op.path, files[0].name) : (op.path.endsWith('/') ? op.path : op.path + '/');
    const destInput = await promptInput('Copy file' + (files.length > 1 ? 's' : '') + ' to:', def);
    if (destInput == null) { render(); return; }
    const destBase = destInput || def;
    for (const file of files) {
      const srcPath = joinPath(p.path, file.name);
      let dstPath = destBase;
      if (files.length > 1 || destBase.endsWith('/')) dstPath = joinPath(destBase.replace(/\/+$/, '') || '/', file.name);
      try {
        if (await FS().fsExists(dstPath) && !(await FS().fsIsDir(dstPath))) {
          const ov = await promptConfirm('Overwrite ' + file.name + '?', 'Copy');
          if (!ov) continue;
        }
        if (isDir(file)) {
          const allFiles = await FS().fsList();
          const srcPrefix = srcPath.endsWith('/') ? srcPath : srcPath + '/';
          if (!(await FS().fsIsDir(dstPath))) await FS().fsMkdir(dstPath);
          for (const f of allFiles) {
            if (!f.path.startsWith(srcPrefix) || f.type === 'directory') continue;
            const rel = f.path.slice(srcPrefix.length);
            const dstFile = dstPath + '/' + rel;
            const content = await FS().fsReadFile(f.path);
            if (content != null) {
              const parts = dstFile.split('/');
              parts.pop();
              let cur = '';
              for (const part of parts) {
                cur += '/' + part;
                if (part && !(await FS().fsIsDir(cur))) await FS().fsMkdir(cur);
              }
              await FS().fsWriteFile(dstFile, content);
            }
          }
        } else {
          const content = await FS().fsReadFile(srcPath);
          if (content != null) {
            const parts = dstPath.split('/');
            parts.pop();
            let cur = '';
            for (const part of parts) {
              cur += '/' + part;
              if (part && !(await FS().fsIsDir(cur))) await FS().fsMkdir(cur);
            }
            await FS().fsWriteFile(dstPath, content);
          }
        }
      } catch (e) {
        statusMsg = 'Copy error: ' + e.message;
      }
    }
    statusMsg = files.length + ' file(s) copied';
    p.selected.clear();
    await refreshPanel(op);
    render();
  }

  async function moveFiles() {
    const p = panel();
    const op = otherPanel();
    const files = await getSelectedFiles();
    if (files.length === 0) { statusMsg = 'No file selected'; render(); return; }
    const def = files.length === 1 ? joinPath(op.path, files[0].name) : (op.path.endsWith('/') ? op.path : op.path + '/');
    const destInput = await promptInput('Rename or move file to:', def);
    if (destInput == null) { render(); return; }
    const destBase = destInput || def;
    for (const file of files) {
      const srcPath = joinPath(p.path, file.name);
      let dstPath = destBase;
      if (files.length > 1 || destBase.endsWith('/')) dstPath = joinPath(destBase.replace(/\/+$/, '') || '/', file.name);
      try {
        const content = await FS().fsReadFile(srcPath);
        if (content != null) {
          const parts = dstPath.split('/');
          parts.pop();
          let cur = '';
          for (const part of parts) {
            cur += '/' + part;
            if (part && !(await FS().fsIsDir(cur))) await FS().fsMkdir(cur);
          }
          await FS().fsWriteFile(dstPath, content);
          await FS().fsDel(srcPath);
        } else if (isDir(file)) {
          const allFiles = await FS().fsList();
          const srcPrefix = srcPath.endsWith('/') ? srcPath : srcPath + '/';
          if (!(await FS().fsIsDir(dstPath))) await FS().fsMkdir(dstPath);
          for (const f of allFiles) {
            if (!f.path.startsWith(srcPrefix) && f.path !== srcPath) continue;
            const rel = f.path === srcPath ? '' : f.path.slice(srcPrefix.length);
            const dstFile = rel ? dstPath + '/' + rel : dstPath;
            const c = await FS().fsReadFile(f.path);
            if (c != null) await FS().fsWriteFile(dstFile, c);
            await FS().fsDel(f.path);
          }
        }
      } catch (e) {
        statusMsg = 'Move error: ' + e.message;
      }
    }
    statusMsg = files.length + ' file(s) moved';
    p.selected.clear();
    await refreshPanel(p);
    await refreshPanel(op);
    render();
  }

  async function makeDirectory() {
    const p = panel();
    const name = await promptInput('Make directory:', '');
    if (!name) { render(); return; }
    try {
      await FS().fsMkdir(joinPath(p.path, name));
      statusMsg = 'Directory "' + name + '" created';
      await refreshPanel(p);
    } catch (e) {
      statusMsg = 'Error: ' + e.message;
    }
    render();
  }

  async function deleteFiles() {
    const p = panel();
    const files = await getSelectedFiles();
    if (files.length === 0) { statusMsg = 'No file selected'; render(); return; }
    const label = files.length === 1
      ? 'Delete ' + (isDir(files[0]) ? 'directory' : 'file') + ' "' + files[0].name + '"?'
      : 'Delete ' + files.length + ' files/directories?';
    const confirmed = await promptConfirm(label, 'Delete');
    if (!confirmed) { statusMsg = 'Delete cancelled'; render(); return; }
    let deleted = 0;
    for (const file of files) {
      const filePath = joinPath(p.path, file.name);
      try {
        if (isDir(file)) {
          const allFiles = await FS().fsList();
          const prefix = filePath.endsWith('/') ? filePath : filePath + '/';
          for (const f of allFiles) {
            if (f.path === filePath || f.path.startsWith(prefix)) await FS().fsDel(f.path);
          }
        } else {
          await FS().fsDel(filePath);
        }
        deleted++;
      } catch (e) {
        statusMsg = 'Delete error: ' + e.message;
      }
    }
    p.selected.clear();
    statusMsg = deleted + ' file(s) deleted';
    await refreshPanel(p);
    render();
  }

  /* MC dialog shadow: 2 cols right, 1 row down. L-shape (right strip + bottom strip). */
  function drawShadow(startRow, startCol, boxW, boxH, cols, rows) {
    let s = C.shadow;
    const rightCol = startCol + boxW;
    for (let r = 1; r < boxH; r++) {
      const rr = startRow + r;
      if (rr >= rows || rightCol >= cols) break;
      const n = Math.min(2, cols - rightCol);
      if (n > 0) s += '\x1b[' + (rr + 1) + ';' + (rightCol + 1) + 'H' + ' '.repeat(n);
    }
    const br = startRow + boxH;
    if (br < rows) {
      const bc = startCol + 2;
      if (bc < cols) {
        const n = Math.min(boxW, cols - bc);
        if (n > 0) s += '\x1b[' + (br + 1) + ';' + (bc + 1) + 'H' + ' '.repeat(n);
      }
    }
    return s + C.reset;
  }

  function promptInput(message, def) {
    def = def == null ? '' : String(def);
    return new Promise(resolve => {
      const cols = term.cols;
      const rows = term.rows;
      const boxW = Math.min(58, cols - 6);
      const boxH = 7;
      const startRow = Math.max(1, Math.floor((rows - boxH) / 2) - 1);
      const startCol = Math.max(1, Math.floor((cols - boxW) / 2));
      let inputBuf = def;
      let btn = 0;
      let inField = true;

      function draw() {
        let box = drawShadow(startRow, startCol, boxW, boxH, cols, rows);
        box += C.dlg;
        box += '\x1b[' + (startRow + 1) + ';' + (startCol + 1) + 'H';
        const title = ' ' + message.replace(/:$/, '') + ' ';
        const dashL = Math.max(1, Math.floor((boxW - 2 - title.length) / 2));
        const dashR = Math.max(1, boxW - 2 - title.length - dashL);
        box += L.tl + L.h.repeat(dashL) + C.dlgTitle + title + C.dlg + L.h.repeat(dashR) + L.tr;
        box += '\x1b[' + (startRow + 2) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(boxW - 2) + L.v;
        box += '\x1b[' + (startRow + 3) + ';' + (startCol + 1) + 'H' + L.v + ' ' + clipPad(message, boxW - 4) + ' ' + L.v;
        const field = clipPad(inputBuf, boxW - 6);
        box += '\x1b[' + (startRow + 4) + ';' + (startCol + 1) + 'H' + L.v + ' ' + C.input + ' ' + field + ' ' + C.dlg + ' ' + L.v;
        box += '\x1b[' + (startRow + 5) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(boxW - 2) + L.v;
        const ok = btn === 0 && !inField ? C.dlgFocus : C.dlg;
        const cancel = btn === 1 && !inField ? C.dlgFocus : C.dlg;
        const okT = (btn === 0 && !inField) ? '[ < OK > ]' : '[  OK  ]';
        const cT = (btn === 1 && !inField) ? '[ < Cancel > ]' : '[ Cancel ]';
        const btns = okT + '  ' + cT;
        const bpad = Math.max(0, Math.floor((boxW - 2 - visLen(btns)) / 2));
        box += '\x1b[' + (startRow + 6) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(bpad) +
          ok + okT + C.dlg + '  ' + cancel + cT + C.dlg +
          ' '.repeat(Math.max(0, boxW - 2 - bpad - visLen(btns))) + L.v;
        box += '\x1b[' + (startRow + 7) + ';' + (startCol + 1) + 'H' + L.bl + L.h.repeat(boxW - 2) + L.br;
        box += C.reset;
        const curCol = startCol + 3 + Math.min(inputBuf.length, boxW - 6);
        box += '\x1b[' + (startRow + 4) + ';' + (curCol + 1) + 'H';
        box += inField ? '\x1b[?25h' : '\x1b[?25l';
        term.write(box);
      }

      draw();
function done(val) {
        keyModal = null;
        mouseModal = null;
        term.write('\x1b[?25l');
        resolve(val);
      }
      keyModal = function onKey(data) {
        if (data === '\x1b' || matchFnKey(data) === 10) { done(null); return; }
        if (data === '\t') { inField = !inField; if (!inField) btn = 0; draw(); return; }
        if (!inField) {
          if (data === '\x1b[C' || data === '\x1b[D') { btn = 1 - btn; draw(); return; }
          if (data === '\r' || data === '\n') { done(btn === 0 ? inputBuf : null); return; }
          return;
        }
        if (data === '\r' || data === '\n') { done(inputBuf); return; }
        if (data === '\x7f' || data === '\b') {
          inputBuf = inputBuf.slice(0, -1); draw(); return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          inputBuf += data; draw();
        }
      };
    });
  }

  function promptConfirm(message, titleText) {
    return new Promise(resolve => {
      const cols = term.cols;
      const rows = term.rows;
      const boxW = Math.min(Math.max(36, message.length + 8), cols - 6);
      const boxH = 5;
      const startRow = Math.max(1, Math.floor((rows - boxH) / 2) - 1);
      const startCol = Math.max(1, Math.floor((cols - boxW) / 2));
      let btn = 0;

      function draw() {
        let box = drawShadow(startRow, startCol, boxW, boxH, cols, rows) + C.dlg;
        const title = ' ' + (titleText || 'Confirm') + ' ';
        const dashL = Math.max(1, Math.floor((boxW - 2 - title.length) / 2));
        const dashR = Math.max(1, boxW - 2 - title.length - dashL);
        box += '\x1b[' + (startRow + 1) + ';' + (startCol + 1) + 'H';
        box += L.tl + L.h.repeat(dashL) + C.dlgTitle + title + C.dlg + L.h.repeat(dashR) + L.tr;
        box += '\x1b[' + (startRow + 2) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(boxW - 2) + L.v;
        box += '\x1b[' + (startRow + 3) + ';' + (startCol + 1) + 'H' + L.v + ' ' +
          clipPad(message, boxW - 4) + ' ' + L.v;
        const yesT = btn === 0 ? '[ < Yes > ]' : '[  Yes  ]';
        const noT = btn === 1 ? '[ < No > ]' : '[  No  ]';
        const btns = yesT + '   ' + noT;
        const bpad = Math.max(0, Math.floor((boxW - 2 - visLen(btns)) / 2));
        box += '\x1b[' + (startRow + 4) + ';' + (startCol + 1) + 'H' + L.v + ' '.repeat(bpad) +
          (btn === 0 ? C.dlgFocus : C.dlg) + yesT + C.dlg + '   ' +
          (btn === 1 ? C.dlgFocus : C.dlg) + noT + C.dlg +
          ' '.repeat(Math.max(0, boxW - 2 - bpad - visLen(btns))) + L.v;
        box += '\x1b[' + (startRow + 5) + ';' + (startCol + 1) + 'H' + L.bl + L.h.repeat(boxW - 2) + L.br;
        box += C.reset + '\x1b[?25l';
        term.write(box);
      }

      draw();
      function done(val) { keyModal = null; mouseModal = null; resolve(val); }
      keyModal = function onKey(data) {
        if (data === '\x1b' || matchFnKey(data) === 10) { done(null); return; }
        if (data === 'y' || data === 'Y') { done(true); return; }
        if (data === 'n' || data === 'N') { done(false); return; }
        if (data === '\x1b[C' || data === '\x1b[D' || data === '\t') { btn = 1 - btn; draw(); return; }
        if (data === '\r' || data === '\n') { done(btn === 0); return; }
      };
    });
  }

  async function promptCommand(cmd, message) {
    const input = await promptInput(message + ':', cmd === 'cd' ? '' : cmd);
    if (input == null || input === '') { render(); return; }
    if (cmd === 'cd') await chdirPanel(panel(), input);
    else render();
  }

  function showHelp() {
    const lines = [
      'GNU Midnight Commander',
      '',
      'Navigation',
      '  Up/Down, C-p/C-n     Move the selection bar',
      '  PgUp/PgDn            Page up / page down',
      '  Home/C-a  End/C-e    First / last file',
      '  Tab                  Change panel',
      '  Enter                Enter directory / view file',
      '  Backspace            Parent directory',
      '  Left/Right           Lynx-like: parent / enter',
      '  C-u                  Swap panels',
      '  C-o                  Hide panels and type at the shell',
      '  C-r                  Reread directory',
      '  M-c                  Quick cd',
      '  M-i / M-o            Other panel = current / pointed dir',
      '  M-.                  Toggle hidden files',
      '  C-s / M-s            Incremental search',
      '',
      'Selection',
      '  Insert / C-t         Tag file (Insert also moves down)',
      '  + / -                Select / unselect group',
      '  *                    Reverse selection (files only)',
      '',
      'Function keys',
      '  F1 Help   F2 Menu    F3 View   F4 Edit   F5 Copy',
      '  F6 RenMov F7 Mkdir   F8 Delete F9 PullDn F10 Quit',
      '',
      'Command line',
      '  Type a command and press Enter. M-p / M-n history.',
      '',
      'Press any key to close...',
    ];
    showViewer('Help', lines.join('\n'), true);
  }

  function menuPositions() {
    const titles = ['Left', 'File', 'Command', 'Options', 'Right'];
    const positions = [];
    let x = 0;
    for (const t of titles) {
      const w = t.length + 2;
      positions.push({ title: t, x, w });
      x += w;
    }
    return positions;
  }

  async function showPullDownMenu(startIdx) {
    const menus = buildMenus();
    const titles = menus.map(m => m.title);
    await activateTopMenu(titles, menus, startIdx || 0);
    render();
  }

  function activateTopMenu(titles, menus, startIdx) {
    return new Promise(resolve => {
      const cols = term.cols;
      let menuIdx = Math.max(0, Math.min(titles.length - 1, startIdx || 0));
      let openMenu = true;
      let itemIdx = 0;
      let currentMenuItems = [];

      const positions = menuPositions();

      function drawMenuBar() {
        let out = '\x1b[1;1H' + C.menu;
        let barStr = '';
        for (let i = 0; i < titles.length; i++) {
          const t = titles[i];
          if (i === menuIdx) {
            barStr += C.menuSel + ' ' + C.menuHotSel + t[0] + C.menuSel + t.slice(1) + ' ' + C.menu;
          } else {
            barStr += ' ' + C.menuHot + t[0] + C.menu + t.slice(1) + ' ';
          }
        }
        out += clipPad(barStr, cols) + C.reset;
        term.write(out);
      }

      function drawDropDown() {
        currentMenuItems = menus[menuIdx].items.map(i => i.label);
        itemIdx = Math.min(itemIdx, currentMenuItems.length - 1);
        const pos = positions[menuIdx];
        const dropW = Math.max(24, ...currentMenuItems.map(l => visLen(l) + 4), menus[menuIdx].title.length + 4);
        const ansiX = pos.x + 1;
        let dd = drawShadow(1, pos.x, dropW, currentMenuItems.length + 2, cols, term.rows);
        dd += C.menu;
        dd += '\x1b[2;' + ansiX + 'H' + L.tl + L.h.repeat(dropW - 2) + L.tr;
        for (let i = 0; i < currentMenuItems.length; i++) {
          dd += '\x1b[' + (3 + i) + ';' + ansiX + 'H' + C.menu + L.v;
          const raw = currentMenuItems[i];
          const padded = (' ' + raw).padEnd(dropW - 2);
          if (i === itemIdx) dd += C.menuSel + padded + C.menu;
          else {
            const hot = raw.match(/[A-Za-z]/);
            if (hot) {
              const idxH = raw.indexOf(hot[0]);
              const pre = (' ' + raw.slice(0, idxH));
              const rest = (raw.slice(idxH + 1) + ' ').padEnd(dropW - 2 - pre.length - 1);
              dd += C.menu + pre + C.menuHot + hot[0] + C.menu + rest;
            } else {
              dd += padded;
            }
          }
          dd += L.v;
        }
        dd += '\x1b[' + (3 + currentMenuItems.length) + ';' + ansiX + 'H';
        dd += L.bl + L.h.repeat(dropW - 2) + L.br + C.reset;
        term.write(dd);
      }

      function paint() {
        render();
        drawMenuBar();
        if (openMenu) drawDropDown();
      }

      paint();

function done(val) {
        keyModal = null;
        mouseModal = null;
        resolve(val);
      }
      mouseModal = function onMenuMouse(pos) {
        if (pos.row === 0) {
          for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            if (pos.col >= p.x && pos.col < p.x + p.w) {
              menuIdx = i; openMenu = true; itemIdx = 0; paint(); return true;
            }
          }
          done(null); return true;
        }
        if (openMenu) {
          const p = positions[menuIdx];
          const dropW = Math.max(24, ...currentMenuItems.map(l => visLen(l) + 4), menus[menuIdx].title.length + 4);
          const top = 1;
          const h = currentMenuItems.length + 2;
          if (pos.col >= p.x && pos.col < p.x + dropW && pos.row >= top && pos.row < top + h) {
            const item = pos.row - top - 1;
            if (item >= 0 && item < currentMenuItems.length) {
              itemIdx = item;
              const entry = menus[menuIdx].items[itemIdx];
              keyModal = null;
              mouseModal = null;
              if (entry && entry.action) Promise.resolve(entry.action()).then(() => resolve(null));
              else resolve(null);
            }
            return true;
          }
        }
        done(null);
        return true;
      };
      keyModal = function onKey(data) {
        const fk = matchFnKey(data);
        if (!openMenu) {
          if (data === '\x1b' || fk === 9 || fk === 10 || data === '\x03') {
            done(null); return;
          }
          if (data === '\x1b[D') { menuIdx = (menuIdx - 1 + titles.length) % titles.length; drawMenuBar(); return; }
          if (data === '\x1b[C') { menuIdx = (menuIdx + 1) % titles.length; drawMenuBar(); return; }
          if (data === '\r' || data === '\n' || data === '\x1b[B') {
            openMenu = true; itemIdx = 0; paint(); return;
          }
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            const ch = data.toLowerCase();
            const found = titles.findIndex(t => t.toLowerCase().startsWith(ch));
            if (found >= 0) { menuIdx = found; openMenu = true; itemIdx = 0; paint(); }
          }
          return;
        }
        if (data === '\x1b' || fk === 9 || fk === 10 || data === '\x03') {
          done(null); return;
        }
        if (data === '\x1b[A') {
          itemIdx = (itemIdx - 1 + currentMenuItems.length) % currentMenuItems.length;
          paint(); return;
        }
        if (data === '\x1b[B') {
          itemIdx = (itemIdx + 1) % currentMenuItems.length;
          paint(); return;
        }
        if (data === '\r' || data === '\n') {
          const entry = menus[menuIdx].items[itemIdx];
          keyModal = null;
          mouseModal = null;
          if (entry && entry.action) {
            Promise.resolve(entry.action()).then(() => resolve(null));
          } else resolve(null);
          return;
        }
        if (data === '\x1b[C') {
          menuIdx = (menuIdx + 1) % titles.length; itemIdx = 0; paint(); return;
        }
        if (data === '\x1b[D') {
          menuIdx = (menuIdx - 1 + titles.length) % titles.length; itemIdx = 0; paint(); return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          const ch = data.toLowerCase();
          const found = currentMenuItems.findIndex(l => l.toLowerCase().includes(ch));
          if (found >= 0) { itemIdx = found; paint(); }
        }
      };
    });
  }

  function sortAction(which, field) {
    return async () => {
      const p = which === 'left' ? left : (which === 'right' ? right : panel());
      if (p.sort === field) p.sortDir = -p.sortDir;
      else { p.sort = field; p.sortDir = 1; }
      await refreshPanel(p);
    };
  }

  function buildMenus() {
    const listing = (which) => ([
      { label: 'Sort by name', action: sortAction(which, 'name') },
      { label: 'Sort by size', action: sortAction(which, 'size') },
      { label: 'Sort by mtime', action: sortAction(which, 'mtime') },
      { label: 'Filter...', action: async () => {
          const p = which === 'right' ? right : (which === 'left' ? left : panel());
          const f = await promptInput('Filter:', p.filter || '*');
          if (f != null) { p.filter = f === '*' ? '' : f; await refreshPanel(p); }
        } },
      { label: 'Rescan     C-r', action: async () => { await refreshPanel(which === 'right' ? right : (which === 'left' ? left : panel())); } },
      { label: '~  Home', action: async () => { await chdirPanel(which === 'right' ? right : left, HOME); } },
      { label: '/  Root', action: async () => { await chdirPanel(which === 'right' ? right : left, '/'); } },
    ]);
    return [
      { title: 'Left', items: listing('left') },
      {
        title: 'File',
        items: [
          { label: 'View            F3', action: viewFile },
          { label: 'Edit            F4', action: editFile },
          { label: 'Copy            F5', action: copyFiles },
          { label: 'Rename/Move     F6', action: moveFiles },
          { label: 'Make directory  F7', action: makeDirectory },
          { label: 'Delete          F8', action: deleteFiles },
          { label: 'Select group     +', action: async () => selectGroup('select') },
          { label: 'Unselect group   -', action: async () => selectGroup('unselect') },
          { label: 'Reverse select   *', action: async () => invertSelection() },
          { label: 'Exit           F10', action: async () => quit() },
        ]
      },
      {
        title: 'Command',
        items: [
          { label: 'Find file', action: async () => startSearch() },
          { label: 'Swap panels   C-u', action: async () => swapPanels() },
          { label: 'Quick cd      M-c', action: async () => promptCommand('cd', 'Quick cd') },
          { label: 'Compare dirs', action: async () => {
              const namesL = new Set(left.files.map(f => f.name));
              const namesR = new Set(right.files.map(f => f.name));
              left.selected = new Set([...namesL].filter(n => n !== '..' && !namesR.has(n)));
              right.selected = new Set([...namesR].filter(n => n !== '..' && !namesL.has(n)));
              statusMsg = 'Directories compared — unique files tagged';
            } },
        ]
      },
      {
        title: 'Options',
        items: [
          { label: (showHidden ? '+ ' : '  ') + 'Show hidden files  M-.', action: async () => { showHidden = !showHidden; await refreshPanelsKeepSel(); } },
          { label: (lynxLike ? '+ ' : '  ') + 'Lynx-like motion', action: async () => { lynxLike = !lynxLike; } },
          { label: (mixFiles ? '+ ' : '  ') + 'Mix all files', action: async () => { mixFiles = !mixFiles; await refreshPanelsKeepSel(); } },
          { label: 'Save setup', action: async () => { statusMsg = 'Setup saved (browser session)'; } },
        ]
      },
      { title: 'Right', items: listing('right') },
    ];
  }

  async function showUserMenu() {
    const items = [
      { label: 'View file', action: viewFile },
      { label: 'Edit file', action: editFile },
      { label: 'Copy file', action: copyFiles },
      { label: 'Make directory', action: makeDirectory },
      { label: 'Open other panel here', action: async () => {
          const o = otherPanel();
          o.path = panel().path; o.cursor = 0; o.scroll = 0; o.selected.clear();
          await refreshPanel(o);
        } },
    ];
    const choice = await promptMenu('User menu', items.map(i => i.label));
    if (choice == null) { render(); return; }
    const it = items[choice];
    if (it && it.action) await it.action();
    render();
  }

  function promptMenu(title, labels) {
    return new Promise(resolve => {
      const cols = term.cols;
      let idx = 0;
      const width = Math.max(title.length + 4, ...labels.map(l => l.length + 4), 22);
      const ly = layout();
      const isLeft = activePanel === 'left';
      const col = isLeft ? 2 : ly.leftW + 1;
      const row = 2;

      function draw() {
        let out = drawShadow(row, col, width, labels.length + 2, cols, term.rows);
        out += '\x1b[' + (row + 1) + ';' + (col + 1) + 'H' + C.menu;
        const t = ' ' + title + ' ';
        const dl = Math.max(1, Math.floor((width - 2 - t.length) / 2));
        const dr = Math.max(1, width - 2 - t.length - dl);
        out += L.tl + L.h.repeat(dl) + t + L.h.repeat(dr) + L.tr;
        for (let i = 0; i < labels.length; i++) {
          out += '\x1b[' + (row + 2 + i) + ';' + (col + 1) + 'H' + C.menu + L.v;
          const padded = (' ' + labels[i]).padEnd(width - 2);
          out += (i === idx ? C.menuSel : C.menu) + padded + C.menu + L.v;
        }
        out += '\x1b[' + (row + 2 + labels.length) + ';' + (col + 1) + 'H';
        out += L.bl + L.h.repeat(width - 2) + L.br + C.reset;
        term.write(out);
      }

      render();
      draw();
function done(val) {
        keyModal = null;
        mouseModal = null;
        resolve(val);
      }
      mouseModal = function onUserMenuMouse(pos) {
        const h = labels.length + 2;
        if (pos.col >= col && pos.col < col + width && pos.row >= row && pos.row < row + h) {
          const item = pos.row - row - 1;
          if (item >= 0 && item < labels.length) done(item);
          return true;
        }
        done(null);
        return true;
      };
      keyModal = function onKey(data) {
        const fk = matchFnKey(data);
        if (data === '\x1b' || fk === 10 || data === '\x03') {
          done(null); return;
        }
        if (data === '\x1b[A' || data === '\x10') {
          idx = (idx - 1 + labels.length) % labels.length; draw(); return;
        }
        if (data === '\x1b[B' || data === '\x0e') {
          idx = (idx + 1) % labels.length; draw(); return;
        }
        if (data === '\r' || data === '\n') { done(idx); return; }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          const ch = data.toLowerCase();
          const found = labels.findIndex(l => l.toLowerCase().startsWith(ch));
          if (found >= 0) { idx = found; draw(); }
        }
      };
    });
  }

  function quit() {
    running = false;
    keyModal = null;
    mouseModal = null;
    removeMouseHandlers();
    if (resolveExit) {
      resolveExit();
      resolveExit = null;
    }
  }

  let lastClickTime = 0;
  let lastClickRow = -1;
  let lastClickPanel = null;

  function pixelToCell(ev) {
    const el = term.element;
    if (!el) return null;
    const screen = el.querySelector('canvas.xterm-text-layer')
      || el.querySelector('.xterm-screen')
      || el.querySelector('.xterm-rows')
      || el;
    const rect = screen.getBoundingClientRect();
    let cellW, cellH, left, top;
    const dims = term._core && term._core._renderService && term._core._renderService.dimensions;
    const cssCell = dims && dims.css && dims.css.cell;
    if (rect.width === 0 || rect.height === 0) {
      const r2 = el.getBoundingClientRect();
      cellW = r2.width / term.cols;
      cellH = r2.height / term.rows;
      left = r2.left; top = r2.top;
    } else if (cssCell && cssCell.width && cssCell.height) {
      cellW = cssCell.width;
      cellH = cssCell.height;
      left = rect.left; top = rect.top;
    } else {
      cellW = rect.width / term.cols;
      cellH = rect.height / term.rows;
      left = rect.left; top = rect.top;
    }
    const col = Math.floor((ev.clientX - left) / cellW);
    const row = Math.floor((ev.clientY - top) / cellH);
    return { row: Math.max(0, Math.min(row, term.rows - 1)),
             col: Math.max(0, Math.min(col, term.cols - 1)) };
  }

  let lastPtr = { t: 0, row: -1, col: -1 };

  function handleCellClick(row, col) {
    if (!running) return false;
    const now = Date.now();
    if (now - lastPtr.t < 80 && lastPtr.row === row && lastPtr.col === col) return true;
    lastPtr = { t: now, row, col };
    const pos = { row, col };
    if (mouseModal) return !!mouseModal(pos);
    const ly = layout();

    if (row <= ly.menuR) {
      const positions = menuPositions();
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (col >= p.x && col < p.x + p.w) {
          showPullDownMenu(i);
          return true;
        }
      }
      showPullDownMenu(0);
      return true;
    }

    if (row >= ly.keyR) {
      const widths = bbButtonWidths(ly.cols);
      let x = 0;
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i];
        if (w <= 0) continue;
        if (col >= x && col < x + w) { handleFnKey(i + 1); return true; }
        x += w;
      }
      return true;
    }

    const want = col < ly.leftW ? 'left' : 'right';

    if (row === ly.headerR) {
      const innerOff = want === 'left' ? 1 : ly.leftW + 1;
      const local = col - innerOff;
      const inner = want === 'left' ? ly.leftInner : ly.rightInner;
      const p = want === 'left' ? left : right;
      const pc = panelCols(inner);
      if (local >= pc.nameW && pc.showSize && local < pc.nameW + pc.sizeW) {
        if (p.sort === 'size') p.sortDir = -p.sortDir; else { p.sort = 'size'; p.sortDir = 1; }
      } else if (pc.showTime && local >= pc.nameW + pc.sizeW) {
        if (p.sort === 'mtime') p.sortDir = -p.sortDir; else { p.sort = 'mtime'; p.sortDir = 1; }
      } else {
        if (p.sort === 'name') p.sortDir = -p.sortDir; else { p.sort = 'name'; p.sortDir = 1; }
      }
      if (activePanel !== want) activePanel = want;
      refreshPanel(p).then(render);
      return true;
    }

    if (row >= ly.fileTop && row <= ly.fileBot) {
      if (activePanel !== want) activePanel = want;
      const p = panel();
      const fileRow = row - ly.fileTop;
      const targetFile = p.scroll + fileRow;
      if (targetFile >= p.files.length) { render(); return true; }
      const now = Date.now();
      const dt = now - lastClickTime;
      const isDoubleClick = dt > 200 && dt < 500 &&
        (lastClickRow === fileRow) && (lastClickPanel === want);
      lastClickTime = now;
      lastClickRow = fileRow;
      lastClickPanel = want;
      p.cursor = targetFile;
      ensureVisible(p);
      if (isDoubleClick) { render(); enterDirectory(); }
      else render();
      return true;
    }

    if (row >= ly.panelTop && row <= ly.panelBot) {
      if (activePanel !== want) { activePanel = want; render(); }
      return true;
    }
    return false;
  }

  function focusTerm() {
    try { if (term && typeof term.focus === 'function') term.focus(); } catch (e) { /* ignore */ }
  }

  function handlePointer(ev) {
    if (!running) return false;
    if (sgrTracking) {
      focusTerm();
      return false;
    }
    const pos = pixelToCell(ev);
    if (!pos) return false;
    return handleCellClick(pos.row, pos.col);
  }

  let swallowNextClick = false;

  function onMouseClick(ev) {
    if (swallowNextClick) {
      swallowNextClick = false;
      ev.preventDefault();
      return;
    }
    handlePointer(ev);
  }

  function onMouseDown(ev) {
    if (!running) return;
    if (sgrTracking) {
      /* Do not stopPropagation: xterm needs the event to emit SGR.
         preventDefault + focus: block text selection, keep the textarea focused. */
      if (ev.preventDefault) ev.preventDefault();
      focusTerm();
      return;
    }
    if (ev.preventDefault) ev.preventDefault();
    swallowNextClick = true;
    if (ev.button === 1) return;
    if (ev.button === 2) {
      const pos = pixelToCell(ev);
      if (!pos) return;
      const ly = layout();
      if (pos.row >= ly.fileTop && pos.row <= ly.fileBot) handleFnKey(2);
      return;
    }
    if (ev.button === 0) handlePointer(ev);
  }

  function onMouseWheel(ev) {
    if (!running) return;
    ev.preventDefault();
    if (sgrTracking) return;
    const pos = pixelToCell(ev);
    if (!pos) return;
    const ly = layout();
    const want = pos.col < ly.leftW ? 'left' : 'right';
    if (activePanel !== want) activePanel = want;
    const delta = ev.deltaY > 0 ? 3 : -3;
    const p = panel();
    p.cursor = Math.max(0, Math.min(p.files.length - 1, p.cursor + delta));
    ensureVisible(p);
    render();
  }

  function preventContextMenu(ev) { ev.preventDefault(); }

  let mouseRoots = [];
  let sgrTracking = false;

  function enableMouseTracking() {
    if (!term || typeof term.write !== 'function') return;
    /* Real MC: alt screen + SGR mouse so clicks arrive as CSI, not DOM selection. */
    term.write('\x1b[?1049h\x1b[?1006h\x1b[?1000h\x1b[?1002h');
    sgrTracking = true;
  }

  function disableMouseTracking() {
    sgrTracking = false;
    if (!term || typeof term.write !== 'function') return;
    term.write('\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1049l\x1b[?25h');
  }

  function installMouseHandlers() {
    mouseRoots = [];
    const roots = [];
    if (term && term.element) roots.push(term.element);
    if (typeof document !== 'undefined' && document.getElementById) {
      const c = document.getElementById('terminal-container');
      if (c && roots.indexOf(c) < 0) roots.push(c);
    }
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      if (!el || !el.addEventListener) continue;
      el.addEventListener('click', onMouseClick, true);
      el.addEventListener('mousedown', onMouseDown, true);
      el.addEventListener('wheel', onMouseWheel, { capture: true, passive: false });
      el.addEventListener('contextmenu', preventContextMenu, true);
      mouseRoots.push(el);
    }
    enableMouseTracking();
  }

  function removeMouseHandlers() {
    disableMouseTracking();
    for (let i = 0; i < mouseRoots.length; i++) {
      const el = mouseRoots[i];
      if (!el || !el.removeEventListener) continue;
      el.removeEventListener('click', onMouseClick, true);
      el.removeEventListener('mousedown', onMouseDown, true);
      el.removeEventListener('wheel', onMouseWheel, true);
      el.removeEventListener('contextmenu', preventContextMenu, true);
    }
    mouseRoots = [];
  }

  return {
    async launch(xterm, startPath) {
      term = xterm;
      activePanel = 'left';
      left = newPanel(startPath || HOME);
      right = newPanel(PREFIX);
      statusMsg = '';
      cmdLine = '';
      searchMode = false;
      searchStr = '';
      keyModal = null;
      mouseModal = null;
      lastClickTime = 0;
      lastClickRow = -1;
      lastClickPanel = null;
      lastPtr = { t: 0, row: -1, col: -1 };
      running = true;
      await Promise.all([refreshPanel(left), refreshPanel(right)]);
      installMouseHandlers();
      return new Promise(resolve => {
        resolveExit = resolve;
        render();
        focusTerm();
      });
    },
    handleKey,
    handlePointer,
    isRunning() { return running; },
  };
})();

window.TermuxMC = TermuxMC;
