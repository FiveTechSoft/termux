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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        content: saved.join('\n'),
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

  function writeWelcome() {
    const art = [
      '\x1b[1;32mTermux Web\x1b[0m',
      'Terminal emulator',
      ''
    ];
    for (const line of art) {
      term.writeln(line);
    }
  }

  function handleInput(data) {
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
      term.write('^C');
      buffer = '';
      cursorPos = 0;
      writePrompt();
    } else if (data === '\x04') {
      term.write('\r\n');
      term.writeln('exit');
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
    if (buffer.length > 0) {
      term.write('\r' + ' '.repeat(buffer.length + 2) + '\r');
      term.write(getPromptStr());
    }
  }

  async function handleTab() {
    const parts = buffer.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    if (!last) return;

    const dir = TermuxShell.cwd || '/';
    const files = await TermuxShell.shRun('echo *');
    const all = files.split(/\s+/).filter(Boolean);
    const matches = all.filter(f => f.toLowerCase().startsWith(last.toLowerCase()));

    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      clearLine();
      buffer = parts.join(' ');
      cursorPos = buffer.length;
      term.write(buffer);
    } else if (matches.length > 1) {
      term.write('\r\n' + matches.join('  '));
      writePrompt();
      term.write(buffer);
    }
  }

  async function executeCommand(cmd) {
    if (!cmd) {
      enableInput();
      saveDisplayBuffer();
      return;
    }

    try {
      const output = await TermuxShell.shRun(cmd);
      if (output && output !== '\x1b[2J\x1b[H') {
        term.write(output);
      } else if (output === '\x1b[2J\x1b[H') {
        clearDisplayBuffer();
        term.write('\x1b[2J\x1b[H');
      }
    } catch (e) {
      term.write(ERROR_COLOR + 'Error: ' + e.message + PROMPT_RESET);
    }

    enableInput();
    saveDisplayBuffer();
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
      { label: 'ENTER', special: true, code: '\r', wide: true, extraWide: true }
    ];

    let ctrlActive = false;
    let altActive = false;

    for (const k of keys) {
      const btn = document.createElement('button');
      btn.className = 'ek-key' + (k.special ? ' ek-special' : '') + (k.wide ? ' ek-wide' : '') + (k.extraWide ? ' ek-extra-wide' : '');
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
        if (ctrlActive && code.length === 1) {
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

  async function init() {
    const loading = document.getElementById('loading');
    const termContainer = document.getElementById('terminal-container');

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
        brightWhite: '#FFFFFF'
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
    term.onData(data => handleInput(data));

    window.addEventListener('resize', () => {
      if (fitAddon) fitAddon.fit();
    });

    term.focus();
    if (loading) loading.classList.add('hidden');

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
