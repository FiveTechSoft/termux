/* =====================================================================
   Termux Web — Midnight Commander (mc) File Manager
   Authentic colors and correct function key handling.
   ===================================================================== */
'use strict';

const TermuxMC = (() => {
  const FS = () => window.TermuxFS;
  const PREFIX = '/data/data/com.termux/files/usr';
  const HOME = '/data/data/com.termux/files/home';

  /* =================================================================
     ANSI color palette — matches the real Midnight Commander "dark" skin
     ================================================================= */
  const C = {
    // Panel background
    panelBg:     '\x1b[44m',         // blue bg

    // Normal text
    white:       '\x1b[37m',
    boldWhite:   '\x1b[1;37m',
    black:       '\x1b[30m',

    // File type colors (on blue bg)
    dir:         '\x1b[1;33m',       // bold yellow dirs on blue
    file:        '\x1b[37m',         // white regular files on blue
    executable:  '\x1b[1;32m',       // bold green executables on blue
    symlink:     '\x1b[1;36m',       // bold cyan symlinks on blue
    device:      '\x1b[1;31m',       // bold red devices on blue
    brokenLink:  '\x1b[1;35m',       // bold magenta broken links on blue

    // Selected / marked
    selected:    '\x1b[1;37m',       // bold white text
    selectedBg:  '\x1b[42m',         // green bg for selected
    marked:      '\x1b[1;37m',       // bold white for marked
    markedBg:    '\x1b[46m',         // cyan bg for marked/cursor

    // Menu / key bar
    menuBg:      '\x1b[46m',         // cyan bg for menu bar
    menuFg:      '\x1b[1;30m',       // bold black text on cyan
    keyNum:      '\x1b[1;33m',       // yellow key numbers
    keyLabel:    '\x1b[1;37m',       // bold white key labels

    // Active panel header
    headerActive:    '\x1b[1;46;30m', // bold black on cyan
    headerInactive:  '\x1b[44;36m',  // cyan on blue

    // Dialog / input
    dialogBg:    '\x1b[44m',         // blue
    dialogFg:    '\x1b[37m',         // white

    // Editor
    editorBar:   '\x1b[41;37m',      // red bg, white fg

    // Viewer
    viewerBar:   '\x1b[46;30m',      // cyan bg, black fg

    // Status
    statusBg:    '\x1b[44m',         // blue bg

    // Misc
    bold:        '\x1b[1m',
    reset:       '\x1b[0m',
    reverse:     '\x1b[7m',
    dim:         '\x1b[2m',
  };

  let term = null;
  let savedState = null;

  // Panel state
  let left = {
    path: HOME,
    files: [],
    cursor: 0,
    scroll: 0,
    selected: new Set(),
  };
  let right = {
    path: PREFIX,
    files: [],
    cursor: 0,
    scroll: 0,
    selected: new Set(),
  };
  let activePanel = 'left';
  let statusMsg = '';
  let running = false;
  let resolveExit = null;

  // --- Helpers ---
  function panel() { return activePanel === 'left' ? left : right; }
  function otherPanel() { return activePanel === 'left' ? right : left; }

  function pad(str, len) {
    str = String(str);
    const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
    if (stripped.length >= len) return str.slice(0, len);
    return str + ' '.repeat(len - stripped.length);
  }

  function truncPath(p) {
    if (p.startsWith(HOME)) return '~' + p.slice(HOME.length);
    return p;
  }

  function classifyFile(entry) {
    if (entry.isParent) return 'parent';
    if (isDir(entry)) return 'dir';
    const name = entry.name || '';
    // Symlinks (stored as SYMLINK: target in virtual FS)
    if (entry.type === 'symlink') return 'symlink';
    // Executable extensions
    const ext = name.split('.').pop().toLowerCase();
    const executableExts = ['sh', 'bash', 'zsh', 'py', 'pyc', 'js', 'mjs',
      'ts', 'rb', 'pl', 'php', 'lua', 'ex', 'exs', 'fish'];
    const execBase = ['configure', 'Makefile', 'Rakefile', 'Gemfile'];
    if (executableExts.includes(ext) || execBase.includes(name)) return 'executable';
    // Device files
    if (entry.type === 'block' || entry.type === 'char') return 'device';
    return 'file';
  }

  function fileColor(entry) {
    const kind = classifyFile(entry);
    switch (kind) {
      case 'parent':     return C.boldWhite;
      case 'dir':        return C.dir;
      case 'executable': return C.executable;
      case 'symlink':    return C.symlink;
      case 'device':     return C.device;
      default:           return C.file;
    }
  }

  function isDir(entry) {
    return entry.type === 'dir' || (entry.name && entry.name.endsWith('/'));
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '       ';
    if (bytes < 1024) return String(bytes).padStart(7);
    if (bytes < 1048576) return (bytes / 1024).toFixed(1).padStart(6) + 'K';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1).padStart(6) + 'M';
    return (bytes / 1073741824).toFixed(1).padStart(6) + 'G';
  }

  function formatPermissions(entry) {
    if (isDir(entry)) return 'drwxr-xr-x';
    const ext = (entry.name || '').split('.').pop().toLowerCase();
    const execExts = ['sh','bash','py','js','mjs','ts','rb','pl','php','lua'];
    if (execExts.includes(ext)) return '-rwxr-xr-x';
    return '-rw-r--r--';
  }

  // --- Directory listing ---
  async function listDir(dirPath) {
    const items = await FS().fsList();
    const entries = [];
    if (dirPath !== '/') {
      entries.push({ name: '..', display: '..', type: 'dir', size: 0, isParent: true });
    }
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    for (const item of items) {
      if (item.path === dirPath) continue;
      if (!item.path.startsWith(prefix)) continue;
      const rel = item.path.slice(prefix.length);
      if (!rel) continue;
      const slashIdx = rel.indexOf('/');
      const name = slashIdx === -1 ? rel : rel.slice(0, slashIdx);
      if (entries.some(e => e.name === name)) continue;
      const isDirEntry = item.type === 'directory' || item.type === 'dir' || slashIdx !== -1;
      entries.push({
        name: name,
        display: name + (isDirEntry ? '/' : ''),
        type: isDirEntry ? 'dir' : 'file',
        size: isDirEntry ? 0 : (item.content ? item.content.length : 0),
      });
    }
    entries.sort((a, b) => {
      if (a.isParent) return -1;
      if (b.isParent) return 1;
      const aDir = a.type === 'dir';
      const bDir = b.type === 'dir';
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async function refreshPanel(p) {
    const prevName = p.files[p.cursor] ? p.files[p.cursor].name : null;
    p.files = await listDir(p.path);
    if (prevName) {
      const idx = p.files.findIndex(e => e.name === prevName);
      if (idx >= 0) p.cursor = idx;
    }
    if (p.cursor >= p.files.length) p.cursor = Math.max(0, p.files.length - 1);
  }

  // --- Rendering ---
  function render() {
    const cols = term.cols;
    const rows = term.rows;
    const panelWidth = Math.floor((cols - 1) / 2);
    const rightWidth = cols - panelWidth - 1;
    const contentRows = rows - 4; // top bar + header + separator + bottom bar

    let out = '';

    // Clear screen + hide cursor
    out += '\x1b[2J\x1b[H';
    out += '\x1b[?25l'; // hide cursor

    // === Top menu bar (row 1) ===
    out += C.menuBg + C.menuFg;
    const menuItems = ['Left', 'File', 'Command', 'Options', 'Right'];
    let menuBar = '';
    for (const m of menuItems) {
      menuBar += ' ' + C.bold + m + C.reset + C.menuBg + C.menuFg;
    }
    out += pad(menuBar, cols);
    out += C.reset;

    // === Panels (rows 2 to rows-3) ===
    for (let row = 0; row < contentRows; row++) {
      out += '\r\n';
      out += renderPanelRow(left, panelWidth, row, contentRows, activePanel === 'left');
      // Separator — blue bg with cyan vertical line
      out += C.panelBg + '\x1b[36m' + '\u2502';
      out += renderPanelRow(right, rightWidth, row, contentRows, activePanel === 'right');
      out += C.reset;
    }

    // === Function key bar ===
    out += '\r\n';
    out += C.menuBg + C.keyNum;
    const keys = [
      ['1', 'Help'], ['2', 'Menu'], ['3', 'View'], ['4', 'Edit'],
      ['5', 'Copy'], ['6', 'RenMov'], ['7', 'Mkdir'], ['8', 'Delete'],
      ['9', 'PullDn'], ['10', 'Quit']
    ];
    let keyBar = '';
    for (const [num, label] of keys) {
      keyBar += ' ' + C.keyNum + num + C.menuBg + C.keyLabel + label + C.reset + C.menuBg + C.keyNum;
    }
    // Pad to full width with cyan bg
    const stripped = keyBar.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, cols - stripped.length);
    out += keyBar + ' '.repeat(padLen);
    out += C.reset;

    // === Path bar (active panel paths) ===
    out += '\r\n';
    out += C.statusBg;
    const leftPath = truncPath(left.path);
    const rightPath = truncPath(right.path);
    const halfCols = Math.floor(cols / 2);

    // Left path (highlight if active panel)
    if (activePanel === 'left') {
      out += C.headerActive;
    } else {
      out += C.headerInactive;
    }
    out += ' ' + pad(leftPath, halfCols - 2) + ' ';
    out += C.reset;

    // Right path
    if (activePanel === 'right') {
      out += C.headerActive;
    } else {
      out += C.headerInactive;
    }
    out += pad(' ' + rightPath, cols - halfCols);
    out += C.reset;

    // Status message
    if (statusMsg) {
      out += '\r\n';
      out += C.menuBg + C.keyLabel + ' ' + statusMsg + C.reset;
    }

    term.write(out);
  }

  function renderPanelRow(p, width, row, totalRows, isActive) {
    const headerRow = 0;
    const fileRows = totalRows - 2; // -1 for header, -1 for potential count

    if (row === headerRow) {
      // Panel header — column titles
      let line = '';
      if (isActive) {
        line += C.headerActive;
      } else {
        line += C.headerInactive;
      }
      const permW = 11;
      const nameW = width - permW - 8;
      const sizeW = 7;
      line += pad(' Perm ', permW);
      line += pad(' Name ', nameW);
      line += pad(' Size ', sizeW);
      // Fill remainder
      const used = permW + nameW + sizeW;
      if (used < width) line += ' '.repeat(width - used);
      line += C.reset;
      return line;
    }

    // File entries
    const fileIdx = row - 1 + p.scroll;
    let line = '';

    if (fileIdx < p.files.length) {
      const entry = p.files[fileIdx];
      const isSelected = p.selected.has(fileIdx);
      const isCursor = fileIdx === p.cursor;
      const permW = 11;
      const nameW = width - permW - 8;
      const sizeW = 7;
      const color = fileColor(entry);

      let nameStr = entry.display || entry.name;
      if (entry.type === 'dir' && !nameStr.endsWith('/') && !entry.isParent) {
        nameStr += '/';
      }

      // Background: cursor on active panel gets cyan bg, selected gets green bg, else blue
      let bgCode;
      if (isCursor && isActive) {
        bgCode = C.markedBg;    // cyan bg for cursor
      } else if (isSelected) {
        bgCode = C.selectedBg;  // green bg for selected
      } else {
        bgCode = C.panelBg;     // blue bg
      }

      // Permissions column
      line += bgCode + C.dim + ' ' + pad(formatPermissions(entry), permW - 1);
      line += C.reset;

      // Re-apply bg
      line += bgCode;

      // Name column — apply file type color on top of bg
      if (isCursor && isActive) {
        line += color + C.bold;
      } else {
        line += color;
      }
      line += pad(nameStr, nameW);
      line += C.reset;

      // Re-apply bg
      line += bgCode;

      // Size column — yellow on blue
      const sizeStr = isDir(entry) ? '<DIR>' : formatSize(entry.size);
      line += '\x1b[33m' + pad(sizeStr, sizeW);
      line += C.reset;

    } else {
      // Empty row — fill with blue
      line += C.panelBg + ' '.repeat(width) + C.reset;
    }

    return line;
  }

  // --- Keyboard handling ---
  function handleKey(data) {
    if (!running) return;

    /* ---- Function keys (xterm.js emits multiple sequences) ---- */

    // SS3 mode: F1=\x1bOP F2=\x1bOQ F3=\x1bOR F4=\x1bOS
    if (data.length === 3 && data[0] === '\x1b' && data[1] === 'O') {
      const code = data.charCodeAt(2);
      const fNum = code - 80; // P(80)=F1, Q(81)=F2, R(82)=F3, S(83)=F4
      if (fNum >= 1 && fNum <= 4) { handleFnKey(fNum); return; }
    }

    // CSI mode: \x1b[NN~ or \x1b[NN;X~
    if (data.startsWith('\x1b[')) {
      const m = data.match(/^\x1b\[(\d+)(?:;(\d+))?~/);
      if (m) {
        const fNum = parseInt(m[1], 10);
        const mod = parseInt(m[2] || '0', 10);

        // F1-F12 (various terminal encodings)
        // xterm sends: F5=15, F6=17, F7=18, F8=19, F9=20, F10=21, F11=23, F12=24
        // Some terminals send: F1=11, F2=12, F3=13, F4=14, F5=15...
        const fMap = { 11:1, 12:2, 13:3, 14:4, 15:5, 17:6, 18:7, 19:8, 20:9, 21:10, 23:11, 24:12 };
        if (fMap[fNum]) { handleFnKey(fMap[fNum]); return; }

        // Delete = \x1b[3~
        if (fNum === 3) { handleFnKey(8); return; } // F8 = Delete in MC

        // Insert = \x1b[2~
        if (fNum === 2) { toggleSelect(); moveCursor(1); return; }

        // Page Up/Down
        if (fNum === 5) { // Page Up
          const page = Math.max(1, term.rows - 6);
          moveCursor(-page);
          return;
        }
        if (fNum === 6) { // Page Down
          const page = Math.max(1, term.rows - 6);
          moveCursor(page);
          return;
        }

        // Home/End via CSI
        if (fNum === 1) { goToFirst(); return; }
        if (fNum === 4) { goToLast(); return; }

        // Shift+arrows for select (mod=2)
        if (mod === 2) {
          if (fNum === 1) { toggleSelect(); moveCursor(-1); return; } // Shift+Up
          if (fNum === 2) { toggleSelect(); moveCursor(1); return; }  // Shift+Down
        }
      }

      // Plain arrow keys: \x1b[A \x1b[B \x1b[C \x1b[D
      if (data === '\x1b[A') { moveCursor(-1); return; }
      if (data === '\x1b[B') { moveCursor(1); return; }
      if (data === '\x1b[C') { switchPanel(); return; }
      if (data === '\x1b[D') { switchPanel(); return; }

      // Home/End \x1b[H \x1b[F
      if (data === '\x1b[H') { goToFirst(); return; }
      if (data === '\x1b[F') { goToLast(); return; }
    }

    // Enter
    if (data === '\r' || data === '\n') { enterDirectory(); return; }

    // Tab = switch panel
    if (data === '\t') { switchPanel(); return; }

    // Backspace = go to parent
    if (data === '\x7f' || data === '\b') { goToParent(); return; }

    // Ctrl shortcuts
    if (data === '\x01') { goToFirst(); return; }     // Ctrl+A = Home
    if (data === '\x05') { goToLast(); return; }      // Ctrl+E = End
    if (data === '\x06') { switchPanel(); return; }   // Ctrl+F = switch panel
    if (data === '\x0e') { moveCursor(1); return; }   // Ctrl+N = down
    if (data === '\x10') { moveCursor(-1); return; }  // Ctrl+P = up
    if (data === '\x11') { handleFnKey(10); return; } // Ctrl+Q = quit (MC style)
    if (data === '\x18') { handleFnKey(8); return; }  // Ctrl+X = delete

    // / = go to directory
    if (data === '/') { promptCommand('cd', 'Go to directory:'); return; }

    // ~ = go to home
    if (data === '~') {
      const p = panel();
      p.path = HOME;
      p.cursor = 0;
      p.scroll = 0;
      p.selected.clear();
      refreshPanel(p).then(render);
      return;
    }

    // \ = go to root
    if (data === '\\') {
      const p = panel();
      p.path = '/';
      p.cursor = 0;
      p.scroll = 0;
      p.selected.clear();
      refreshPanel(p).then(render);
      return;
    }

    // q = quit (only lowercase in MC, not Q)
    if (data === 'q') { handleFnKey(10); return; }

    // Space = select and move down (like MC)
    if (data === ' ') { toggleSelect(); moveCursor(1); return; }
  }

  async function handleFnKey(num) {
    switch (num) {
      case 1: showHelp(); break;
      case 2: break; // F2 = user menu (not implemented)
      case 3: await viewFile(); break;
      case 4: await editFile(); break;
      case 5: await copyFiles(); break;
      case 6: await moveFiles(); break;
      case 7: await makeDirectory(); break;
      case 8: await deleteFiles(); break;
      case 9: break; // F9 = pull-down menu (not implemented)
      case 10: quit(); break;
    }
  }

  function moveCursor(delta) {
    const p = panel();
    p.cursor = Math.max(0, Math.min(p.files.length - 1, p.cursor + delta));
    ensureVisible(p);
    render();
  }

  function goToFirst() {
    const p = panel();
    p.cursor = 0;
    p.scroll = 0;
    render();
  }

  function goToLast() {
    const p = panel();
    p.cursor = Math.max(0, p.files.length - 1);
    ensureVisible(p);
    render();
  }

  function ensureVisible(p) {
    const viewRows = Math.max(1, term.rows - 6);
    if (p.cursor < p.scroll) {
      p.scroll = p.cursor;
    } else if (p.cursor >= p.scroll + viewRows) {
      p.scroll = p.cursor - viewRows + 1;
    }
  }

  function switchPanel() {
    activePanel = activePanel === 'left' ? 'right' : 'left';
    render();
  }

  function toggleSelect() {
    const p = panel();
    if (p.selected.has(p.cursor)) {
      p.selected.delete(p.cursor);
    } else {
      p.selected.add(p.cursor);
    }
  }

  async function enterDirectory() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry) return;

    if (entry.isParent) { goToParent(); return; }

    if (isDir(entry)) {
      const sep = p.path.endsWith('/') ? '' : '/';
      p.path = p.path + sep + entry.name;
      p.cursor = 0;
      p.scroll = 0;
      p.selected.clear();
      await refreshPanel(p);
      render();
    } else {
      await viewFile();
    }
  }

  function goToParent() {
    const p = panel();
    if (p.path === '/') return;
    const parts = p.path.split('/').filter(Boolean);
    parts.pop();
    p.path = parts.length ? '/' + parts.join('/') : '/';
    p.cursor = 0;
    p.scroll = 0;
    p.selected.clear();
    refreshPanel(p).then(render);
  }

  // --- File operations ---

  async function getSelectedFiles() {
    const p = panel();
    if (p.selected.size > 0) {
      return [...p.selected].map(i => p.files[i]).filter(f => !f.isParent);
    }
    const entry = p.files[p.cursor];
    if (entry && !entry.isParent) return [entry];
    return [];
  }

  async function viewFile() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry || isDir(entry)) return;

    const filePath = p.path.endsWith('/') ? p.path + entry.name : p.path + '/' + entry.name;
    const content = await FS().fsReadFile(filePath);
    if (content == null) {
      statusMsg = 'Cannot read file';
      render();
      return;
    }

    await showViewer(entry.name, typeof content === 'string' ? content : new TextDecoder().decode(content));
  }

  async function showViewer(title, content) {
    const cols = term.cols;
    const rows = term.rows;
    const lines = content.split('\n');
    let scroll = 0;
    const viewRows = rows - 2;

    function drawViewer() {
      let v = '\x1b[2J\x1b[H';
      // Header — cyan bar (MC viewer style)
      v += C.viewerBg + C.bold;
      v += pad(' View: ' + title, cols);
      v += C.reset;
      // Content lines
      for (let i = 0; i < viewRows; i++) {
        v += '\r\n';
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          let line = lines[lineIdx];
          if (line.length > cols - 1) line = line.slice(0, cols - 1) + '$';
          v += C.white + ' ' + line;
        } else {
          v += ' ';
        }
      }
      // Bottom bar — cyan
      v += '\r\n';
      v += C.menuBg + C.keyNum;
      v += ' 1' + C.menuBg + C.keyLabel + 'Help';
      v += C.menuBg + C.keyNum + ' 3' + C.menuBg + C.keyLabel + 'Hex';
      v += C.menuBg + C.keyNum + ' 5' + C.menuBg + C.keyLabel + 'Goto';
      v += C.menuBg + C.keyNum + ' 7' + C.menuBg + C.keyLabel + 'Search';
      v += C.menuBg + C.keyNum + ' 9' + C.menuBg + C.keyLabel + 'Options';
      v += C.menuBg + C.keyNum + ' 10' + C.menuBg + C.keyLabel + 'Quit';
      const stripped = v.replace(/\x1b\[[0-9;]*m/g, '');
      v += ' '.repeat(Math.max(0, cols - stripped.length));
      v += C.reset;
      term.write(v);
    }

    drawViewer();

    return new Promise((resolve) => {
      let disposed = false;
      let disposable = null;
      function cleanup() {
        if (!disposed && disposable) { disposed = true; disposable.dispose(); }
      }
      function onKey(data) {
        if (data === '\x1b' || data === 'q' || data === '\x03') {
          cleanup();
          running = true;
          render();
          resolve();
          return;
        }
        if (data === '\x1b[A' || data === '\x05') {
          if (scroll > 0) { scroll--; drawViewer(); }
          return;
        }
        if (data === '\x1b[B' || data === '\x12') {
          if (scroll < lines.length - viewRows) { scroll++; drawViewer(); }
          return;
        }
        if (data === '\x1b[5~') { scroll = Math.max(0, scroll - viewRows); drawViewer(); return; }
        if (data === '\x1b[6~') { scroll = Math.min(Math.max(0, lines.length - viewRows), scroll + viewRows); drawViewer(); return; }
        if (data === '\x1b[H') { scroll = 0; drawViewer(); return; }
        if (data === '\x1b[F') { scroll = Math.max(0, lines.length - viewRows); drawViewer(); return; }
        // Ctrl+U = scroll up half page
        if (data === '\x15') { scroll = Math.max(0, scroll - Math.floor(viewRows / 2)); drawViewer(); return; }
        // Ctrl+D = scroll down half page
        if (data === '\x04') { scroll = Math.min(Math.max(0, lines.length - viewRows), scroll + Math.floor(viewRows / 2)); drawViewer(); return; }
      }
      running = false;
      disposable = term.onData(onKey);
    });
  }

  async function editFile() {
    const p = panel();
    const entry = p.files[p.cursor];
    if (!entry || isDir(entry)) {
      statusMsg = 'Cannot edit directory';
      render();
      return;
    }

    const filePath = p.path.endsWith('/') ? p.path + entry.name : p.path + '/' + entry.name;
    let content = await FS().fsReadFile(filePath);
    if (content == null) content = '';

    await showEditor(filePath, entry.name, typeof content === 'string' ? content : new TextDecoder().decode(content));
  }

  async function showEditor(filePath, title, initialContent) {
    const cols = term.cols;
    const rows = term.rows;
    const lines = initialContent.split('\n');
    let cursorRow = 0;
    let cursorCol = 0;
    let scroll = 0;
    let modified = false;
    const editRows = rows - 2;

    function drawEditor() {
      let e = '\x1b[2J\x1b[H';
      // Header — red bar (MC editor style)
      e += C.editorBar + C.bold;
      const titleText = ' Edit: ' + title + (modified ? ' *' : ' ');
      e += pad(titleText, cols);
      e += C.reset;
      // Content
      for (let i = 0; i < editRows; i++) {
        e += '\r\n';
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          let line = lines[lineIdx];
          if (line.length > cols) line = line.slice(0, cols);
          e += C.white + ' ' + line;
        } else {
          e += ' ' + C.dim + '~';
        }
      }
      // Bottom bar — red
      e += '\r\n';
      e += C.editorBar;
      let bar = ' 1' + C.bold + 'Help';
      bar += C.editorBar + ' 2' + C.bold + 'Save';
      bar += C.editorBar + ' 3' + C.bold + 'Mark';
      bar += C.editorBar + ' 4' + C.bold + 'Replac';
      bar += C.editorBar + ' 5' + C.bold + 'Copy';
      bar += C.editorBar + ' 6' + C.bold + 'Move';
      bar += C.editorBar + ' 7' + C.bold + 'Delete';
      bar += C.editorBar + ' 10' + C.bold + 'Quit';
      e += bar;
      const stripped = e.replace(/\x1b\[[0-9;]*m/g, '');
      e += ' '.repeat(Math.max(0, cols - stripped.length));
      e += C.reset;
      // Position cursor
      e += '\x1b[' + (cursorRow - scroll + 2) + ';' + (cursorCol + 2) + 'H';
      e += '\x1b[?25h'; // show cursor
      term.write(e);
    }

    drawEditor();

    return new Promise((resolve) => {
      let disposed = false;
      let disposable = null;
      function cleanup() {
        if (!disposed && disposable) { disposed = true; disposable.dispose(); }
      }
      function onKey(data) {
        if (data === '\x1b') {
          cleanup();
          term.write('\x1b[?25l');
          running = true;
          render();
          resolve();
          return;
        }
        // F2 or Ctrl+S = save
        if (data === '\x1bOQ' || data === '\x13') {
          const newContent = lines.join('\n');
          FS().fsWriteFile(filePath, newContent).then(() => {
            modified = false;
            statusMsg = 'Saved: ' + title;
            drawEditor();
          });
          return;
        }
        // F10 = quit
        if (data === '\x1b[21~' || data === '\x1bOS') {
          cleanup();
          term.write('\x1b[?25l');
          running = true;
          render();
          resolve();
          return;
        }
        if (data === '\x1b[A') {
          if (cursorRow > 0) cursorRow--;
          if (cursorRow < scroll) scroll = cursorRow;
          if (cursorCol > lines[cursorRow].length) cursorCol = lines[cursorRow].length;
          drawEditor();
          return;
        }
        if (data === '\x1b[B') {
          if (cursorRow < lines.length - 1) cursorRow++;
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          if (cursorCol > lines[cursorRow].length) cursorCol = lines[cursorRow].length;
          drawEditor();
          return;
        }
        if (data === '\x1b[C') {
          if (cursorCol < lines[cursorRow].length) cursorCol++;
          else if (cursorRow < lines.length - 1) { cursorRow++; cursorCol = 0; }
          drawEditor();
          return;
        }
        if (data === '\x1b[D') {
          if (cursorCol > 0) cursorCol--;
          else if (cursorRow > 0) { cursorRow--; cursorCol = lines[cursorRow].length; }
          drawEditor();
          return;
        }
        if (data === '\r') {
          const before = lines[cursorRow].slice(0, cursorCol);
          const after = lines[cursorRow].slice(cursorCol);
          lines[cursorRow] = before;
          lines.splice(cursorRow + 1, 0, after);
          cursorRow++;
          cursorCol = 0;
          modified = true;
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          drawEditor();
          return;
        }
        if (data === '\x7f' || data === '\b') {
          if (cursorCol > 0) {
            lines[cursorRow] = lines[cursorRow].slice(0, cursorCol - 1) + lines[cursorRow].slice(cursorCol);
            cursorCol--;
            modified = true;
          } else if (cursorRow > 0) {
            cursorCol = lines[cursorRow - 1].length;
            lines[cursorRow - 1] += lines[cursorRow];
            lines.splice(cursorRow, 1);
            cursorRow--;
            modified = true;
          }
          drawEditor();
          return;
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
          drawEditor();
          return;
        }
        if (data === '\t') {
          lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + '  ' + lines[cursorRow].slice(cursorCol);
          cursorCol += 2;
          modified = true;
          drawEditor();
          return;
        }
        // Home
        if (data === '\x1b[H' || data === '\x01') { cursorCol = 0; drawEditor(); return; }
        // End
        if (data === '\x1b[F' || data === '\x05') { cursorCol = lines[cursorRow].length; drawEditor(); return; }
        // Regular character
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + data + lines[cursorRow].slice(cursorCol);
          cursorCol++;
          modified = true;
          drawEditor();
          return;
        }
      }
      running = false;
      disposable = term.onData(onKey);
    });
  }

  async function copyFiles() {
    const p = panel();
    const op = otherPanel();
    const files = await getSelectedFiles();
    if (files.length === 0) {
      statusMsg = 'No file selected';
      render();
      return;
    }

    const destInput = await promptInput('Copy to: ' + truncPath(op.path) + '/');
    if (destInput === null) { render(); return; }
    const suffix = destInput || '';

    for (const file of files) {
      const srcPath = p.path.endsWith('/') ? p.path + file.name : p.path + '/' + file.name;
      let dstPath = op.path.endsWith('/') ? op.path : op.path + '/';
      if (suffix) dstPath += suffix;
      else dstPath += file.name;
      try {
        if (isDir(file)) {
          const allFiles = await FS().fsList();
          const srcPrefix = srcPath.endsWith('/') ? srcPath : srcPath + '/';
          const filesToCopy = allFiles.filter(f => f.path.startsWith(srcPrefix) && f.type !== 'directory');
          for (const f of filesToCopy) {
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
          // Also create the directory itself
          if (!(await FS().fsIsDir(dstPath))) await FS().fsMkdir(dstPath);
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

    statusMsg = files.length + ' item(s) copied';
    await refreshPanel(op);
    render();
  }

  async function moveFiles() {
    const p = panel();
    const op = otherPanel();
    const files = await getSelectedFiles();
    if (files.length === 0) {
      statusMsg = 'No file selected';
      render();
      return;
    }

    for (const file of files) {
      const srcPath = p.path.endsWith('/') ? p.path + file.name : p.path + '/' + file.name;
      const dstPath = op.path.endsWith('/') ? op.path + file.name : op.path + '/' + file.name;
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
        }
      } catch (e) {
        statusMsg = 'Move error: ' + e.message;
      }
    }

    statusMsg = files.length + ' item(s) moved';
    await refreshPanel(p);
    await refreshPanel(op);
    render();
  }

  async function makeDirectory() {
    const p = panel();
    const name = await promptInput('New directory name:');
    if (!name) { render(); return; }

    const dirPath = p.path.endsWith('/') ? p.path + name : p.path + '/' + name;
    try {
      await FS().fsMkdir(dirPath);
      statusMsg = 'Created: ' + name;
      await refreshPanel(p);
    } catch (e) {
      statusMsg = 'Error: ' + e.message;
    }
    render();
  }

  async function deleteFiles() {
    const p = panel();
    const files = await getSelectedFiles();
    if (files.length === 0) {
      statusMsg = 'No file selected';
      render();
      return;
    }

    const confirmed = await promptConfirm('Delete ' + files.length + ' item(s)? (y/n)');
    if (!confirmed) {
      statusMsg = 'Delete cancelled';
      render();
      return;
    }

    let deleted = 0;
    for (const file of files) {
      const filePath = p.path.endsWith('/') ? p.path + file.name : p.path + '/' + file.name;
      try {
        if (isDir(file)) {
          const allFiles = await FS().fsList();
          const prefix = filePath.endsWith('/') ? filePath : filePath + '/';
          for (const f of allFiles) {
            if (f.path === filePath || f.path.startsWith(prefix)) {
              await FS().fsDel(f.path);
            }
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
    statusMsg = deleted + ' item(s) deleted';
    await refreshPanel(p);
    render();
  }

  // --- Prompt dialogs ---

  function promptInput(message) {
    return new Promise((resolve) => {
      const cols = term.cols;
      const rows = term.rows;
      const boxW = Math.min(60, cols - 4);
      const boxH = 5;
      const startRow = Math.floor((rows - boxH) / 2);
      const startCol = Math.floor((cols - boxW) / 2);

      let box = '\x1b[2J\x1b[H';

      // Dim background
      for (let r = 0; r < rows; r++) {
        box += '\r\n';
        if (r >= startRow && r < startRow + boxH) {
          box += ' '.repeat(startCol);
          if (r === startRow) {
            // Top border
            box += C.menuBg + C.white;
            box += '\u250C' + '\u2500'.repeat(boxW - 2) + '\u2510';
            box += C.reset;
          } else if (r === startRow + 1) {
            // Title
            box += C.menuBg + C.white;
            box += '\u2502';
            const title = ' ' + message + ' ';
            const pad2 = Math.max(0, boxW - 2 - title.length);
            box += C.bold + title + C.reset + C.menuBg + C.white;
            box += ' '.repeat(pad2);
            box += '\u2502';
            box += C.reset;
          } else if (r === startRow + 2) {
            // Separator
            box += C.menuBg + C.white;
            box += '\u251C' + '\u2500'.repeat(boxW - 2) + '\u2524';
            box += C.reset;
          } else if (r === startRow + 3) {
            // Input line
            box += C.menuBg + C.white;
            box += '\u2502';
            box += ' > ';
            box += ' '.repeat(Math.max(0, boxW - 6));
            box += '\u2502';
            box += C.reset;
          } else {
            // Bottom border
            box += C.menuBg + C.white;
            box += '\u2514' + '\u2500'.repeat(boxW - 2) + '\u2518';
            box += C.reset;
          }
        }
      }
      term.write(box);

      // Position cursor on input line
      const inputRow = startRow + 4;
      const inputCol = startCol + 4;
      term.write('\x1b[' + inputRow + ';' + inputCol + 'H');
      term.write('\x1b[?25h'); // show cursor

      let inputBuf = '';

      function onKey(data) {
        if (data === '\r') {
          disposable.dispose();
          term.write('\x1b[?25l');
          resolve(inputBuf.trim());
          return;
        }
        if (data === '\x1b') {
          disposable.dispose();
          term.write('\x1b[?25l');
          resolve(null);
          return;
        }
        if (data === '\x7f' || data === '\b') {
          if (inputBuf.length > 0) {
            inputBuf = inputBuf.slice(0, -1);
            term.write('\b \b');
          }
          return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          inputBuf += data;
          term.write(data);
        }
      }
      const disposable = term.onData(onKey);
    });
  }

  function promptConfirm(message) {
    return new Promise((resolve) => {
      const cols = term.cols;
      const rows = term.rows;
      const msg = message + ' ';
      const boxW = Math.min(msg.length + 6, cols - 4);
      const startCol = Math.floor((cols - boxW) / 2);
      const row = rows - 1;

      let box = '\x1b[' + row + ';1H';
      box += C.menuBg + C.white;
      box += ' '.repeat(startCol);
      box += '\u250C' + '\u2500'.repeat(boxW - 2) + '\u2510';
      box += '\r\n';
      box += ' '.repeat(startCol);
      box += '\u2502 ' + C.bold + msg + C.reset + C.menuBg + C.white + ' \u2502';
      box += '\r\n';
      box += ' '.repeat(startCol);
      box += '\u2514' + '\u2500'.repeat(boxW - 2) + '\u2518';
      box += C.reset;
      term.write(box);

      const disposable = term.onData((data) => {
        disposable.dispose();
        resolve(data === 'y' || data === 'Y');
      });
    });
  }

  async function promptCommand(cmd, message) {
    const input = await promptInput(message);
    if (input === null) {
      render();
      return;
    }
    if (!input) { render(); return; }

    if (cmd === 'cd') {
      const p = panel();
      let target = input;
      if (target === '~') target = HOME;
      else if (target.startsWith('~/')) target = HOME + target.slice(1);
      p.path = target;
      p.cursor = 0;
      p.scroll = 0;
      p.selected.clear();
      await refreshPanel(p);
      render();
    }
  }

  function showHelp() {
    const lines = [
      '  Midnight Commander Help',
      '',
      '  Navigation:',
      '    Up/Down       Move cursor',
      '    Left/Right    Switch panel',
      '    Enter         Open file / directory',
      '    Tab           Switch panel',
      '    Backspace     Go to parent directory',
      '    /             Go to directory',
      '    ~             Go to home directory',
      '    \\             Go to root directory',
      '    Home / Ctrl+A Go to first file',
      '    End  / Ctrl+E Go to last file',
      '    PgUp / PgDn   Page up / down',
      '',
      '  Selection:',
      '    Insert / Space   Toggle select',
      '    Shift+Arrow      Select while moving',
      '',
      '  Function keys:',
      '    F1         Help',
      '    F3         View file',
      '    F4         Edit file',
      '    F5         Copy',
      '    F6         Move / Rename',
      '    F7         Make directory',
      '    F8 / Del   Delete',
      '    F10        Quit',
      '',
      '  Editor:',
      '    F2 / Ctrl+S    Save',
      '    F10 / Esc      Quit',
      '',
      '  Viewer:',
      '    Up/Down     Scroll line',
      '    PgUp/PgDn   Scroll page',
      '    Home/End    Top / Bottom',
      '    Esc / q     Close',
      '',
      '  Press any key to close...',
    ];
    showViewer('Help', lines.join('\n'));
  }

  function quit() {
    running = false;
    if (resolveExit) {
      resolveExit();
      resolveExit = null;
    }
  }

  // --- Public API ---
  return {
    async launch(xterm, startPath) {
      term = xterm;
      activePanel = 'left';
      left.path = startPath || HOME;
      left.cursor = 0;
      left.scroll = 0;
      left.selected.clear();
      right.path = PREFIX;
      right.cursor = 0;
      right.scroll = 0;
      right.selected.clear();
      statusMsg = '';
      running = true;

      await Promise.all([refreshPanel(left), refreshPanel(right)]);

      return new Promise((resolve) => {
        resolveExit = resolve;
        render();
      });
    },

    handleKey,

    isRunning() { return running; },
  };
})();

window.TermuxMC = TermuxMC;
