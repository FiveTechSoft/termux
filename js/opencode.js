/* =====================================================================
   Termux Web — OpenCode agent (TUI + opencode run)
   Talks to OpenCode Zen (and Groq / xAI) from the browser.
   ===================================================================== */
'use strict';

const TermuxOpenCode = (() => {
  const VERSION = '1.1.0';
  const CFG_KEY = 'termux-opencode-config';
  const PKG_KEY = 'termux-pkg-installed';

  const FREE_MODELS = [
    'laguna-s-2.1-free',
    'nemotron-3.5-lightning-free',
    'mimo-v2.5-free',
    'nemotron-3-ultra-free',
    'ling-3.0-flash-fin-free',
    'deepseek-v4-flash-free',
    'x-preview-f-free',
    'hy3-free'
  ];

  const PROVIDERS = {
    opencode: {
      name: 'OpenCode Zen',
      baseUrl: 'https://api.fivetechsoft.com/zen/v1',
      defaultModel: FREE_MODELS[0],
      auth: 'https://opencode.ai/auth'
    },
    groq: {
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      auth: 'https://console.groq.com'
    },
    xai: {
      name: 'SpaceXAI',
      baseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-4.5',
      auth: 'https://console.x.ai'
    }
  };

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run a shell command inside Termux. Use for ls, git, node, pkg, etc.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell command' } },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a UTF-8 text file from the Termux filesystem.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            offset: { type: 'integer' },
            limit: { type: 'integer' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write',
        description: 'Create or overwrite a text file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Replace an exact string in a file. old_string must match uniquely.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' }
          },
          required: ['path', 'old_string', 'new_string']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'glob',
        description: 'List files matching a glob pattern (e.g. **/*.js).',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'Search file contents with a regex.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' }
          },
          required: ['pattern']
        }
      }
    }
  ];

  function defaultConfig() {
    return {
      installed: true,
      provider: 'opencode',
      model: FREE_MODELS[0],
      apiKey: 'public',
      endpoint: 'https://api.fivetechsoft.com/zen/v1',
      fallback: true
    };
  }

  function getConfig() {
    try {
      return Object.assign(defaultConfig(), JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
    } catch (e) {
      return defaultConfig();
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  function isInstalled() {
    try {
      const pkgs = JSON.parse(localStorage.getItem(PKG_KEY) || '[]');
      if (pkgs.includes('opencode')) return true;
    } catch (e) {}
    return !!getConfig().installed;
  }

  function install() {
    const cfg = getConfig();
    cfg.installed = true;
    saveConfig(cfg);
    markPkg('opencode', true);
    return 'Setting up OpenCode...\n' +
      'Unpacking opencode (' + VERSION + ') ...\n' +
      'Setting up opencode (' + VERSION + ') ...\n' +
      '\nOpenCode ' + VERSION + ' installed.\n' +
      'Run:  opencode\n' +
      '      opencode run "your prompt"\n' +
      'Free Zen models work out of the box (public key).';
  }

  function uninstall() {
    const cfg = getConfig();
    cfg.installed = false;
    saveConfig(cfg);
    markPkg('opencode', false);
    return 'Removing opencode ...\nProcessing triggers ...';
  }

  function markPkg(name, on) {
    let pkgs = [];
    try { pkgs = JSON.parse(localStorage.getItem(PKG_KEY) || '[]'); } catch (e) {}
    pkgs = pkgs.filter(p => p !== name);
    if (on) pkgs.push(name);
    localStorage.setItem(PKG_KEY, JSON.stringify(pkgs));
  }

  function systemPrompt(cwd) {
    return [
      'You are OpenCode, an AI coding agent running inside Termux Web (a Linux-like environment in the browser).',
      'Working directory: ' + cwd,
      'Home: /data/data/com.termux/files/home',
      'Prefix: /data/data/com.termux/files/usr',
      'Use tools to read, write, edit, search, and run shell commands.',
      'Prefer small, working changes. Do not invent file paths; list or glob first.',
      'When done, give a short summary of what you did.'
    ].join('\n');
  }

  function resolvePath(p) {
    const shell = window.TermuxShell;
    const cwd = (shell && shell.cwd) || '/data/data/com.termux/files/home';
    const home = (shell && shell.HOME) || cwd;
    if (!p || p === '.') return cwd;
    if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
    if (p.startsWith('/')) return norm(p);
    return norm(cwd + '/' + p);
  }

  function norm(p) {
    const out = [];
    String(p || '').split('/').forEach(s => {
      if (!s || s === '.') return;
      if (s === '..') out.pop();
      else out.push(s);
    });
    return out.join('/');
  }

  async function executeTool(name, args) {
    const FS = window.TermuxFS;
    const shell = window.TermuxShell;
    args = args || {};
    try {
      if (name === 'bash') {
        const cmd = String(args.command || '').trim();
        if (!cmd) return 'bash: missing command';
        const first = cmd.split(/\s+/)[0];
        if (first === 'opencode' || first === 'oc') return 'opencode: already running';
        const out = await shell.shRun(cmd);
        return (out === undefined || out === null) ? '' : String(out);
      }
      if (name === 'read') {
        const path = resolvePath(args.path);
        const content = await FS.fsReadFile(path);
        if (content === null) return 'Error: file not found: ' + path;
        let lines = String(content).split('\n');
        const offset = Math.max(0, (args.offset || 1) - 1);
        const limit = args.limit || lines.length;
        lines = lines.slice(offset, offset + limit);
        return lines.map((l, i) => String(offset + i + 1).padStart(6) + '| ' + l).join('\n');
      }
      if (name === 'write') {
        const path = resolvePath(args.path);
        const parts = path.split('/');
        parts.pop();
        let cur = '';
        for (const part of parts) {
          if (!part) continue;
          cur += '/' + part;
          const st = await FS.fsStat(cur);
          if (!st) await FS.fsMkdir(cur);
        }
        await FS.fsWriteFile(path, String(args.content ?? ''));
        return 'Wrote ' + path + ' (' + String(args.content ?? '').length + ' bytes)';
      }
      if (name === 'edit') {
        const path = resolvePath(args.path);
        const content = await FS.fsReadFile(path);
        if (content === null) return 'Error: file not found: ' + path;
        const oldS = String(args.old_string ?? '');
        const newS = String(args.new_string ?? '');
        if (!oldS) return 'Error: old_string is empty';
        const n = content.split(oldS).length - 1;
        if (n === 0) return 'Error: old_string not found in ' + path;
        if (n > 1) return 'Error: old_string matches ' + n + ' times; make it unique';
        await FS.fsWriteFile(path, content.replace(oldS, newS));
        return 'Edited ' + path;
      }
      if (name === 'glob') {
        const pattern = String(args.pattern || '*');
        const files = await FS.fsList();
        const re = globToRe(pattern);
        const hits = files.map(f => '/' + f.path.replace(/^\/+/, '')).filter(p => re.test(p) || re.test(p.split('/').pop()));
        return hits.length ? hits.join('\n') : '(no matches)';
      }
      if (name === 'grep') {
        const re = new RegExp(String(args.pattern || ''), 'i');
        const files = await FS.fsList();
        const root = args.path ? resolvePath(args.path) : '';
        const out = [];
        for (const f of files) {
          const p = '/' + f.path.replace(/^\/+/, '');
          if (root && p !== root && !p.startsWith(root + '/')) continue;
          const text = f.content == null ? '' : String(f.content);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) out.push(p + ':' + (i + 1) + ':' + lines[i]);
            if (out.length >= 80) break;
          }
          if (out.length >= 80) break;
        }
        return out.length ? out.join('\n') : '(no matches)';
      }
      return 'Error: unknown tool ' + name;
    } catch (e) {
      return 'Error: ' + (e && e.message ? e.message : e);
    }
  }

  function globToRe(pat) {
    let s = String(pat);
    s = s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    s = s.replace(/\*\*/g, '§DS§').replace(/\*/g, '[^/]*').replace(/§DS§/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + s + '$');
  }

  function parseArgsJson(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) {}
    try { return JSON.parse(String(raw).replace(/'/g, '"')); } catch (e) {}
    return {};
  }

  function parseTextTools(text) {
    const calls = [];
    if (!text) return calls;
    const xml = /<tool\s+name="([a-z]+)"[^>]*>([\s\S]*?)<\/tool>/gi;
    let m;
    while ((m = xml.exec(text))) {
      const name = m[1];
      const inner = m[2];
      const args = {};
      const argRe = /<arg\s+name="([^"]+)">([\s\S]*?)<\/arg>/gi;
      let a;
      while ((a = argRe.exec(inner))) args[a[1]] = a[2];
      if (!Object.keys(args).length) {
        if (name === 'bash') args.command = inner.trim();
        else if (name === 'read' || name === 'glob') args.path = inner.trim(), args.pattern = inner.trim();
        else args.content = inner;
      }
      calls.push({ id: 'txt-' + calls.length, name, args });
    }
    const fence = /```tool:([a-z]+)\n([\s\S]*?)```/gi;
    while ((m = fence.exec(text))) {
      calls.push({ id: 'fence-' + calls.length, name: m[1], args: parseArgsJson(m[2]) });
    }
    return calls;
  }

  async function chatCompletions(messages, cfg) {
    const provider = PROVIDERS[cfg.provider] || PROVIDERS.opencode;
    const model = cfg.model || provider.defaultModel;
    const base = (cfg.endpoint || provider.baseUrl).replace(/\/$/, '');
    const url = base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    headers.Authorization = 'Bearer ' + (cfg.apiKey || 'public');
    const body = {
      model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 4096,
      temperature: 0.2
    };

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const raw = await resp.text();
    if (!resp.ok) {
      let withoutTools = null;
      if (resp.status === 400 && /tool/i.test(raw)) {
        const body2 = { model, messages, max_tokens: 4096, temperature: 0.2 };
        const resp2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body2) });
        const raw2 = await resp2.text();
        if (!resp2.ok) {
          const err = new Error('API ' + resp2.status + ': ' + raw2.slice(0, 240));
          err.status = resp2.status;
          throw err;
        }
        withoutTools = JSON.parse(raw2);
        return withoutTools;
      }
      const err = new Error('API ' + resp.status + ': ' + raw.slice(0, 240));
      err.status = resp.status;
      throw err;
    }
    return JSON.parse(raw);
  }

  async function runAgent(prompt, io, existingMessages) {
    const cfg = getConfig();
    const cwd = (window.TermuxShell && window.TermuxShell.cwd) || '/data/data/com.termux/files/home';
    const messages = existingMessages || [
      { role: 'system', content: systemPrompt(cwd) }
    ];
    messages.push({ role: 'user', content: prompt });

    const write = (s) => { if (io && io.write) io.write(s); };
    const writeln = (s) => {
      if (io && io.writeln) io.writeln(s);
      else write((s || '') + '\r\n');
    };

    if (!cfg.apiKey) cfg.apiKey = 'public';

    let models = [cfg.model || PROVIDERS[cfg.provider].defaultModel];
    if (cfg.provider === 'opencode' && cfg.fallback !== false) {
      for (const m of FREE_MODELS) if (!models.includes(m)) models.push(m);
    }

    let lastErr = null;
    for (const model of models) {
      if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages };
      const tryCfg = Object.assign({}, cfg, { model });
      try {
        if (model !== models[0]) writeln('\x1b[33mfallback → ' + model + '\x1b[0m');
        const result = await agentLoop(messages, tryCfg, io, writeln);
        if (model !== cfg.model) {
          cfg.model = model;
          saveConfig(cfg);
        }
        return result;
      } catch (e) {
        lastErr = e;
        writeln('\x1b[33m' + model + ' failed: ' + (e.message || e) + '\x1b[0m');
      }
    }
    writeln('\x1b[1;31mAll models failed.\x1b[0m ' + (lastErr && lastErr.message ? lastErr.message : ''));
    return { ok: false, reason: 'fail', messages };
  }

  async function agentLoop(messages, cfg, io, writeln) {
    const C = {
      tool: '\x1b[36m',
      ok: '\x1b[32m',
      dim: '\x1b[2m',
      reset: '\x1b[0m'
    };
    for (let round = 0; round < 10; round++) {
      if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages };
      const data = await chatCompletions(messages, cfg);
      const choice = (data.choices && data.choices[0]) || {};
      const msg = choice.message || {};
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const content = msg.content || msg.reasoning_content || '';
      const textCalls = toolCalls.length ? [] : parseTextTools(content);

      if (!toolCalls.length && !textCalls.length) {
        if (content) writeln(content.trimEnd());
        else writeln('(no response)');
        messages.push({ role: 'assistant', content: content || '' });
        return { ok: true, content, messages };
      }

      if (content && !textCalls.length) writeln(content.trimEnd());
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined
      });

      const calls = toolCalls.length
        ? toolCalls.map(tc => ({
            id: tc.id || ('call-' + Math.random()),
            name: (tc.function && tc.function.name) || tc.name,
            args: parseArgsJson(tc.function ? tc.function.arguments : tc.arguments)
          }))
        : textCalls;

      for (const call of calls) {
        if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages };
        const preview = summarizeArgs(call.name, call.args);
        writeln(C.tool + '▸ ' + call.name + C.reset + ' ' + C.dim + preview + C.reset);
        const result = await executeTool(call.name, call.args);
        const shown = String(result).split('\n').slice(0, 20).join('\n');
        writeln(C.ok + shown + C.reset);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: String(result).slice(0, 8000)
        });
      }

      if (textCalls.length && !toolCalls.length) {
        messages.push({
          role: 'user',
          content: 'Tool results are above. Continue. If finished, reply with a short summary and no more <tool> tags.'
        });
      }
    }
    writeln('Stopped after 10 tool rounds.');
    return { ok: true, content: '', messages };
  }

  function summarizeArgs(name, args) {
    if (!args) return '';
    if (name === 'bash') return args.command || '';
    if (name === 'read' || name === 'write' || name === 'edit') return args.path || '';
    if (name === 'glob') return args.pattern || '';
    if (name === 'grep') return (args.pattern || '') + (args.path ? ' ' + args.path : '');
    try { return JSON.stringify(args).slice(0, 80); } catch (e) { return ''; }
  }

  function banner(cfg) {
    const cwd = (window.TermuxShell && window.TermuxShell.cwd) || '~';
    const home = (window.TermuxShell && window.TermuxShell.HOME) || '';
    let dir = cwd;
    if (home && dir.startsWith(home)) dir = '~' + dir.slice(home.length);
    const model = (cfg.provider || 'opencode') + '/' + (cfg.model || FREE_MODELS[0]);
    const key = (!cfg.apiKey || cfg.apiKey === 'public') ? 'public (free)' : 'connected';
    return [
      '\x1b[1;35m█ OpenCode\x1b[0m  ' + VERSION + '  \x1b[2mtermux-web\x1b[0m',
      '  cwd    ' + dir,
      '  model  ' + model,
      '  auth   ' + key,
      '',
      '  \x1b[2m/connect  /models  /help  /new  /exit\x1b[0m',
      '  \x1b[2mopencode run "prompt"  for one-shot\x1b[0m',
      ''
    ].join('\r\n');
  }

  function helpText() {
    return [
      'Commands:',
      '  /connect <provider> <api-key>   opencode | groq | xai',
      '  /models                         list models',
      '  /model <id>                     set model',
      '  /new                            new session',
      '  /help                           this help',
      '  /exit                           quit to shell',
      '  !ls                             run a shell command',
      '',
      'Providers:',
      '  opencode  Zen gateway  ' + PROVIDERS.opencode.auth,
      '  groq      Groq API     ' + PROVIDERS.groq.auth,
      '  xai       SpaceXAI     ' + PROVIDERS.xai.auth,
      '',
      'Free Zen models: ' + FREE_MODELS.join(', ')
    ].join('\r\n');
  }

  function start(io) {
    const state = {
      buf: '',
      busy: false,
      aborted: false,
      messages: null,
      resolve: null
    };
    io = io || {};
    const write = (s) => { if (io.write) io.write(s); };
    const writeln = (s) => {
      if (io.writeln) io.writeln(s);
      else write((s == null ? '' : s) + '\r\n');
    };
    const prompt = () => write('\x1b[1;35m>\x1b[0m ');

    const sessionIo = {
      write,
      writeln,
      aborted: () => state.aborted
    };

    const done = new Promise(resolve => { state.resolve = resolve; });

    function exit(code) {
      state.busy = false;
      if (state.resolve) {
        const r = state.resolve;
        state.resolve = null;
        r(code || 0);
      }
    }

    async function handleLine(line) {
      const t = (line || '').trim();
      if (!t) { prompt(); return; }
      if (t === '/exit' || t === '/q' || t === '/quit') {
        writeln('bye');
        exit(0);
        return;
      }
      if (t === '/help' || t === '/h') {
        writeln(helpText());
        prompt();
        return;
      }
      if (t === '/new') {
        state.messages = null;
        writeln('New session.');
        prompt();
        return;
      }
      if (t === '/models') {
        const cfg = getConfig();
        writeln('Provider: ' + cfg.provider);
        writeln('Current:  ' + cfg.model);
        writeln('Free Zen: ' + FREE_MODELS.join(', '));
        prompt();
        return;
      }
      if (t.startsWith('/model')) {
        const id = t.replace(/^\/model\s*/, '').trim();
        if (!id) { writeln('Usage: /model <id>'); prompt(); return; }
        const cfg = getConfig();
        cfg.model = id;
        saveConfig(cfg);
        writeln('Model set to ' + id);
        prompt();
        return;
      }
      if (t.startsWith('/connect')) {
        const parts = t.split(/\s+/);
        const cfg = getConfig();
        if (parts.length === 1) {
          writeln('Usage: /connect <opencode|groq|xai> <api-key>');
          writeln('Get an OpenCode key: ' + PROVIDERS.opencode.auth);
          prompt();
          return;
        }
        if (PROVIDERS[parts[1]] && !parts[2]) {
          writeln('Usage: /connect ' + parts[1] + ' <api-key>');
          writeln('Get a key: ' + PROVIDERS[parts[1]].auth);
          prompt();
          return;
        }
        if (PROVIDERS[parts[1]] && parts[2]) {
          cfg.provider = parts[1];
          cfg.apiKey = parts.slice(2).join(' ');
          if (PROVIDERS[parts[1]].defaultModel) cfg.model = PROVIDERS[parts[1]].defaultModel;
          saveConfig(cfg);
          writeln('\x1b[32mConnected to ' + PROVIDERS[parts[1]].name + '.\x1b[0m model=' + cfg.model);
          prompt();
          return;
        }
        cfg.apiKey = parts.slice(1).join(' ');
        saveConfig(cfg);
        writeln('\x1b[32mAPI key saved for ' + cfg.provider + '.\x1b[0m');
        prompt();
        return;
      }
      if (t.startsWith('!')) {
        const cmd = t.slice(1).trim();
        try {
          const out = await window.TermuxShell.shRun(cmd);
          if (out) writeln(String(out).replace(/\n/g, '\r\n'));
        } catch (e) {
          writeln('Error: ' + e.message);
        }
        prompt();
        return;
      }

      state.busy = true;
      state.aborted = false;
      writeln('\x1b[2mthinking…\x1b[0m');
      try {
        const result = await runAgent(t, sessionIo, state.messages);
        state.messages = result.messages;
      } catch (e) {
        writeln('\x1b[31m' + (e.message || e) + '\x1b[0m');
      }
      state.busy = false;
      if (state.resolve) prompt();
    }

    function onData(data) {
      if (data === '\x03') {
        if (state.busy) {
          state.aborted = true;
          writeln('^C');
          state.busy = false;
          prompt();
        } else {
          writeln('^C');
          exit(130);
        }
        return;
      }
      if (state.busy) return;
      if (data === '\r') {
        const line = state.buf;
        state.buf = '';
        write('\r\n');
        handleLine(line);
        return;
      }
      if (data === '\x7f' || data === '\b') {
        if (state.buf.length) {
          state.buf = state.buf.slice(0, -1);
          write('\b \b');
        }
        return;
      }
      if (data === '\x15') {
        while (state.buf.length) {
          state.buf = state.buf.slice(0, -1);
          write('\b \b');
        }
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        state.buf += data;
        write(data);
      }
    }

    writeln(banner(getConfig()));
    prompt();

    return {
      onData,
      abort: () => { state.aborted = true; exit(130); },
      done
    };
  }

  async function runOnce(prompt, io) {
    const cfg = getConfig();
    if (io && io.writeln) {
      io.writeln('\x1b[1;35mOpenCode\x1b[0m ' + (cfg.provider + '/' + cfg.model));
    }
    return runAgent(prompt, io, null);
  }

  async function runFromShell(args, stdin) {
    args = args || [];
    if (args[0] === '--version' || args[0] === '-v') return 'opencode ' + VERSION + ' (termux-web)';
    if (args[0] === '--help' || args[0] === '-h') {
      return [
        'Usage: opencode [command] [options]',
        '',
        '  opencode                 Interactive TUI',
        '  opencode run <prompt>    One-shot agent',
        '  opencode --version',
        '',
        'Inside the TUI: /connect /models /help /exit'
      ].join('\n');
    }
    if (args[0] === 'run') {
      const prompt = args.slice(1).join(' ') || stdin || '';
      if (!prompt) return 'Usage: opencode run <prompt>';
      const chunks = [];
      const io = {
        write: (s) => chunks.push(String(s).replace(/\r/g, '')),
        writeln: (s) => chunks.push(String(s).replace(/\r/g, '') + '\n')
      };
      await runOnce(prompt, io);
      return chunks.join('').replace(/\n+$/, '');
    }
    return '\x1b]termux:opencode\x07';
  }

  return {
    VERSION,
    PROVIDERS,
    FREE_MODELS,
    TOOLS,
    getConfig,
    saveConfig,
    isInstalled,
    install,
    uninstall,
    executeTool,
    runAgent,
    runOnce,
    runFromShell,
    start
  };
})();

window.TermuxOpenCode = TermuxOpenCode;
