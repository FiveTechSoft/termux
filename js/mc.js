/* =====================================================================
   Termux Web — Midnight Commander (mc) File Manager
   Two-panel file manager for the virtual filesystem.
   ===================================================================== */
'use strict';

const TermuxMC = (() => {
  const FS = () => window.TermuxFS;
  const PREFIX = '/data/data/com.termux/files/usr';
  const HOME = '/data/data/com.termux/files/home';

  // Colors
  const BLUE_BG   = '\x1b[44m';
  const WHITE_FG  = '\x1b[37m';
  const CYAN_FG   = '\x1b[36m';
  const GREEN_FG  = '\x1b[32m';
  const YELLOW_FG = '\x1b[33m';
  const RED_FG    = '\x1b[31m';
  const MAGENTA_FG= '\x1b[35m';
  const BOLD      = '\x1b[1m';
  const RESET     = '\x1b[0m';
  const BLACK_BG  = '\x1b[40m';
  const REVERSE   = '\x1b[7m';

  // Panel layout: top bar(1) + header(1) + files(rows-4) + bottom bar(1) = rows
  const TOP_BAR_ROWS = 1;

  let term = null;         // xterm.js instance
  let savedState = null;   // for restoring terminal after exit

  // Panel state
  let left = {
    path: HOME,
    files: [],
    cursor: 0,         // index in files array
    scroll: 0,         // scroll offset
    selected: new Set(), // selected file indices
  };
  let right = {
    path: PREFIX,
    files: [],
    cursor: 0,
    scroll: 0,
    selected: new Set(),
  };
  let activePanel = 'left'; // 'left' or 'right'
  let statusMsg = '';
  let running = false;
  let resolveExit = null;

  // --- Helpers ---
  function panel() { return activePanel === 'left' ? left : right; }
  function otherPanel() { return activePanel === 'left' ? right : left; }

  function esc(s) { return String(s); }

  function pad(str, len) {
    str = String(str);
    // Strip ANSI for length calculation
    const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
    if (stripped.length >= len) return str.slice(0, len);
    return str + ' '.repeat(len - stripped.length);
  }

  function truncPath(p) {
    // Show ~ for HOME
    if (p.startsWith(HOME)) return '~' + p.slice(HOME.length);
    return p;
  }

  function fileIcon(entry) {
    if (entry.type === 'dir') return 'd ';
    if (entry.name.endsWith('/')) return 'd ';
    // Check common extensions
    const ext = entry.name.split('.').pop().toLowerCase();
    if (['sh', 'bash', 'py', 'js', 'mjs', 'ts'].includes(ext)) return ' executable';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'].includes(ext)) return ' image';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return ' audio';
    if (['zip', 'tar', 'gz', 'xz', 'bz2', 'zst'].includes(ext)) return ' archive';
    if (['md', 'txt', 'rst'].includes(ext)) return ' text';
    return '   ';
  }

  function isDir(entry) {
    return entry.type === 'dir' || (entry.name && entry.name.endsWith('/'));
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '       ';
    if (bytes < 1024) return String(bytes).padStart(7);
    if (bytes < 1048576) return (bytes / 1024).toFixed(1).padStart(6) + 'K';
    return (bytes / 1048576).toFixed(1).padStart(6) + 'M';
  }

  // --- Directory listing ---
  async function listDir(dirPath) {
    const items = await FS().fsList();
    const entries = [];
    // Add parent directory
    if (dirPath !== '/') {
      entries.push({ name: '..', display: '..', type: 'dir', size: 0, isParent: true });
    }
    // Collect children
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    for (const item of items) {
      if (item.path === dirPath) continue;
      if (!item.path.startsWith(prefix)) continue;
      const rel = item.path.slice(prefix.length);
      if (!rel) continue;
      // Only first component (direct children)
      const slashIdx = rel.indexOf('/');
      const name = slashIdx === -1 ? rel : rel.slice(0, slashIdx);
      // Deduplicate
      if (entries.some(e => e.name === name)) continue;
      const isDirEntry = item.type === 'directory' || item.type === 'dir' || slashIdx !== -1;
      entries.push({
        name: name,
        display: name + (isDirEntry ? '/' : ''),
        type: isDirEntry ? 'dir' : 'file',
        size: isDirEntry ? 0 : (item.content ? item.content.length : 0),
      });
    }
    // Sort: dirs first, then alphabetical
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
    // Restore cursor position
    if (prevName) {
      const idx = p.files.findIndex(e => e.name === prevName);
      if (idx >= 0) {
        p.cursor = idx;
      }
    }
    // Clamp
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

    // === Top bar (row 1) ===
    out += '\x1b[47;30m'; // white bg, black fg
    out += ' ' + BOLD + '   Midnite Commander   ' + RESET;
    out += '\x1b[47;30m';
    // Fill rest of top bar
    const topUsed = 23;
    out += ' '.repeat(Math.max(0, cols - topUsed));
    out += RESET;

    // === Panels (rows 2 to rows-3) ===
    for (let row = 0; row < contentRows; row++) {
      // Move to next line
      out += '\r\n';

      // Left panel
      out += renderPanelRow(left, panelWidth, row, contentRows, activePanel === 'left');
      // Separator
      out += '\x1b[44m\x1b[37m' + '\u2502'; // │
      // Right panel
      out += renderPanelRow(right, rightWidth, row, contentRows, activePanel === 'right');
      out += RESET;
    }

    // === Bottom bar (function keys) ===
    out += '\r\n';
    out += '\x1b[44;37m'; // blue bg, white fg
    const keys = [
      '1Help', '2Menu', '3View', '4Edit', '5Copy',
      '6RenMov', '7Mkdir', '8Delete', '9PullDn', '10Quit'
    ];
    let keyBar = '';
    for (const k of keys) {
      keyBar += ' ' + k;
    }
    out += pad(keyBar, cols);
    out += RESET;

    // === Path/status line ===
    out += '\r\n';
    out += '\x1b[47;30m'; // white bg, black fg
    const leftPath = truncPath(left.path);
    const rightPath = truncPath(right.path);
    let statusLine = ' ' + leftPath;
    const halfCols = Math.floor(cols / 2);
    statusLine = pad(statusLine, halfCols);
    statusLine += '\x1b[44;37m\u2502' + RESET + '\x1b[47;30m';
    statusLine += ' ' + rightPath;
    statusLine = pad(statusLine, cols);
    out += statusLine;
    out += RESET;

    // Status message at very bottom
    if (statusMsg) {
      out += '\r\n';
      out += '\x1b[40;33m' + ' ' + statusMsg + RESET;
    }

    term.write(out);
  }

  function renderPanelRow(p, width, row, totalRows, isActive) {
    const headerRow = 0;
    const fileRows = totalRows - 1; // -1 for header

    if (row === headerRow) {
      // Panel header
      const headerText = ' Name ';
      const sizeText = ' Size ';
      const nameW = width - 7;
      const sizeW = 7;
      let line = '';
      if (isActive) {
        line += '\x1b[47;34m'; // white bg, blue fg for active
      } else {
        line += '\x1b[44;37m'; // blue bg, white fg
      }
      line += BOLD;
      line += pad(headerText, nameW);
      line += pad(sizeText, sizeW);
      line += RESET;
      if (isActive) line += '\x1b[47;34m';
      else line += '\x1b[44;37m';
      // Pad to full width
      const used = headerText.length + sizeText.length;
      const strippedUsed = pad('', nameW).replace(/\x1b\[[0-9;]*m/g, '').length +
                           pad('', sizeW).replace(/\x1b\[[0-9;]*m/g, '').length;
      return line;
    }

    // File entries
    const fileIdx = row - 1 + p.scroll;
    let line = '';

    if (fileIdx < p.files.length) {
      const entry = p.files[fileIdx];
      const isSelected = p.selected.has(fileIdx);
      const isCursor = fileIdx === p.cursor;
      const nameW = width - 7;
      const sizeW = 7;

      let nameStr = entry.display || entry.name;
      if (entry.type === 'dir' && !nameStr.endsWith('/')) nameStr += '/';

      // Choose color
      let nameColor = '';
      if (entry.type === 'dir' || nameStr.endsWith('/')) {
        nameColor = BOLD + WHITE_FG;
      } else {
        nameColor = CYAN_FG;
      }

      // Background for selected/cursor
      if (isCursor && isActive) {
        line += REVERSE;
      } else if (isSelected) {
        line += '\x1b[44;32m'; // green on blue
      } else {
        line += BLUE_BG;
      }

      // Name column
      const displayName = pad(nameStr, nameW);
      line += nameColor + displayName + RESET;

      // Re-apply bg after reset
      if (isCursor && isActive) {
        line += REVERSE;
      } else if (isSelected) {
        line += '\x1b[44;32m';
      } else {
        line += BLUE_BG;
      }

      // Size column
      const sizeStr = isDir(entry) ? '   <DIR>' : formatSize(entry.size);
      line += YELLOW_FG + pad(sizeStr, sizeW) + RESET;

    } else {
      // Empty row
      line += BLUE_BG + ' '.repeat(width);
    }

    return line;
  }

  // --- Keyboard handling ---
  function handleKey(data) {
    if (!running) return;

    // F10 or Alt+10 = quit
    if (data === '\x1b[3~' || data === '\x1bOS') { // F10 on some terminals
      // Could be F10 depending on terminal
    }

    // Function keys
    if (data.startsWith('\x1b[') && data.endsWith('~')) {
      const num = parseInt(data.slice(3, -1), 10);
      handleFnKey(num);
      return;
    }

    // F1-F10 via \x1bOP - \x1bOS (SS3 mode)
    if (data.startsWith('\x1bO') && data.length === 3) {
      const pCode = data.charCodeAt(2);
      const fNum = pCode - 80; // P=80 -> F1, Q=81 -> F2, ...
      if (fNum >= 1 && fNum <= 10) {
        handleFnKey(fNum);
        return;
      }
    }

    // Arrow keys
    if (data === '\x1b[A') { moveCursor(-1); return; }
    if (data === '\x1b[B') { moveCursor(1); return; }
    if (data === '\x1b[C') { switchPanel(); return; }
    if (data === '\x1b[D') { switchPanel(); return; }

    // Enter
    if (data === '\r' || data === '\n') {
      enterDirectory();
      return;
    }

    // Tab = switch panel
    if (data === '\t') {
      switchPanel();
      return;
    }

    // Insert = toggle select
    if (data === '\x1b[2~') {
      toggleSelect();
      moveCursor(1);
      return;
    }

    // Page Up / Page Down
    if (data === '\x1b[5~') { // Page Up
      const p = panel();
      const page = Math.max(1, term.rows - 6);
      moveCursor(-page);
      return;
    }
    if (data === '\x1b[6~') { // Page Down
      const p = panel();
      const page = Math.max(1, term.rows - 6);
      moveCursor(page);
      return;
    }

    // Home
    if (data === '\x1b[H' || data === '\x01') {
      const p = panel();
      p.cursor = 0;
      p.scroll = 0;
      render();
      return;
    }

    // End
    if (data === '\x1b[F' || data === '\x05') {
      const p = panel();
      p.cursor = Math.max(0, p.files.length - 1);
      ensureVisible(p);
      render();
      return;
    }

    // q / Q = quit
    if (data === 'q' || data === 'Q') {
      handleFnKey(10);
      return;
    }

    // Ctrl+Q = quit
    if (data === '\x11') {
      handleFnKey(10);
      return;
    }

    // / = change directory
    if (data === '/') {
      promptCommand('cd', 'Go to:');
      return;
    }

    // \ = go to root
    if (data === '\\') {
      const p = panel();
      p.path = '/';
      refreshPanel(p).then(render);
      return;
    }

    // ~ = go to home
    if (data === '~') {
      const p = panel();
      p.path = HOME;
      refreshPanel(p).then(render);
      return;
    }

    // Delete
    if (data === '\x1b[3~') {
      handleFnKey(8);
      return;
    }

    // Backspace = go to parent
    if (data === '\x7f' || data === '\b') {
      goToParent();
      return;
    }
  }

  async function handleFnKey(num) {
    const p = panel();
    switch (num) {
      case 1: // F1 Help
        showHelp();
        break;
      case 3: // F3 View
        await viewFile();
        break;
      case 4: // F4 Edit
        await editFile();
        break;
      case 5: // F5 Copy
        await copyFiles();
        break;
      case 6: // F6 Rename/Move
        await moveFiles();
        break;
      case 7: // F7 Mkdir
        await makeDirectory();
        break;
      case 8: // F8 Delete
        await deleteFiles();
        break;
      case 10: // F10 Quit
        quit();
        break;
    }
  }

  function moveCursor(delta) {
    const p = panel();
    p.cursor = Math.max(0, Math.min(p.files.length - 1, p.cursor + delta));
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

    if (entry.isParent) {
      goToParent();
      return;
    }

    if (isDir(entry)) {
      const sep = p.path.endsWith('/') ? '' : '/';
      p.path = p.path + sep + entry.name;
      p.cursor = 0;
      p.scroll = 0;
      p.selected.clear();
      await refreshPanel(p);
      render();
    } else {
      // Open/view file
      await viewFile();
    }
  }

  function goToParent() {
    const p = panel();
    if (p.path === '/') return;
    const parts = p.path.split('/').filter(Boolean);
    parts.pop();
    p.path = '/' + parts.join('/');
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

    // Show viewer
    await showViewer(entry.name, typeof content === 'string' ? content : new TextDecoder().decode(content));
  }

  async function showViewer(title, content) {
    const cols = term.cols;
    const rows = term.rows;

    // Save screen
    let out = '\x1b[2J\x1b[H\x1b[?25l';

    const lines = content.split('\n');
    let scroll = 0;
    const viewRows = rows - 2; // header + bottom bar

    function drawViewer() {
      let v = '\x1b[2J\x1b[H';
      // Header
      v += '\x1b[47;30m' + BOLD + ' View: ' + title + RESET;
      v += '\x1b[47;30m' + ' '.repeat(Math.max(0, cols - title.length - 8)) + RESET;
      // Content
      for (let i = 0; i < viewRows; i++) {
        v += '\r\n';
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          let line = lines[lineIdx];
          // Truncate to terminal width
          if (line.length > cols) line = line.slice(0, cols - 1) + '$';
          v += ' ' + line;
        }
      }
      // Bottom bar
      v += '\r\n';
      v += '\x1b[44;37m' + pad(' Esc=Close  Up/Down=Scroll  PgUp/PgDn=Page ', cols) + RESET;
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
        if (data === '\x1b' || data === 'q' || data === 'Q' || data === '\x03') {
          cleanup();
          running = true; // restore mc keyboard handler
          render();
          resolve();
          return;
        }
        if (data === '\x1b[A' || data === '\x05') { // Up
          if (scroll > 0) { scroll--; drawViewer(); }
          return;
        }
        if (data === '\x1b[B' || data === '\x12') { // Down
          if (scroll < lines.length - viewRows) { scroll++; drawViewer(); }
          return;
        }
        if (data === '\x1b[5~') { // Page Up
          scroll = Math.max(0, scroll - viewRows);
          drawViewer();
          return;
        }
        if (data === '\x1b[6~') { // Page Down
          scroll = Math.min(Math.max(0, lines.length - viewRows), scroll + viewRows);
          drawViewer();
          return;
        }
        if (data === '\x1b[H') { scroll = 0; drawViewer(); return; } // Home
        if (data === '\x1b[F') { scroll = Math.max(0, lines.length - viewRows); drawViewer(); return; } // End
      }
      // Temporarily replace mc's keyboard handler
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

    // Simple editor
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
      // Header
      e += '\x1b[41;37m' + BOLD + ' Edit: ' + title + (modified ? ' *' : '') + RESET;
      e += '\x1b[41;37m' + ' '.repeat(Math.max(0, cols - title.length - 10)) + RESET;
      // Content
      for (let i = 0; i < editRows; i++) {
        e += '\r\n';
        const lineIdx = scroll + i;
        if (lineIdx < lines.length) {
          e += ' ' + lines[lineIdx];
        }
      }
      // Bottom bar
      e += '\r\n';
      e += '\x1b[44;37m' + pad(' Esc=Close  Ctrl+S=Save', cols) + RESET;
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
        if (data === '\x1b') { // Esc = close (without saving unless modified)
          if (modified) {
            // Save on exit
            const newContent = lines.join('\n');
            FS().fsWriteFile(filePath, newContent).then(() => {
              statusMsg = 'Saved: ' + title;
            });
          }
          cleanup();
          term.write('\x1b[?25l'); // hide cursor
          running = true;
          render();
          resolve();
          return;
        }
        if (data === '\x13') { // Ctrl+S = save
          const newContent = lines.join('\n');
          FS().fsWriteFile(filePath, newContent).then(() => {
            modified = false;
            statusMsg = 'Saved: ' + title;
            drawEditor();
          });
          return;
        }
        if (data === '\x1b[A') { // Up
          if (cursorRow > 0) cursorRow--;
          if (cursorRow < scroll) scroll = cursorRow;
          if (cursorCol > lines[cursorRow].length) cursorCol = lines[cursorRow].length;
          drawEditor();
          return;
        }
        if (data === '\x1b[B') { // Down
          if (cursorRow < lines.length - 1) cursorRow++;
          if (cursorRow >= scroll + editRows) scroll = cursorRow - editRows + 1;
          if (cursorCol > lines[cursorRow].length) cursorCol = lines[cursorRow].length;
          drawEditor();
          return;
        }
        if (data === '\x1b[C') { // Right
          if (cursorCol < lines[cursorRow].length) cursorCol++;
          else if (cursorRow < lines.length - 1) { cursorRow++; cursorCol = 0; }
          drawEditor();
          return;
        }
        if (data === '\x1b[D') { // Left
          if (cursorCol > 0) cursorCol--;
          else if (cursorRow > 0) { cursorRow--; cursorCol = lines[cursorRow].length; }
          drawEditor();
          return;
        }
        if (data === '\r') { // Enter
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
        if (data === '\x7f' || data === '\b') { // Backspace
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
        if (data === '\x1b[3~') { // Delete
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
        if (data === '\t') { // Tab = insert spaces
          lines[cursorRow] = lines[cursorRow].slice(0, cursorCol) + '  ' + lines[cursorRow].slice(cursorCol);
          cursorCol += 2;
          modified = true;
          drawEditor();
          return;
        }
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

    for (const file of files) {
      const srcPath = p.path.endsWith('/') ? p.path + file.name : p.path + '/' + file.name;
      const dstPath = op.path.endsWith('/') ? op.path + file.name : op.path + '/' + file.name;
      try {
        if (isDir(file)) {
          // Copy directory by copying all files recursively
          const allFiles = await FS().fsList();
          const srcPrefix = srcPath.endsWith('/') ? srcPath : srcPath + '/';
          const filesToCopy = allFiles.filter(f => f.path.startsWith(srcPrefix) && f.type !== 'directory');
          for (const f of filesToCopy) {
            const rel = f.path.slice(srcPrefix.length);
            const dstFile = dstPath + '/' + rel;
            const content = await FS().fsReadFile(f.path);
            if (content != null) {
              // Create parent dirs
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
            // Create parent dirs
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
        // Read source
        const content = await FS().fsReadFile(srcPath);
        if (content != null) {
          // Create parent dirs in destination
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
    if (!name) return;

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
          // Delete all files in directory
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
      const p = panel();
      // Draw input box
      const boxW = Math.min(50, term.cols - 4);
      const boxH = 3;
      const startRow = Math.floor((term.rows - boxH) / 2);
      const startCol = Math.floor((term.cols - boxW) / 2);

      let box = '\x1b[2J\x1b[H';
      // Draw box background
      for (let r = 0; r < term.rows; r++) {
        box += '\r\n';
        if (r >= startRow && r < startRow + boxH) {
          if (r === startRow) {
            // Top border
            box += ' '.repeat(startCol);
            box += '\x1b[44;37m\u250C' + '\u2500'.repeat(boxW - 2) + '\u2510' + RESET;
          } else if (r === startRow + 1) {
            // Input line
            box += ' '.repeat(startCol);
            box += '\x1b[44;37m\u2502' + RESET;
            box += ' ' + message + ' ';
            box += '\x1b[44;37m\u2502' + RESET;
          } else {
            // Bottom border
            box += ' '.repeat(startCol);
            box += '\x1b[44;37m\u2514' + '\u2500'.repeat(boxW - 2) + '\u2518' + RESET;
          }
        }
      }
      term.write(box);

      // Now read input inline at bottom
      term.write('\r\n\x1b[44;37m > ' + RESET);
      let inputBuf = '';

      function onKey(data) {
        if (data === '\r') {
          disposable.dispose();
          resolve(inputBuf.trim());
          return;
        }
        if (data === '\x1b') {
          disposable.dispose();
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
      term.write('\r\n\x1b[44;37m ' + message + ' ' + RESET);
      const disposable = term.onData((data) => {
        disposable.dispose();
        resolve(data === 'y' || data === 'Y');
      });
    });
  }

  async function promptCommand(cmd, message) {
    const input = await promptInput(message);
    if (!input) {
      render();
      return;
    }

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
    const helpText = [
      'Midnight Commander - Help',
      '',
      'Navigation:',
      '  Up/Down    Move cursor',
      '  Left/Right Switch panel',
      '  Enter      Open file/dir',
      '  Tab        Switch panel',
      '  Backspace  Go to parent',
      '  /          Go to directory',
      '  ~          Go to home',
      '  \\          Go to root',
      '  Home/End   First/last file',
      '  PgUp/PgDn  Page up/down',
      '',
      'Selection:',
      '  Insert     Toggle select',
      '',
      'Function keys:',
      '  F3         View file',
      '  F4         Edit file',
      '  F5         Copy',
      '  F6         Move/Rename',
      '  F7         Make directory',
      '  F8         Delete',
      '  F10        Quit',
      '',
      'Press any key to close...'
    ];
    showViewer('Help', helpText.join('\n'));
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
    /**
     * Launch mc as a foreground app.
     * Returns a promise that resolves when mc exits.
     */
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

      // Refresh both panels
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
