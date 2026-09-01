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

    // Button bar (real MC default skin: black bg, white hotkey + white label)
    bbBg:        '\x1b[40m',
    bbHotkey:    '\x1b[1;37m',       // bold white key numbers
    bbLabel:     '\x1b[37m',         // white labels

    // Menu bar (real MC default skin: cyan bg, black text, yellow hotkeys)
    menuBg:      '\x1b[46m',         // cyan bg for menu bar
    menuFg:      '\x1b[30m',         // black text on cyan (no bold for better compat)
    keyNum:      '\x1b[1;33m',       // yellow key numbers
    keyLabel:    '\x1b[1;37m',       // bold white key labels

    // Active panel header (real MC: bold black on cyan)
    headerActive:    '\x1b[1;46;30m', // bold black on cyan
    // Inactive panel header (real MC: cyan on blue, but we use brighter cyan for visibility)
    headerInactive:  '\x1b[1;44;36m',  // bold cyan on blue

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
  let sortMode = 'name';
  let showHidden = false;

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

  // --- Button bar (replicates lib/widget/buttonbar.c) ---
  // Real MC: full screen width divided into 10 buttons, min width 7,
  // extra width distributed so the F5/F6 border aligns with the panel separator.
  const BUTTONBAR_LABELS_NUM = 10;
  function bbButtonWidths(cols) {
    if (cols < BUTTONBAR_LABELS_NUM * 7) {
      // Degenerate: only first (COLS/7) buttons fit
      const n = Math.floor(cols / 7);
      return Array.from({ length: BUTTONBAR_LABELS_NUM }, (_, i) => (i < n ? 7 : 0));
    }
    const dv = Math.floor(cols / BUTTONBAR_LABELS_NUM);
    const md = cols % BUTTONBAR_LABELS_NUM;
    const widths = [];
    // First md buttons get dv+1, rest get dv — extra space placed so the
    // middle (between F5 and F6) aligns with the center of the screen.
    for (let i = 0; i < BUTTONBAR_LABELS_NUM; i++) {
      widths.push(dv + (i < md ? 1 : 0));
    }
    return widths;
  }

  function drawButtonBar(keys, cols) {
    const widths = bbButtonWidths(cols);
    let out = '';
    for (let i = 0; i < BUTTONBAR_LABELS_NUM; i++) {
      const w = widths[i];
      if (w <= 0) continue;
      const [num, label] = keys[i];
      // Real MC: "%2d" hotkey then label left-fitted to width-2 (buttonbar.c)
      const numText = String(num).padStart(2, ' ');
      let labelText = label.slice(0, Math.max(0, w - 2));
      if (labelText.length < w - 2) labelText += ' '.repeat(w - 2 - labelText.length);
      out += C.bbBg + C.bbHotkey + numText + C.bbLabel + labelText;
    }
    // Pad any remaining width (degenerate narrow terminal)
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '').length;
    out += C.bbBg + ' '.repeat(Math.max(0, cols - stripped));
    out += C.reset;
    return out;
  }

  // --- Rendering ---
  function render() {
    const cols = term.cols;
    const rows = term.rows;
    const panelWidth = Math.floor((cols - 1) / 2);
    const rightWidth = cols - panelWidth - 1;
    // Real MC layout: menu(1) + pathHeader(1) + panels(N-3) + buttonbar(1) = rows
    const contentRows = rows - 3;

    let out = '';

    // Clear screen + hide cursor
    out += '\x1b[2J\x1b[H';
    out += '\x1b[?25l'; // hide cursor

    // === Row 1: Top menu bar (cyan bg, black text, bold first letter) ===
    out += C.menuBg + C.menuFg;
    const menuItems = ['Left', 'File', 'Command', 'Options', 'Right'];
    let menuBar = '';
    for (const m of menuItems) {
      // Real MC: first letter bold+yellow as hotkey, rest normal
      menuBar += ' ' + C.bold + m[0] + C.reset + C.menuBg + C.menuFg + m.slice(1);
    }
    out += pad(menuBar, cols);
    out += C.reset;

    // === Row 2: Path headers (directory paths like real MC) ===
    const leftPath = truncPath(left.path);
    const rightPath = truncPath(right.path);
    const halfCols = Math.floor(cols / 2);
    out += '\r\n';
    // Left path (active = bold black on cyan, inactive = cyan on blue)
    out += (activePanel === 'left') ? C.headerActive : C.headerInactive;
    out += ' ' + pad(leftPath, halfCols - 2) + ' ';
    out += C.reset;
    // Right path
    out += (activePanel === 'right') ? C.headerActive : C.headerInactive;
    out += pad(' ' + rightPath, cols - halfCols);
    out += C.reset;

    // === Rows 3..N-1: Panel content (file listing) ===
    const fileContentRows = contentRows - 1; // -1 for the path header already drawn
    for (let row = 0; row < fileContentRows; row++) {
      out += '\r\n';
      out += renderPanelRow(left, panelWidth, row, fileContentRows, activePanel === 'left');
      // Space after left panel sizes, then separator with 2-char indent
      out += C.panelBg + ' ';
      out += '\x1b[36m' + '\u2502  ';
      out += renderPanelRow(right, rightWidth - 2, row, fileContentRows, activePanel === 'right');
      out += C.reset;
    }

    // === Last row: Buttonbar (full width, black bg — real MC buttonbar.c) ===
    out += '\r\n';
    const keys = [
      ['1', 'Help'], ['2', 'Menu'], ['3', 'View'], ['4', 'Edit'],
      ['5', 'Copy'], ['6', 'RenMov'], ['7', 'Mkdir'], ['8', 'Delete'],
      ['9', 'PullDn'], ['10', 'Quit']
    ];
    out += drawButtonBar(keys, cols);

    term.write(out);
  }

  function renderPanelRow(p, width, row, totalRows, isActive) {
    // File entries — row 0 is the first file row (no header row here;
    // the directory path header is drawn separately in render())
    const fileIdx = row + p.scroll;
    let line = '';

    if (fileIdx < p.files.length) {
      const entry = p.files[fileIdx];
      const isSelected = p.selected.has(fileIdx);
      const isCursor = fileIdx === p.cursor;
      const permW = 11;
      const nameW = width - permW - 9;
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

      // Permissions column — black text, trailing space separates from name
      line += bgCode + '\x1b[30m' + ' ' + pad(formatPermissions(entry), permW - 1) + ' ';
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
      // Empty row — fill with blue (width-1 to match file row width)
      line += C.panelBg + ' '.repeat(width - 1) + C.reset;
    }

    return line;
  }

  // --- Function key matching (all xterm.js encodings) ---
  // Returns function key number 1-12 for any known encoding, else 0.
  // SS3: \x1bOP..OS = F1-F4. CSI tilde: \x1b[11~=F1 .. \x1b[24~=F12 (xterm gaps included).
  function matchFnKey(data) {
    if (data.length === 3 && data[0] === '\x1b' && data[1] === 'O') {
      const fNum = data.charCodeAt(2) - 80; // P=80→F1, Q=81→F2, R=82→F3, S=83→F4
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

  // --- Keyboard handling ---
  function handleKey(data) {
    if (!running) return;

    /* ---- Function keys (all xterm.js encodings) ---- */
    const fk = matchFnKey(data);
    if (fk >= 1 && fk <= 10) { handleFnKey(fk); return; }

    // CSI mode: other sequences
    if (data.startsWith('\x1b[')) {
      const m = data.match(/^\x1b\[(\d+)(?:;(\d+))?~/);
      if (m) {
        const fNum = parseInt(m[1], 10);
        const mod = parseInt(m[2] || '0', 10);

        // Delete = \x1b[3~
        if (fNum === 3 && !m[2]) { handleFnKey(8); return; } // F8 = Delete in MC

        // Insert = \x1b[2~
        if (fNum === 2 && !m[2]) { toggleSelect(); moveCursor(1); return; }

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

  // --- F9 PullDown menu (real MC: activates top menu bar, drop-down navigation) ---
  async function showPullDownMenu() {
    const menus = buildMenus();
    const titles = menus.map(m => m.title);
    running = false;
    const choice = await activateTopMenu(titles, menus);
    running = true;
    if (choice === null || choice === undefined) { render(); return; }
  }

  // Real MC top menu bar activation: highlights a title, arrow left/right moves,
  // Enter/Down opens drop-down, arrow up/down navigates items, Enter selects, Esc closes
  function activateTopMenu(titles, menus) {
    return new Promise((resolve) => {
      const cols = term.cols;
      let menuIdx = 0;
      let openMenu = false;
      let itemIdx = 0;
      let currentMenuItems = [];

      function calcMenuPositions() {
        const positions = [];
        let x = 1;
        for (const t of titles) {
          positions.push({ x, w: t.length + 2 });
          x += t.length + 2;
        }
        return positions;
      }
      const positions = calcMenuPositions();

      function drawMenuBar() {
        // Redraw the full top menu bar
        let out = '\x1b[1;1H';
        out += C.menuBg + C.menuFg;
        let barStr = '';
        for (let i = 0; i < titles.length; i++) {
          const t = titles[i];
          if (i === menuIdx && openMenu) {
            // Active menu title — reverse video (real MC: highlighted title)
            barStr += '\x1b[7m ' + t + ' ' + C.reset + C.menuBg + C.menuFg;
          } else if (i === menuIdx) {
            barStr += ' ' + C.bold + t[0] + C.reset + C.menuBg + C.menuFg + t.slice(1) + ' ';
          } else {
            barStr += ' ' + t + ' ';
          }
        }
        out += pad(barStr, cols);
        out += C.reset;
        term.write(out);
      }

      function drawDropDown() {
        currentMenuItems = menus[menuIdx].items.map(i => i.label);
        itemIdx = Math.min(itemIdx, currentMenuItems.length - 1);
        const pos = positions[menuIdx];
        const dropW = Math.max(20, ...currentMenuItems.map(l => l.length + 4));

        // Draw drop-down box below the menu title
        let dd = '';
        dd += '\x1b[2;' + (pos.x + 1) + 'H';
        dd += C.menuBg + C.menuFg;
        dd += '\u250C' + '\u2500'.repeat(dropW - 2) + '\u2510';
        for (let i = 0; i < currentMenuItems.length; i++) {
          dd += '\x1b[' + (3 + i) + ';' + (pos.x + 1) + 'H';
          dd += '\u2502';
          const label = ' ' + currentMenuItems[i] + ' ';
          const padded = label.padEnd(dropW - 2);
          if (i === itemIdx) {
            dd += '\x1b[7m' + padded + C.reset;
          } else {
            dd += C.menuBg + C.menuFg + padded;
          }
          dd += '\u2502';
        }
        const bottomRow = 3 + currentMenuItems.length;
        dd += '\x1b[' + bottomRow + ';' + (pos.x + 1) + 'H';
        dd += '\u2514' + '\u2500'.repeat(dropW - 2) + '\u2518';
        dd += C.reset;
        term.write(dd);
      }

      function clearDropDown() {
        // Clear the drop-down area (rows 2 to 2+maxItems)
        const maxItems = 20;
        let clear = '';
        for (let r = 2; r < 2 + maxItems; r++) {
          clear += '\x1b[' + r + ';1H' + ' '.repeat(cols);
        }
        term.write(clear);
      }

      drawMenuBar();

      function onKey(data) {
        const fk = matchFnKey(data);
        if (!openMenu) {
          // Menu bar level: Left/Right moves between menus, Enter/Down opens, Esc closes
          if (data === '\x1b' || fk === 9 || fk === 10 || data === '\x03') {
            disposable.dispose();
            resolve(null);
            return;
          }
          if (data === '\x1b[D') { // Left
            menuIdx = (menuIdx - 1 + titles.length) % titles.length;
            drawMenuBar();
            return;
          }
          if (data === '\x1b[C') { // Right
            menuIdx = (menuIdx + 1) % titles.length;
            drawMenuBar();
            return;
          }
          if (data === '\r' || data === '\n' || data === '\x1b[B') { // Enter or Down
            openMenu = true;
            itemIdx = 0;
            drawMenuBar();
            drawDropDown();
            return;
          }
          // First-letter jump on menu titles
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            const ch = data.toLowerCase();
            const found = titles.findIndex(t => t.toLowerCase().startsWith(ch));
            if (found >= 0) {
              menuIdx = found;
              openMenu = true;
              itemIdx = 0;
              drawMenuBar();
              drawDropDown();
              return;
            }
          }
        } else {
          // Drop-down level: Up/Down navigates, Enter selects, Esc/Left/Right closes
          if (data === '\x1b' || fk === 9 || fk === 10 || data === '\x03') {
            clearDropDown();
            openMenu = false;
            drawMenuBar();
            disposable.dispose();
            resolve(null);
            return;
          }
          if (data === '\x1b[A') { // Up
            itemIdx = (itemIdx - 1 + currentMenuItems.length) % currentMenuItems.length;
            clearDropDown();
            drawMenuBar();
            drawDropDown();
            return;
          }
          if (data === '\x1b[B') { // Down
            itemIdx = (itemIdx + 1) % currentMenuItems.length;
            clearDropDown();
            drawMenuBar();
            drawDropDown();
            return;
          }
          if (data === '\r' || data === '\n') { // Enter = select item
            clearDropDown();
            openMenu = false;
            drawMenuBar();
            disposable.dispose();
            const entry = menus[menuIdx].items[itemIdx];
            if (entry && entry.action) {
              statusMsg = entry.label;
              entry.action().then(() => { resolve(null); });
            } else {
              resolve(null);
            }
            return;
          }
          if (data === '\x1b[C') { // Right = next menu
            clearDropDown();
            menuIdx = (menuIdx + 1) % titles.length;
            itemIdx = 0;
            drawMenuBar();
            drawDropDown();
            return;
          }
          if (data === '\x1b[D') { // Left = previous menu
            clearDropDown();
            menuIdx = (menuIdx - 1 + titles.length) % titles.length;
            itemIdx = 0;
            drawMenuBar();
            drawDropDown();
            return;
          }
          // First-letter jump on items
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            const ch = data.toLowerCase();
            const found = currentMenuItems.findIndex(l => l.toLowerCase().startsWith(ch));
            if (found >= 0) {
              itemIdx = found;
              clearDropDown();
              drawMenuBar();
              drawDropDown();
              return;
            }
          }
        }
      }
      const disposable = term.onData(onKey);
    });
  }

  function buildMenus() {
    return [
      {
        title: 'Left',
        items: [
          { label: 'Sort by name', action: async () => { sortMode = 'name'; await refreshPanelsKeepSel(); } },
          { label: 'Sort by size', action: async () => { sortMode = 'size'; await refreshPanelsKeepSel(); } },
          { label: 'Reset', action: async () => { left.path = HOME; left.cursor = 0; left.scroll = 0; left.selected.clear(); await refreshPanel(left); } },
        ]
      },
      {
        title: 'File',
        items: [
          { label: 'View (F3)', action: viewFile },
          { label: 'Edit (F4)', action: editFile },
          { label: 'Copy (F5)', action: copyFiles },
          { label: 'RenMov (F6)', action: moveFiles },
          { label: 'Mkdir (F7)', action: makeDirectory },
          { label: 'Delete (F8)', action: deleteFiles },
          { label: 'Exit (F10)', action: quit },
        ]
      },
      {
        title: 'Command',
        items: [
          { label: 'Go to home', action: async () => { const p = panel(); p.path = HOME; p.cursor = 0; p.scroll = 0; p.selected.clear(); await refreshPanel(p); } },
          { label: 'Go to root', action: async () => { const p = panel(); p.path = '/'; p.cursor = 0; p.scroll = 0; p.selected.clear(); await refreshPanel(p); } },
          { label: 'Swap panels', action: async () => {
              [left.path, right.path] = [right.path, left.path];
              [left.cursor, right.cursor] = [right.cursor, left.cursor];
              [left.scroll, right.scroll] = [right.scroll, left.scroll];
              const ls = left.selected; left.selected = right.selected; right.selected = ls;
              await Promise.all([refreshPanel(left), refreshPanel(right)]);
            } },
        ]
      },
      {
        title: 'Options',
        items: [
          { label: 'Layout: ' + (showHidden ? 'show hidden files' : 'standard'), action: async () => { showHidden = !showHidden; await refreshPanelsKeepSel(); } },
          { label: 'Save setup', action: async () => { statusMsg = 'Setup saved (auto in browser)'; } },
        ]
      },
      {
        title: 'Right',
        items: [
          { label: 'Sort by name', action: async () => { sortMode = 'name'; await refreshPanelsKeepSel(); } },
          { label: 'Sort by size', action: async () => { sortMode = 'size'; await refreshPanelsKeepSel(); } },
          { label: 'Reset', action: async () => { right.path = PREFIX; right.cursor = 0; right.scroll = 0; right.selected.clear(); await refreshPanel(right); } },
        ]
      },
    ];
  }

  async function refreshPanelsKeepSel() {
    await Promise.all([refreshPanel(left), refreshPanel(right)]);
  }

  // --- F2 User menu (real mc.menu subset) ---
  async function showUserMenu() {
    const p = panel();
    const entry = p.files[p.cursor];
    const items = [
      { label: 'View file', action: viewFile },
      { label: 'Edit file', action: editFile },
      { label: 'Copy file', action: copyFiles },
      { label: 'mkdir /tmp', action: async () => { if (!(await FS().fsIsDir('/tmp'))) await FS().fsMkdir('/tmp'); statusMsg = 'Created /tmp'; } },
    ];
    running = false;
    const choice = await promptMenu('User menu', items.map(i => i.label));
    running = true;
    if (choice === null || choice === undefined) { render(); return; }
    const it = items[choice];
    if (it && it.action) await it.action();
    render();
  }

  // --- Horizontal menu selector (real MC look: dialog at top, arrows + Enter, Esc cancels) ---
  function promptMenu(title, labels) {
    return new Promise((resolve) => {
      const cols = term.cols;
      let idx = 0;
      const width = Math.max(title.length + 4, ...labels.map(l => l.length + 6), 20);
      const height = labels.length + 2;
      const row = 2; // just below menu bar
      const col = 1;

      function draw() {
        let out = '\x1b[' + (row + 1) + ';' + (col + 1) + 'H';
        out += C.menuBg + C.menuFg;
        // Border
        out += '\u250C' + '\u2500'.repeat(width - 2) + '\u2510';
        for (let i = 0; i < labels.length; i++) {
          out += '\r\n' + ' '.repeat(col);
          out += i === idx ? '\x1b[7m' : C.menuBg;
          const line = ' ' + labels[i].padEnd(width - 4) + ' ';
          out += ' ' + line + ' ';
          out += C.reset + C.menuBg + C.menuFg;
        }
        out += '\r\n' + ' '.repeat(col);
        out += '\u2514' + '\u2500'.repeat(width - 2) + '\u2518';
        out += C.reset;
        term.write(out);
      }

      draw();

      function onKey(data) {
        const fk = matchFnKey(data);
        if (data === '\x1b' || fk === 10 || data === '\x03') {
          disposable.dispose();
          resolve(null);
          return;
        }
        if (data === '\x1b[A' || data === '\x10') { // Up / Ctrl+P
          idx = (idx - 1 + labels.length) % labels.length;
          draw();
          return;
        }
        if (data === '\x1b[B' || data === '\x0e') { // Down / Ctrl+N
          idx = (idx + 1) % labels.length;
          draw();
          return;
        }
        if (data === '\r' || data === '\n') {
          disposable.dispose();
          resolve(idx);
          return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          // First-letter jump
          const ch = data.toLowerCase();
          const found = labels.findIndex(l => l.toLowerCase().startsWith(ch));
          if (found >= 0) { idx = found; draw(); return; }
        }
      }
      const disposable = term.onData(onKey);
    });
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
    const viewRows = Math.max(1, term.rows - 3); // menu + path header + buttonbar
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
      // Bottom bar — real MC viewer buttonbar (black bg, full width)
      v += '\r\n';
      const viewKeys = [
        ['1', 'Help'], ['2', 'View'], ['3', 'Hex'], ['4', 'Raw'],
        ['5', 'Goto'], ['6', 'Rfrsh'], ['7', 'Search'], ['8', 'Delete?'],
        ['9', 'Options'], ['10', 'Quit']
      ];
      term.write(v + drawButtonBar(viewKeys, cols));
      return;
    }

    drawViewer();

    return new Promise((resolve) => {
      let disposed = false;
      let disposable = null;
      function cleanup() {
        if (!disposed && disposable) { disposed = true; disposable.dispose(); }
      }
      function onKey(data) {
        // F10 = quit viewer (real MC); also Esc, q, Ctrl+C
        if (data === '\x1b' || data === 'q' || data === '\x03' || matchFnKey(data) === 10) {
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
      // Bottom bar — real MC editor buttonbar (black bg, per editwidget.c)
      e += '\r\n';
      const editKeys = [
        ['1', 'Help'], ['2', 'Save'], ['3', 'Mark'], ['4', 'Replac'],
        ['5', 'Copy'], ['6', 'Move'], ['7', 'Search'], ['8', 'Delete'],
        ['9', 'PullDn'], ['10', 'Quit']
      ];
      e += drawButtonBar(editKeys, cols);
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
        // F2 or Ctrl+S = save (all xterm.js F2 encodings)
        const efk = matchFnKey(data);
        if (efk === 2 || data === '\x13') {
          const newContent = lines.join('\n');
          FS().fsWriteFile(filePath, newContent).then(() => {
            modified = false;
            statusMsg = 'Saved: ' + title;
            drawEditor();
          });
          return;
        }
        // F10 = quit (all xterm.js F10 encodings)
        if (matchFnKey(data) === 10) {
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

    running = false;
    const destInput = await promptInput('Copy to: ' + truncPath(op.path) + '/');
    running = true;
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
    running = false;
    const name = await promptInput('New directory name:');
    running = true;
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

    running = false;
    const confirmed = await promptConfirm('Delete ' + files.length + ' item(s)? (y/n)');
    running = true;
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

      // Clear the area under the dialog first
      let box = '';
      for (let r = startRow; r < startRow + boxH; r++) {
        box += '\x1b[' + (r + 1) + ';' + (startCol + 1) + 'H';
        box += C.menuBg + ' '.repeat(boxW);
      }

      // Draw box using cursor positioning
      // Top border
      box += '\x1b[' + (startRow + 1) + ';' + (startCol + 1) + 'H';
      box += C.menuBg + C.white;
      box += '\u250C' + '\u2500'.repeat(boxW - 2) + '\u2510';
      // Title row
      box += '\x1b[' + (startRow + 2) + ';' + (startCol + 1) + 'H';
      box += '\u2502';
      const title = ' ' + message + ' ';
      const pad2 = Math.max(0, boxW - 2 - title.length);
      box += C.bold + title + C.reset + C.menuBg + C.white;
      box += ' '.repeat(pad2);
      box += '\u2502';
      // Separator row
      box += '\x1b[' + (startRow + 3) + ';' + (startCol + 1) + 'H';
      box += '\u251C' + '\u2500'.repeat(boxW - 2) + '\u2524';
      // Input row
      box += '\x1b[' + (startRow + 4) + ';' + (startCol + 1) + 'H';
      box += '\u2502';
      box += ' > ';
      box += ' '.repeat(Math.max(0, boxW - 6));
      box += '\u2502';
      // Bottom border
      box += '\x1b[' + (startRow + 5) + ';' + (startCol + 1) + 'H';
      box += '\u2514' + '\u2500'.repeat(boxW - 2) + '\u2518';
      box += C.reset;
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
    running = false;
    const input = await promptInput(message);
    running = true;
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
