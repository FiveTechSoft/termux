/* =====================================================================
   Termux Web — App Controller (xterm.js ↔ Shell)
   ===================================================================== */
'use strict';

const TermuxApp = (() => {
  let term = null;
  let fitAddon = null;
  let buffer = '';
  let cursorPos = 0;
  let history = [];
  let historyIdx = -1;
  let inputEnabled = false;
  let displayBuffer = '';
  let fgApp = null;
  const STORAGE_KEY = 'termux-display-buffer';

  const PROMPT_COLOR = '\x1b[1;32m';
  const PROMPT_RESET = '\x1b[0m';
  const ERROR_COLOR = '\x1b[1;31m';
  const VERSION = '0.1.0';

  function saveDisplayBuffer() {
    try {
      const baseY = term.buffer.active.baseY;
      const cursorY = term.buffer.active.cursorY;
      const totalLines = baseY + cursorY + 1;
      const saved = [];
      for (let i = 0; i < totalLines; i++) {
        const line = term.buffer.active.getLine(i);
        if (line) {
          const text = line.translateToString(true);
          if (text.length > 0) saved.push(text);
        }
      }
      while (saved.length > 0 && saved[saved.length - 1] === '') saved.pop();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        content: saved.join('\r\n'),
        cwd: TermuxShell.cwd || '',
        history: history.slice(-100)
      }));
    } catch (e) {}
  }

  function loadDisplayBuffer() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch (e) { return null; }
  }

  function clearDisplayBuffer() {
    displayBuffer = '';
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function getPromptStr() {
    const dir = TermuxShell.cwd || '/';
    let display = dir;
    if (dir.startsWith(TermuxShell.HOME)) display = '~' + dir.slice(TermuxShell.HOME.length);
    if (!display) display = '~';
    return PROMPT_COLOR + display + PROMPT_RESET + ' $ ';
  }

  function writePrompt() {
    term.write('\r\n' + getPromptStr());
  }

  function termWriteln(text) {
    term.write(text.replace(/\n/g, '\r\n') + '\r\n');
  }

  function writeWelcome() {
    termWriteln('\x1b[1;32mWelcome to Termux Web!\x1b[0m');
    termWriteln('');
    termWriteln('Community: https://termux.dev/community');
    termWriteln('Docs:      type \x1b[1mhelp\x1b[0m');
    termWriteln('');
    termWriteln('OpenCode:  \x1b[1mopencode\x1b[0m');
    termWriteln('           \x1b[1mopencode run "create hello.py"\x1b[0m');
    termWriteln('');
  }

  function handleInput(data) {
    if (fgApp && fgApp.onData) {
      fgApp.onData(data);
      return;
    }
    if (!inputEnabled) return;

    const printable = data.length === 1 && data.charCodeAt(0) >= 32;

    if (data === '\r') {
      const cmd = buffer.trim();
      inputEnabled = false;
      term.write('\r\n');

      if (cmd) {
        history.push(cmd);
        historyIdx = history.length;
      }

      executeCommand(cmd);
    } else if (data === '\x7f' || data === '\b') {
      if (cursorPos > 0) {
        buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
        cursorPos--;
        term.write('\b' + buffer.slice(cursorPos) + ' \b');
        if (cursorPos < buffer.length) {
          term.write('\x1b[' + (buffer.length - cursorPos) + 'D');
        }
      }
    } else if (data === '\x1b[A') {
      if (historyIdx > 0) {
        clearLine();
        historyIdx--;
        buffer = history[historyIdx];
        cursorPos = buffer.length;
        term.write(buffer);
      }
    } else if (data === '\x1b[B') {
      clearLine();
      if (historyIdx < history.length - 1) {
        historyIdx++;
        buffer = history[historyIdx];
      } else {
        historyIdx = history.length;
        buffer = '';
      }
      cursorPos = buffer.length;
      term.write(buffer);
    } else if (data === '\x1b[C') {
      if (cursorPos < buffer.length) {
        cursorPos++;
        term.write('\x1b[C');
      }
    } else if (data === '\x1b[D') {
      if (cursorPos > 0) {
        cursorPos--;
        term.write('\x1b[D');
      }
    } else if (data === '\x01') {
      if (cursorPos > 0) {
        term.write('\x1b[' + cursorPos + 'D');
        cursorPos = 0;
      }
    } else if (data === '\x05') {
      if (cursorPos < buffer.length) {
        term.write('\x1b[' + (buffer.length - cursorPos) + 'C');
        cursorPos = buffer.length;
      }
    } else if (data === '\x0B') {
      buffer = buffer.slice(0, cursorPos);
      term.write('\x1b[K');
    } else if (data === '\x15') {
      clearLine();
      buffer = '';
      cursorPos = 0;
    } else if (data === '\t') {
      handleTab();
    } else if (data === '\x03') {
      term.write('^C\r\n');
      buffer = '';
      cursorPos = 0;
      writePrompt();
    } else if (data === '\x04') {
      term.write('\r\nexit\r\n');
      inputEnabled = false;
    } else if (data === '\x0C') {
      clearDisplayBuffer();
      term.write('\x1b[2J\x1b[H');
      writePrompt();
    } else if (printable) {
      buffer = buffer.slice(0, cursorPos) + data + buffer.slice(cursorPos);
      cursorPos++;
      if (cursorPos === buffer.length) {
        term.write(data);
      } else {
        term.write(data + buffer.slice(cursorPos));
        term.write('\x1b[' + (buffer.length - cursorPos) + 'D');
      }
    }
  }

  function clearLine() {
    const promptLen = getPromptStr().replace(/\x1b\[[0-9;]*m/g, '').length;
    term.write('\r\x1b[K' + getPromptStr());
  }

  async function handleTab() {
    const parts = buffer.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    if (!last) return;

    let matches = [];

    if (parts.length <= 1) {
      const allCmds = [...TermuxShell.SHELL_CMDS];
      const files = await TermuxFS.fsList();
      const cwd = TermuxShell.cwd || '/';
      const items = await TermuxShell.shRun('echo *');
      const bins = items.split(/\s+/).filter(Boolean);
      const all = [...allCmds, ...bins];
      matches = all.filter(c => c.toLowerCase().startsWith(last.toLowerCase()));
    } else {
      const dir = last.includes('/') ? last.substring(0, last.lastIndexOf('/') + 1) : '';
      const prefix = last.includes('/') ? last.substring(last.lastIndexOf('/') + 1) : last;
      const baseDir = TermuxShell.cwd + (dir ? '/' + dir : '');
      const items = await TermuxShell.shRun('echo ' + (dir || '*'));
      const all = items.split(/\s+/).filter(Boolean);
      matches = all.filter(f => f.toLowerCase().startsWith(prefix.toLowerCase())).map(f => dir + f);
    }

    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      clearLine();
      buffer = parts.join(' ');
      cursorPos = buffer.length;
      term.write(buffer);
    } else if (matches.length > 1) {
      const unique = [...new Set(matches)];
      term.write('\r\n' + unique.join('  ') + '\r\n');
      writePrompt();
      term.write(buffer);
    }
  }

  function termWrite(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) term.write('\r\n');
      term.write(lines[i]);
    }
  }

  async function executeCommand(cmd) {
    if (!cmd) {
      enableInput();
      saveDisplayBuffer();
      return;
    }

    const first = splitCmd(cmd.trim())[0];
    if ((first === 'opencode' || first === 'oc') && window.TermuxOpenCode) {
      await launchOpenCode(cmd.trim());
      return;
    }

    try {
      const output = await TermuxShell.shRun(cmd);
      if (output === '\x1b]termux:opencode\x07') {
        await launchOpenCode(cmd.trim());
        return;
      }
      if (output && output !== '\x1b[2J\x1b[H') {
        termWrite(output);
      } else if (output === '\x1b[2J\x1b[H') {
        clearDisplayBuffer();
        term.write('\x1b[2J\x1b[H');
      }
    } catch (e) {
      termWrite(ERROR_COLOR + 'Error: ' + e.message + PROMPT_RESET);
    }

    enableInput();
    saveDisplayBuffer();
  }

  function splitCmd(line) {
    const args = [];
    let buf = '', q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) q = null;
        else buf += c;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ' ' || c === '\t') {
        if (buf) { args.push(buf); buf = ''; }
        continue;
      }
      buf += c;
    }
    if (buf) args.push(buf);
    return args;
  }

  async function launchOpenCode(line) {
    if (!window.TermuxOpenCode) {
      termWrite(ERROR_COLOR + 'opencode: not loaded' + PROMPT_RESET);
      enableInput();
      return;
    }
    if (!TermuxOpenCode.isInstalled()) {
      termWrite('opencode: command not found\r\nInstall with:  pkg install opencode');
      enableInput();
      saveDisplayBuffer();
      return;
    }
    const parts = splitCmd(line).slice(1);
    const io = {
      write: (s) => term.write(String(s).replace(/\n/g, '\r\n')),
      writeln: (s) => termWriteln(s == null ? '' : String(s)),
      getCols: () => term.cols,
      getRows: () => term.rows,
      get cols() { return term.cols; },
      get rows() { return term.rows; }
    };

    const CLI = {
      run: 1, auth: 1, models: 1, session: 1, agent: 1, mcp: 1, stats: 1, export: 1, import: 1,
      web: 1, serve: 1, attach: 1, acp: 1, github: 1, plugin: 1, pr: 1, db: 1, debug: 1,
      upgrade: 1, uninstall: 1, help: 1, version: 1
    };
    const isFlagOnly = parts[0] === '--version' || parts[0] === '-v' || parts[0] === '--help' || parts[0] === '-h';
    if (isFlagOnly || CLI[parts[0]]) {
      try {
        const output = await TermuxOpenCode.runFromShell(parts, '');
        if (output) termWrite(output);
      } catch (e) {
        termWrite(ERROR_COLOR + 'Error: ' + e.message + PROMPT_RESET);
      }
      enableInput();
      saveDisplayBuffer();
      return;
    }

    inputEnabled = false;
    const session = TermuxOpenCode.start(io, parts);
    fgApp = session;
    setOcKeyVisible(false);
    try {
      await session.done;
    } catch (e) {
      termWriteln(ERROR_COLOR + 'Error: ' + e.message + PROMPT_RESET);
    }
    fgApp = null;
    setOcKeyVisible(true);
    enableInput();
    saveDisplayBuffer();
  }

  function setOcKeyVisible(show) {
    const btn = document.querySelector('.ek-key[data-cmd="opencode"]');
    if (btn) btn.hidden = !show;
  }

  function enableInput() {
    inputEnabled = true;
    buffer = '';
    cursorPos = 0;
    writePrompt();
  }

  function buildExtraKeys() {
    const container = document.getElementById('extra-keys');
    if (!container) return;

    const keys = [
      { label: 'ESC', special: true, code: '\x1b' },
      { label: 'TAB', special: true, code: '\t' },
      { label: 'CTRL', special: true, code: 'ctrl' },
      { label: 'ALT', special: true, code: 'alt' },
      { label: '/', code: '/' },
      { label: '-', code: '-' },
      { label: '|', code: '|' },
      { label: 'UP', special: true, code: '\x1b[A', wide: true },
      { label: 'DN', special: true, code: '\x1b[B', wide: true },
      { label: 'LT', special: true, code: '\x1b[D' },
      { label: 'RT', special: true, code: '\x1b[C' },
      { label: '~', code: '~' },
      { label: 'HOME', special: true, code: '\x01', wide: true },
      { label: 'END', special: true, code: '\x05', wide: true },
      { label: 'PGUP', special: true, code: '\x1b[5~' },
      { label: 'PGDN', special: true, code: '\x1b[6~' },
      { label: 'ENTER', special: true, code: '\r', wide: true, extraWide: true },
      { label: 'PASTE', special: true, code: 'paste', extraWide: true },
      { label: 'BS', special: true, code: '\x7f', wide: true },
      { label: 'KEYB', special: true, code: 'keyb', extraWide: true },
      { label: 'OC', special: true, code: 'opencode', extraWide: true },
      { label: 'HELP', special: true, code: 'help', extraWide: true },
      { label: 'CLEAR', special: true, code: 'clear', extraWide: true },
      { label: 'NEW', special: true, code: 'new-disk', danger: true },
      { label: 'DL', special: true, code: 'download-disk' }
    ];

    let ctrlActive = false;
    let altActive = false;

    for (const k of keys) {
      const btn = document.createElement('button');
      btn.className = 'ek-key' + (k.special ? ' ek-special' : '') + (k.wide ? ' ek-wide' : '') + (k.extraWide ? ' ek-extra-wide' : '') + (k.danger ? ' ek-danger' : '');
      if (k.code === 'opencode') btn.dataset.cmd = 'opencode';
      btn.textContent = k.label;

      btn.addEventListener('click', () => {
        if (k.label === 'CTRL') {
          ctrlActive = !ctrlActive;
          btn.style.background = ctrlActive ? '#444' : '';
          return;
        }
        if (k.label === 'ALT') {
          altActive = !altActive;
          btn.style.background = altActive ? '#444' : '';
          return;
        }
        let code = k.code;
        if (code === 'keyb') { window._toggleVkbd && window._toggleVkbd(); return; }
        if (code === 'paste') { window._termuxPaste && window._termuxPaste(); return; }
        if (code === 'opencode') {
          if (fgApp) return;
          for (const ch of 'opencode') handleInput(ch);
          handleInput('\r');
          return;
        }
        if (code === 'help') { for (const ch of 'help') handleInput(ch); handleInput('\r'); return; }
        if (code === 'clear') { for (const ch of 'clear') handleInput(ch); handleInput('\r'); return; }
        if (code === 'new-disk') {
          if (!confirm('Erase all files and reset terminal? This cannot be undone.')) return;
          localStorage.removeItem('termux-display-buffer');
          indexedDB.deleteDatabase('termux-disk');
          location.reload();
          return;
        }
        if (code === 'download-disk') {
          (async () => {
            const files = await TermuxFS.fsList();
            if (files.length === 0) { alert('Disk is empty.'); return; }
            let text = '';
            for (const f of files) { text += '=== ' + f.path + ' ===\n' + (f.content || '') + '\n\n'; }
            const blob = new Blob([text], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'termux-disk.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          })();
          return;
        }
        if (ctrlActive && /^[A-Za-z]$/.test(code)) {
          code = String.fromCharCode(code.toUpperCase().charCodeAt(0) - 64);
          ctrlActive = false;
          document.querySelectorAll('.ek-key').forEach(b => { if (b.textContent === 'CTRL') b.style.background = ''; });
        }
        if (altActive && code.length === 1) {
          code = '\x1b' + code;
          altActive = false;
          document.querySelectorAll('.ek-key').forEach(b => { if (b.textContent === 'ALT') b.style.background = ''; });
        }
        handleInput(code);
        term.focus();
      });

      container.appendChild(btn);
    }
  }

  function buildVirtualKeyboard() {
    const kb = document.getElementById('vkbd');
    if (!kb) return;
    let shift = false;
    let symbols = false;

    const layers = {
      lower: [
        'qwertyuiop'.split(''),
        'asdfghjklñ'.split(''),
        ['shift', ...'zxcvbnm'.split(''), 'bs']
      ],
      upper: [
        'QWERTYUIOP'.split(''),
        'ASDFGHJKLÑ'.split(''),
        ['shift', ...'ZXCVBNM'.split(''), 'bs']
      ],
      sym: [
        '1234567890'.split(''),
        ['@', '#', '$', '%', '&', '*', '(', ')', '-', '_'],
        ['abc', '=', '+', '{', '}', '[', ']', '\\', '|', 'bs']
      ]
    };

    function send(code) {
      handleInput(code);
      if (term) term.focus();
    }

    function paint() {
      kb.innerHTML = '';
      const layer = symbols ? layers.sym : (shift ? layers.upper : layers.lower);
      layer.forEach(row => {
        const r = document.createElement('div');
        r.className = 'vk-row';
        row.forEach(k => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'vk-key' + (k === 'shift' || k === 'bs' || k === 'abc' ? ' vk-mod' : '');
          if (k === 'shift' && shift) b.classList.add('vk-on');
          b.textContent = k === 'shift' ? '⇧' : k === 'bs' ? '⌫' : k === 'abc' ? 'ABC' : k;
          b.addEventListener('mousedown', e => e.preventDefault());
          b.addEventListener('click', () => {
            if (k === 'shift') { shift = !shift; paint(); return; }
            if (k === 'abc') { symbols = false; paint(); return; }
            if (k === 'bs') { send('\x7f'); return; }
            send(k);
            if (shift && !symbols) { shift = false; paint(); }
          });
          r.appendChild(b);
        });
        kb.appendChild(r);
      });
      const bot = document.createElement('div');
      bot.className = 'vk-row';
      [
        { label: symbols ? 'ABC' : '123', cls: 'vk-mod', fn: () => { symbols = !symbols; shift = false; paint(); } },
        { label: '/', fn: () => send('/') },
        { label: 'space', cls: 'vk-space', fn: () => send(' ') },
        { label: '.', fn: () => send('.') },
        { label: 'enter', cls: 'vk-enter', fn: () => send('\r') }
      ].forEach(x => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vk-key ' + (x.cls || 'vk-mod');
        b.textContent = x.label === 'space' ? '␣' : x.label === 'enter' ? '⏎' : x.label;
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', x.fn);
        bot.appendChild(b);
      });
      kb.appendChild(bot);
    }

    paint();

    window._toggleVkbd = function () {
      const open = !kb.classList.contains('open');
      kb.classList.toggle('open', open);
      kb.hidden = !open;
      document.body.classList.toggle('vkbd-open', open);
      document.querySelectorAll('.ek-key').forEach(b => {
        if (b.textContent === 'KEYB') b.classList.toggle('vk-on', open);
      });
      if (fitAddon) setTimeout(() => { try { fitAddon.fit(); } catch (e) {} }, 40);
      if (term) term.focus();
    };
  }

  async function init() {
    const loading = document.getElementById('loading');
    const termContainer = document.getElementById('terminal-container');

    if ('serviceWorker' in navigator) {
      const swUrl = new URL('sw.js', window.location.href);
      navigator.serviceWorker.register(swUrl.href).catch(() => {});
    }

    await loadScript('https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js');
    await loadCSS('https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css');
    await loadScript('https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js');

    const { Terminal } = window;
    const { FitAddon } = window.FitAddon;

    term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 15,
      fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Source Code Pro', 'Courier New', monospace",
      lineHeight: 1.2,
      scrollback: 10000,
      theme: {
        background: '#000000',
        foreground: '#FFFFFF',
        cursor: '#FFFFFF',
        cursorAccent: '#000000',
        selectionBackground: '#6495ED',
        selectionForeground: '#000000',
        black: '#000000',
        red: '#CD0000',
        green: '#00CD00',
        yellow: '#CDCD00',
        blue: '#6495ED',
        magenta: '#CD00CD',
        cyan: '#00CDCD',
        white: '#E5E5E5',
        brightBlack: '#7F7F7F',
        brightRed: '#FF0000',
        brightGreen: '#00FF00',
        brightYellow: '#FFFF00',
        brightBlue: '#5C5CFF',
        brightMagenta: '#FF00FF',
        brightCyan: '#00FFFF',
        brightWhite: '#FF8C00'
      }
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainer);
    fitAddon.fit();

    await TermuxFS.fsInit();
    TermuxShell.init();

    const saved = loadDisplayBuffer();
    if (saved && saved.content) {
      if (saved.cwd) TermuxShell.setCwd(saved.cwd);
      const lines = saved.content.split('\n');
      const lastLine = lines[lines.length - 1];
      const hasPrompt = lastLine && lastLine.includes('$');
      if (hasPrompt) lines.pop();
      term.write(lines.join('\n'));
      if (saved.history) history = saved.history;
      historyIdx = history.length;
      enableInput();
    } else {
      writeWelcome();
      enableInput();
    }

    buildExtraKeys();
    buildVirtualKeyboard();
    term.onData(data => handleInput(data));

    // Pre-load almostnode in background
    import('https://esm.sh/almostnode').then(mod => {
      window._almostnode = mod.createContainer();
    }).catch(e => { console.warn('almostnode load failed:', e); });

    // Paste: Ctrl+Shift+V or right-click
    term.attachCustomKeyEventHandler(ev => {
      if (ev.ctrlKey && ev.shiftKey && ev.key === 'V' && ev.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              for (const ch of lines[i]) handleInput(ch);
              if (i < lines.length - 1) handleInput('\r');
            }
          }
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Paste button helper
    window._termuxPaste = async function() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            for (const ch of lines[i]) handleInput(ch);
            if (i < lines.length - 1) handleInput('\r');
          }
        }
      } catch (e) {}
      term.focus();
    };

    window.addEventListener('resize', () => {
      if (fitAddon) fitAddon.fit();
    });

    term.focus();
    if (loading) loading.classList.add('hidden');

    term.element.addEventListener('click', (ev) => {
      if (fgApp && typeof fgApp.onClick === 'function') fgApp.onClick(ev, term);
    });

    return term;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function loadCSS(url) {
    return new Promise((resolve) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = url;
      l.onload = resolve;
      l.onerror = resolve;
      document.head.appendChild(l);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => TermuxApp.init());
