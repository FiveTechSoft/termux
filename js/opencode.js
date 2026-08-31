/* =====================================================================
   Termux Web — OpenCode (TUI + agent), modelled on anomalyco/opencode
   Not the native binary. Same CLI surface, tools, agents, and TUI layout.
   ===================================================================== */
'use strict';

const TermuxOpenCode = (() => {
  const VERSION = '1.2.18';
  const CFG_KEY = 'termux-opencode-config';
  const PKG_KEY = 'termux-pkg-installed';
  const SESS_KEY = 'termux-opencode-sessions';
  const STAT_KEY = 'termux-opencode-stats';
  const TUI_KEY = 'termux-opencode-tui';

  const FREE_MODELS = [
    'nemotron-3.5-lightning-free',
    'ling-3.0-flash-fin-free',
    'laguna-s-2.1-free',
    'mimo-v2.5-free',
    'nemotron-3-ultra-free',
    'deepseek-v4-flash-free'
  ];
  const FALLBACK_PREFERRED = [
    'nemotron-3.5-lightning-free',
    'ling-3.0-flash-fin-free'
  ];

  const ZEN_ENDPOINTS = [
    'https://api.fivetechsupport.com/zen/v1',
    'https://api.fivetechsoft.com/zen/v1'
  ];

  const PROVIDERS = {
    opencode: {
      name: 'OpenCode Zen',
      baseUrl: ZEN_ENDPOINTS[0],
      defaultModel: FREE_MODELS[0],
      auth: 'https://opencode.ai/auth'
    },
    groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', auth: 'https://console.groq.com' },
    xai: { name: 'SpaceXAI', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4.5', auth: 'https://console.x.ai' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1', auth: 'https://platform.openai.com' },
    anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5', auth: 'https://console.anthropic.com' }
  };

  const AGENTS = {
    build: { mode: 'primary', color: '#c084fc', desc: 'Default, full-access agent for development work', perm: { edit: 'allow', bash: 'allow' } },
    plan: { mode: 'primary', color: '#67e8f9', desc: 'Read-only analysis; edits and bash ask first', perm: { edit: 'deny', bash: 'ask' } },
    general: { mode: 'subagent', color: '#86efac', desc: 'Complex multi-step tasks', perm: { edit: 'allow', bash: 'allow', todowrite: 'deny' } },
    explore: { mode: 'subagent', color: '#fde047', desc: 'Fast read-only codebase exploration', perm: { edit: 'deny', bash: 'ask' } },
    scout: { mode: 'subagent', color: '#fb923c', desc: 'Read-only docs and dependency research', perm: { edit: 'deny', bash: 'deny', webfetch: 'allow', websearch: 'allow' } }
  };

  const THEMES = ['opencode', 'tokyonight', 'catppuccin', 'dracula', 'gruvbox', 'nord', 'monokai', 'github', 'flexoki'];

  const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', inv: '\x1b[7m',
    mag: '\x1b[38;5;177m', cyan: '\x1b[38;5;81m', green: '\x1b[38;5;114m',
    yellow: '\x1b[38;5;221m', red: '\x1b[38;5;203m', white: '\x1b[38;5;255m',
    muted: '\x1b[38;5;245m', bar: '\x1b[48;5;240m', pink: '\x1b[38;5;213m',
    selBg: '\x1b[48;2;250;178;131m',
    selFg: '\x1b[38;2;26;26;26m'
  };

  function toolDef(name, desc, props, required) {
    return { type: 'function', function: { name, description: desc, parameters: { type: 'object', properties: props, required: required || [] } } };
  }
  const S = (d) => ({ type: 'string', description: d });
  const I = (d) => ({ type: 'integer', description: d });

  const TOOLS = [
    toolDef('bash', 'Execute a shell command in the project environment.', { command: S('Shell command'), workdir: S('Working directory') }, ['command']),
    toolDef('read', 'Read a UTF-8 file. Supports offset/limit for large files.', { path: S('File path'), offset: I('1-based start line'), limit: I('Max lines') }, ['path']),
    toolDef('write', 'Create or overwrite a file.', { path: S('File path'), content: S('Full file contents') }, ['path', 'content']),
    toolDef('edit', 'Replace an exact string in a file. oldString must match uniquely.', { path: S('File path'), oldString: S('Text to find'), newString: S('Replacement'), old_string: S('Alias of oldString'), new_string: S('Alias of newString') }, ['path']),
    toolDef('apply_patch', 'Apply a patch. Marker format: *** Add File: path / *** Update File: path / *** Delete File: path', { patchText: S('Patch text') }, ['patchText']),
    toolDef('glob', 'Find files by glob pattern (e.g. **/*.js).', { pattern: S('Glob pattern'), path: S('Root directory') }, ['pattern']),
    toolDef('grep', 'Search file contents with a regex.', { pattern: S('Regex'), path: S('File or directory'), include: S('Glob filter') }, ['pattern']),
    toolDef('webfetch', 'Fetch and read a URL.', { url: S('HTTP URL'), format: S('text, markdown, or html') }, ['url']),
    toolDef('websearch', 'Search the web for current information.', { query: S('Search query'), num: I('Number of results') }, ['query']),
    toolDef('todowrite', 'Replace the session todo list.', { todos: { type: 'array', items: { type: 'object', properties: { id: S('id'), content: S('text'), status: S('pending|in_progress|completed') } } } }, ['todos']),
    toolDef('skill', 'Load a SKILL.md by name and return its contents.', { name: S('Skill name') }, ['name']),
    toolDef('question', 'Ask the user a multiple-choice question.', { header: S('Short header'), question: S('Question text'), options: { type: 'array', items: S('option') } }, ['question']),
    toolDef('task', 'Delegate a subtask to a subagent (general, explore, scout).', { description: S('Short title'), prompt: S('Task prompt'), subagent_type: S('general|explore|scout') }, ['prompt']),
    toolDef('lsp', 'Experimental LSP: hover/definition/references (limited in termux-web).', { operation: S('hover|definition|references|documentSymbol'), path: S('File'), line: I('Line'), character: I('Column') }, ['operation', 'path'])
  ];

  function defaultConfig() {
    return {
      installed: true,
      provider: 'opencode',
      model: FREE_MODELS[0],
      apiKey: 'public',
      endpoint: ZEN_ENDPOINTS[0],
      fallback: true,
      agent: 'build'
    };
  }
  function getConfig() {
    try { return Object.assign(defaultConfig(), JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
    catch (e) { return defaultConfig(); }
  }
  function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function tuiCfg() {
    try { return Object.assign({ theme: 'opencode', details: true, thinking: true, sidebar: false, sidebarChosen: false }, JSON.parse(localStorage.getItem(TUI_KEY) || '{}')); }
    catch (e) { return { theme: 'opencode', details: true, thinking: true, sidebar: false, sidebarChosen: false }; }
  }
  function saveTui(t) { localStorage.setItem(TUI_KEY, JSON.stringify(t)); }

  function isInstalled() {
    try { if (JSON.parse(localStorage.getItem(PKG_KEY) || '[]').includes('opencode')) return true; } catch (e) {}
    return !!getConfig().installed;
  }
  function markPkg(name, on) {
    let pkgs = [];
    try { pkgs = JSON.parse(localStorage.getItem(PKG_KEY) || '[]'); } catch (e) {}
    pkgs = pkgs.filter(p => p !== name);
    if (on) pkgs.push(name);
    localStorage.setItem(PKG_KEY, JSON.stringify(pkgs));
  }
  function install() {
    const cfg = getConfig(); cfg.installed = true; saveConfig(cfg); markPkg('opencode', true);
    return 'Setting up opencode (' + VERSION + ') ...\nOpenCode ' + VERSION + ' installed.\nRun:  opencode';
  }
  function uninstall() {
    const cfg = getConfig(); cfg.installed = false; saveConfig(cfg); markPkg('opencode', false);
    return 'Removing opencode ...';
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SESS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveSessions(list) { localStorage.setItem(SESS_KEY, JSON.stringify(list.slice(-40))); }
  function loadStats() {
    try { return Object.assign({ tokens: 0, cost: 0, tools: {}, runs: 0 }, JSON.parse(localStorage.getItem(STAT_KEY) || '{}')); }
    catch (e) { return { tokens: 0, cost: 0, tools: {}, runs: 0 }; }
  }
  function saveStats(s) { localStorage.setItem(STAT_KEY, JSON.stringify(s)); }
  function bumpStats(toolsUsed, tokens) {
    const s = loadStats();
    s.runs++; s.tokens += tokens || 0;
    (toolsUsed || []).forEach(t => { s.tools[t] = (s.tools[t] || 0) + 1; });
    saveStats(s);
  }

  function cwdNow() { return (window.TermuxShell && window.TermuxShell.cwd) || '/data/data/com.termux/files/home'; }
  function homeNow() { return (window.TermuxShell && window.TermuxShell.HOME) || cwdNow(); }
  function norm(p) {
    const out = [];
    String(p || '').split('/').forEach(s => {
      if (!s || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return out.join('/');
  }
  function resolvePath(p) {
    const cwd = cwdNow(), home = homeNow();
    if (!p || p === '.') return norm(cwd);
    if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
    if (p.startsWith('/')) return norm(p);
    return norm(cwd + '/' + p);
  }
  function displayCwd() {
    const cwd = cwdNow(), home = homeNow();
    if (home && cwd.startsWith(home)) return '~' + cwd.slice(home.length);
    return cwd || '~';
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
    try { return JSON.parse(String(raw).replace(/'/g, '"')); } catch (e) { return {}; }
  }
  function mkdirp(FS, path) {
    const parts = path.split('/');
    parts.pop();
    let cur = '';
    const chain = [];
    return (async () => {
      for (const part of parts) {
        if (!part) continue;
        cur += '/' + part;
        const st = await FS.fsStat(norm(cur));
        if (!st) await FS.fsMkdir(norm(cur));
      }
    })();
  }

  function permFor(agent, tool) {
    const a = AGENTS[agent] || AGENTS.build;
    const editTools = { write: 1, edit: 1, apply_patch: 1 };
    if (editTools[tool]) return a.perm.edit || 'allow';
    if (tool === 'bash') return a.perm.bash || 'allow';
    if (tool === 'todowrite') return a.perm.todowrite || 'allow';
    if (tool === 'webfetch') return a.perm.webfetch || 'allow';
    if (tool === 'websearch') return a.perm.websearch || 'allow';
    return 'allow';
  }

  let sessionTodos = [];
  let lastSnapshots = [];
  let redoStack = [];

  async function snapshotFile(path) {
    const FS = window.TermuxFS;
    const prev = await FS.fsReadFile(path);
    return { path, prev };
  }
  async function restoreSnaps(snaps) {
    const FS = window.TermuxFS;
    for (const s of snaps || []) {
      if (s.prev === null || s.prev === undefined) await FS.fsDel(s.path);
      else await FS.fsWriteFile(s.path, s.prev);
    }
  }

  async function executeTool(name, args, ctx) {
    const FS = window.TermuxFS;
    const shell = window.TermuxShell;
    args = args || {};
    ctx = ctx || {};
    const agent = ctx.agent || 'build';
    const perm = permFor(agent, name);
    if (perm === 'deny') return 'Permission denied for tool "' + name + '" in agent "' + agent + '".';
    if (perm === 'ask' && ctx.ask) {
      const ok = await ctx.ask(name, args);
      if (!ok) return 'User denied tool "' + name + '".';
    }
    try {
      if (name === 'bash') {
        const cmd = String(args.command || '').trim();
        if (!cmd) return 'bash: missing command';
        const first = cmd.split(/\s+/)[0];
        if (first === 'opencode' || first === 'oc') return 'opencode: already running';
        if (args.workdir) {
          const st = await FS.fsStat(resolvePath(args.workdir));
          if (st) shell.setCwd(resolvePath(args.workdir));
        }
        const out = await shell.shRun(cmd);
        return (out === undefined || out === null) ? '' : String(out);
      }
      if (name === 'read') {
        const path = resolvePath(args.path || args.file_path);
        const content = await FS.fsReadFile(path);
        if (content === null) return 'Error: file not found: ' + path;
        let lines = String(content).split('\n');
        const offset = Math.max(0, (args.offset || 1) - 1);
        const limit = args.limit || lines.length;
        lines = lines.slice(offset, offset + limit);
        return lines.map((l, i) => String(offset + i + 1).padStart(6) + '| ' + l).join('\n');
      }
      if (name === 'write') {
        const path = resolvePath(args.path || args.file_path);
        const snap = await snapshotFile(path);
        if (ctx.snaps) ctx.snaps.push(snap);
        await mkdirp(FS, path);
        await FS.fsWriteFile(path, String(args.content ?? ''));
        return 'Wrote ' + path + ' (' + String(args.content ?? '').length + ' bytes)';
      }
      if (name === 'edit') {
        const path = resolvePath(args.path || args.file_path);
        const oldS = String(args.oldString ?? args.old_string ?? '');
        const newS = String(args.newString ?? args.new_string ?? '');
        const content = await FS.fsReadFile(path);
        if (content === null) return 'Error: file not found: ' + path;
        if (!oldS) return 'Error: oldString is empty';
        const n = content.split(oldS).length - 1;
        if (n === 0) return 'Error: oldString not found in ' + path;
        if (n > 1) return 'Error: oldString matches ' + n + ' times; make it unique';
        const snap = await snapshotFile(path);
        if (ctx.snaps) ctx.snaps.push(snap);
        await FS.fsWriteFile(path, content.replace(oldS, newS));
        return 'Edited ' + path;
      }
      if (name === 'apply_patch') {
        return await applyPatch(String(args.patchText || args.patch || ''), ctx);
      }
      if (name === 'glob') {
        const pattern = String(args.pattern || '*');
        const files = await FS.fsList();
        const re = globToRe(pattern);
        const root = args.path ? resolvePath(args.path) : '';
        const hits = files.map(f => '/' + f.path.replace(/^\/+/, '')).filter(p => {
          if (root) {
            const rn = '/' + String(root).replace(/^\/+/, '');
            if (p !== rn && !p.startsWith(rn + '/')) return false;
          }
          return re.test(p) || re.test(p.split('/').pop());
        });
        return hits.length ? hits.join('\n') : '(no matches)';
      }
      if (name === 'grep') {
        const re = new RegExp(String(args.pattern || ''), 'i');
        const files = await FS.fsList();
        const root = args.path ? resolvePath(args.path) : '';
        const include = args.include ? globToRe(args.include) : null;
        const out = [];
        for (const f of files) {
          const p = '/' + f.path.replace(/^\/+/, '');
          if (root) {
            const rn = '/' + String(root).replace(/^\/+/, '');
            if (p !== rn && !p.startsWith(rn + '/')) continue;
          }
          if (include && !include.test(p) && !include.test(p.split('/').pop())) continue;
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
      if (name === 'webfetch') {
        const url = String(args.url || '');
        if (!/^https?:\/\//i.test(url)) return 'Error: url must be http(s)';
        try {
          let resp = await fetch(url);
          if (!resp.ok) {
            resp = await fetch('https://r.jina.ai/' + url);
          }
          const text = await resp.text();
          return text.slice(0, 12000);
        } catch (e) {
          try {
            const resp = await fetch('https://r.jina.ai/' + url);
            return (await resp.text()).slice(0, 12000);
          } catch (e2) {
            return 'webfetch error: ' + e.message;
          }
        }
      }
      if (name === 'websearch') {
        const q = encodeURIComponent(String(args.query || ''));
        const n = Math.min(8, args.num || 5);
        const url = 'https://en.wikipedia.org/w/api.php?action=opensearch&search=' + q + '&limit=' + n + '&format=json&origin=*';
        const resp = await fetch(url);
        const data = await resp.json();
        const titles = data[1] || [], descs = data[2] || [], links = data[3] || [];
        if (!titles.length) return '(no results)';
        return titles.map((t, i) => (i + 1) + '. ' + t + '\n   ' + (descs[i] || '') + '\n   ' + (links[i] || '')).join('\n');
      }
      if (name === 'todowrite') {
        sessionTodos = Array.isArray(args.todos) ? args.todos : [];
        return sessionTodos.map(t => '[' + (t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' ') + '] ' + (t.content || t.id)).join('\n') || '(empty todo list)';
      }
      if (name === 'skill') {
        const nameS = String(args.name || '');
        const files = await FS.fsList();
        const hit = files.find(f => {
          const p = f.path.replace(/\\/g, '/');
          return p.endsWith('/' + nameS + '/SKILL.md') || p.endsWith('skills/' + nameS + '.md') || p.endsWith('/' + nameS + '.md');
        });
        if (!hit) return 'Skill not found: ' + nameS + '\nPlace SKILL.md at .opencode/skills/' + nameS + '/SKILL.md';
        return String(hit.content || '');
      }
      if (name === 'question') {
        if (ctx.askQuestion) return await ctx.askQuestion(args);
        const opts = args.options || [];
        return 'User selected: ' + (opts[0] || '(no options)');
      }
      if (name === 'task') {
        if (ctx.depth > 2) return 'task: nesting limit';
        const sub = args.subagent_type || 'general';
        const nested = await runAgent(String(args.prompt || ''), {
          write: () => {},
          writeln: () => {},
          aborted: ctx.aborted
        }, null, { agent: sub, depth: (ctx.depth || 0) + 1, maxRounds: 5 });
        return nested.content || nested.reason || '(subagent finished)';
      }
      if (name === 'lsp') {
        const path = resolvePath(args.path);
        const content = await FS.fsReadFile(path);
        if (content === null) return 'lsp: file not found ' + path;
        const lines = String(content).split('\n');
        const line = lines[(args.line || 1) - 1] || '';
        return 'lsp ' + args.operation + ' ' + path + ':' + (args.line || 1) + '\n' + line.trim() + '\n(LSP servers are not connected in termux-web)';
      }
      return 'Error: unknown tool ' + name;
    } catch (e) {
      return 'Error: ' + (e && e.message ? e.message : e);
    }
  }

  async function applyPatch(text, ctx) {
    const FS = window.TermuxFS;
    const blocks = String(text || '').split(/^\*\*\* /m).filter(Boolean);
    if (!blocks.length) return 'apply_patch: empty patch';
    const out = [];
    for (const b of blocks) {
      const nl = b.indexOf('\n');
      const header = (nl < 0 ? b : b.slice(0, nl)).trim();
      const body = nl < 0 ? '' : b.slice(nl + 1);
      const add = header.match(/^Add File:\s*(.+)$/i);
      const upd = header.match(/^Update File:\s*(.+)$/i);
      const del = header.match(/^Delete File:\s*(.+)$/i);
      if (add) {
        const path = resolvePath(add[1].trim());
        const snap = await snapshotFile(path);
        if (ctx.snaps) ctx.snaps.push(snap);
        await mkdirp(FS, path);
        await FS.fsWriteFile(path, body.replace(/\n$/, ''));
        out.push('added ' + path);
      } else if (del) {
        const path = resolvePath(del[1].trim());
        const snap = await snapshotFile(path);
        if (ctx.snaps) ctx.snaps.push(snap);
        await FS.fsDel(path);
        out.push('deleted ' + path);
      } else if (upd) {
        const path = resolvePath(upd[1].trim());
        let content = await FS.fsReadFile(path);
        if (content === null) return 'apply_patch: missing ' + path;
        const snap = await snapshotFile(path);
        if (ctx.snaps) ctx.snaps.push(snap);
        const m = body.match(/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/);
        if (m) {
          if (!content.includes(m[1])) return 'apply_patch: search not found in ' + path;
          content = content.replace(m[1], m[2]);
        } else {
          const minus = [], plus = [];
          body.split('\n').forEach(line => {
            if (line.startsWith('-') && !line.startsWith('---')) minus.push(line.slice(1));
            else if (line.startsWith('+') && !line.startsWith('+++')) plus.push(line.slice(1));
          });
          if (minus.length) {
            const oldS = minus.join('\n');
            if (!content.includes(oldS)) return 'apply_patch: hunk not found in ' + path;
            content = content.replace(oldS, plus.join('\n'));
          } else if (plus.length) {
            content += (content.endsWith('\n') ? '' : '\n') + plus.join('\n');
          }
        }
        await FS.fsWriteFile(path, content);
        out.push('updated ' + path);
      }
    }
    return out.join('\n') || 'apply_patch: no hunks';
  }

  function parseTextTools(text) {
    const calls = [];
    if (!text) return calls;
    const xml = /<tool\s+name="([a-z_]+)"[^>]*>([\s\S]*?)<\/tool>/gi;
    let m;
    while ((m = xml.exec(text))) {
      const name = m[1], inner = m[2], args = {};
      const argRe = /<arg\s+name="([^"]+)">([\s\S]*?)<\/arg>/gi;
      let a;
      while ((a = argRe.exec(inner))) args[a[1]] = a[2];
      if (!Object.keys(args).length) {
        if (name === 'bash') args.command = inner.trim();
        else if (name === 'read' || name === 'glob' || name === 'skill') args.path = inner.trim(), args.pattern = inner.trim(), args.name = inner.trim();
        else args.content = inner;
      }
      calls.push({ id: 'txt-' + calls.length, name, args });
    }
    const fence = /```tool:([a-z_]+)\n([\s\S]*?)```/gi;
    while ((m = fence.exec(text))) calls.push({ id: 'fence-' + calls.length, name: m[1], args: parseArgsJson(m[2]) });
    return calls;
  }

  function systemPrompt(cwd, agent) {
    const a = AGENTS[agent] || AGENTS.build;
    const lines = [
      'You are OpenCode, an AI coding agent running inside Termux Web (browser Linux-like environment).',
      'Working directory: ' + cwd,
      'Home: ' + homeNow(),
      'Agent: ' + agent + ' (' + a.desc + ')',
      'Use tools to read, write, edit, search, fetch, and run shell commands.',
      'Prefer edit/apply_patch for existing files. Do not invent paths; glob or bash ls first.',
      'When done, give a short summary of what you did.'
    ];
    if (agent === 'plan') lines.push('PLAN MODE: do not modify files. Analyze and propose a plan. Bash only if the user would approve.');
    if (agent === 'explore' || agent === 'scout') lines.push('READ-ONLY: do not modify files.');
    return lines.join('\n');
  }

  async function expandAtMentions(prompt) {
    const re = /@([^\s]+)/g;
    let m, out = prompt, extra = '';
    const FS = window.TermuxFS;
    while ((m = re.exec(prompt))) {
      const token = m[1];
      if (AGENTS[token]) continue;
      const path = resolvePath(token.replace(/:$/, ''));
      const content = await FS.fsReadFile(path);
      if (content !== null) extra += '\n\n<file path="' + path + '">\n' + String(content).slice(0, 8000) + '\n</file>';
    }
    return out + extra;
  }

  function splitThink(text) {
    const s = String(text || '');
    const m = s.match(/<think>([\s\S]*?)<\/think>/i);
    if (m) return { reasoning: m[1].trim(), content: s.replace(m[0], '').trim() };
    return { reasoning: '', content: s };
  }

  function applyChatDelta(json, acc, onDelta) {
    const choice = (json.choices && json.choices[0]) || {};
    const delta = choice.delta || {};
    const msg = choice.message || {};
    if (msg.content && !delta.content) acc.content = msg.content;
    if (msg.reasoning_content && !delta.reasoning_content) acc.reasoning = msg.reasoning_content;
    if (Array.isArray(msg.tool_calls) && !Object.keys(acc.tools).length) {
      msg.tool_calls.forEach((tc, i) => { acc.tools[i] = tc; });
    }
    const piece = delta.content || '';
    const think = delta.reasoning_content || delta.reasoning || (delta.delta && delta.delta.thinking) || '';
    if (piece) acc.content += piece;
    if (typeof think === 'string' && think) acc.reasoning += think;
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index != null ? tc.index : 0;
        if (!acc.tools[idx]) acc.tools[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) acc.tools[idx].id = tc.id;
        if (tc.function) {
          if (tc.function.name) acc.tools[idx].function.name += tc.function.name;
          if (tc.function.arguments) acc.tools[idx].function.arguments += tc.function.arguments;
        }
      }
    }
    if (json.usage) acc.usage = json.usage;
    if (onDelta) onDelta({ content: acc.content, reasoning: acc.reasoning });
  }

  function finishChatAcc(acc) {
    const split = splitThink(acc.content);
    if (split.reasoning && !acc.reasoning) {
      acc.reasoning = split.reasoning;
      acc.content = split.content;
    }
    const tool_calls = Object.keys(acc.tools).sort((a, b) => Number(a) - Number(b))
      .map(k => acc.tools[k]).filter(t => t.function && t.function.name);
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: acc.content || '',
          reasoning_content: acc.reasoning || '',
          tool_calls: tool_calls.length ? tool_calls : undefined
        }
      }],
      usage: acc.usage || {}
    };
  }

  async function consumeChatResponse(resp, onDelta, aborted) {
    const acc = { content: '', reasoning: '', tools: {}, usage: {} };
    const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
    if (!reader) {
      const data = JSON.parse(await resp.text());
      applyChatDelta(data, acc, onDelta);
      return finishChatAcc(acc);
    }
    const decoder = new TextDecoder();
    let buf = '', raw = '', mode = 'unknown';
    while (true) {
      if (aborted && aborted()) {
        try { await reader.cancel(); } catch (e) {}
        break;
      }
      const step = await reader.read();
      if (step.done) break;
      const chunk = decoder.decode(step.value, { stream: true });
      raw += chunk;
      buf += chunk;
      if (mode === 'unknown') {
        const t = buf.trimStart();
        if (t.startsWith('data:') || t.startsWith('event:')) mode = 'sse';
        else if (t.startsWith('{') || t.startsWith('[')) mode = 'json';
      }
      if (mode === 'sse') {
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try { applyChatDelta(JSON.parse(payload), acc, onDelta); } catch (e) {}
        }
      }
    }
    if (mode !== 'sse') {
      const data = JSON.parse(raw);
      acc.content = ''; acc.reasoning = ''; acc.tools = {};
      applyChatDelta(data, acc, onDelta);
    }
    return finishChatAcc(acc);
  }

  async function chatCompletions(messages, cfg, onDelta, aborted) {
    const provider = PROVIDERS[cfg.provider] || PROVIDERS.opencode;
    const model = cfg.model || provider.defaultModel;
    const base = (cfg.endpoint || provider.baseUrl).replace(/\/$/, '');
    const url = base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.apiKey || 'public') };
    const stream = typeof onDelta === 'function';
    const body = { model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 4096, temperature: 0.2, stream };
    let resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      const raw = await resp.text();
      if (resp.status === 400 && /tool/i.test(raw)) {
        const resp2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.2, stream: true }) });
        if (!resp2.ok) {
          const raw2 = await resp2.text();
          throw failApi(resp2.status, raw2);
        }
        return consumeChatResponse(resp2, onDelta, aborted);
      }
      if (resp.status === 400 && /stream/i.test(raw)) {
        const resp3 = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 4096, temperature: 0.2 }) });
        if (!resp3.ok) {
          throw failApi(resp3.status, await resp3.text());
        }
        return consumeChatResponse(resp3, onDelta, aborted);
      }
      throw failApi(resp.status, raw);
    }
    return consumeChatResponse(resp, onDelta, aborted);
  }

  function failApi(status, raw) {
    const text = String(raw || '');
    const err = new Error('API ' + status + ': ' + text.slice(0, 240));
    err.status = status;
    if (status === 429 || /FreeUsageLimit|rate limit/i.test(text)) err.kind = 'rate_limit';
    else if (status === 503 || /unavailable|server_error/i.test(text)) err.kind = 'unavailable';
    else if (/not supported/i.test(text)) err.kind = 'unsupported';
    else err.kind = 'error';
    return err;
  }

  function shortFail(model, e) {
    const kind = e && e.kind;
    if (kind === 'rate_limit' || (e && e.status === 429)) return model + ' rate-limited';
    if (kind === 'unavailable' || (e && e.status === 503)) return model + ' unavailable';
    if (kind === 'unsupported') return model + ' unsupported';
    return model + ' failed';
  }

  function modelQueue(selected) {
    const out = [];
    const add = (m) => { if (m && !out.includes(m)) out.push(m); };
    add(selected);
    FALLBACK_PREFERRED.forEach(add);
    FREE_MODELS.forEach(add);
    return out;
  }

  function endpointQueue(cfg) {
    const selected = (cfg.endpoint || PROVIDERS.opencode.baseUrl).replace(/\/$/, '');
    const known = ZEN_ENDPOINTS.map(e => e.replace(/\/$/, ''));
    if (cfg.provider !== 'opencode' || !known.includes(selected)) return [selected];
    const out = [];
    const add = (e) => { if (e && !out.includes(e)) out.push(e); };
    known.forEach(add);
    add(selected);
    return out;
  }

  async function runAgent(prompt, io, existingMessages, opts) {
    opts = opts || {};
    const cfg = Object.assign({}, getConfig());
    if (opts.model) cfg.model = opts.model;
    if (opts.provider) cfg.provider = opts.provider;
    const agent = opts.agent || cfg.agent || 'build';
    const cwd = cwdNow();
    const messages = existingMessages || [{ role: 'system', content: systemPrompt(cwd, agent) }];
    const expanded = await expandAtMentions(prompt);
    messages.push({ role: 'user', content: expanded });
    const write = (s) => { if (io && io.write) io.write(s); };
    const writeln = (s) => { if (io && io.writeln) io.writeln(s); else write((s || '') + '\r\n'); };
    if (!cfg.apiKey) cfg.apiKey = 'public';

    const selected = cfg.model || PROVIDERS[cfg.provider].defaultModel;
    let models = [selected];
    if (cfg.provider === 'opencode' && cfg.fallback !== false && !opts.depth) {
      models = modelQueue(selected);
    }
    const endpoints = (cfg.provider === 'opencode' && cfg.fallback !== false && !opts.depth)
      ? endpointQueue(cfg)
      : [(cfg.endpoint || PROVIDERS[cfg.provider].baseUrl).replace(/\/$/, '')];
    let lastErr = null;
    for (let ei = 0; ei < endpoints.length; ei++) {
      const endpoint = endpoints[ei];
      if (ei > 0) writeln(C.dim + 'proxy → ' + endpoint.replace(/^https:\/\//, '') + C.reset);
      for (const model of models) {
        if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages };
        try {
          if (model !== models[0]) writeln(C.dim + 'fallback → ' + model + C.reset);
          const result = await agentLoop(messages, Object.assign({}, cfg, { model, endpoint }), io, writeln, { agent, depth: opts.depth || 0, maxRounds: opts.maxRounds || 10, ask: io && io.ask, askQuestion: io && io.askQuestion });
          if (!opts.depth && (model !== cfg.model || endpoint !== cfg.endpoint)) {
            cfg.model = model;
            cfg.endpoint = endpoint;
            saveConfig(cfg);
          }
          return result;
        } catch (e) {
          lastErr = e;
          const more = model !== models[models.length - 1] || ei < endpoints.length - 1;
          if (more) writeln(C.dim + shortFail(model, e) + ' → next' + C.reset);
          else writeln(C.yellow + shortFail(model, e) + C.reset);
        }
      }
    }
    writeln(C.red + 'All models failed. ' + shortFail(selected, lastErr) + C.reset);
    return { ok: false, reason: 'fail', messages };
  }

  async function agentLoop(messages, cfg, io, writeln, ctx) {
    ctx = ctx || {};
    const maxRounds = ctx.maxRounds || 10;
    const toolsUsed = [];
    const snaps = [];
    ctx.snaps = snaps;
    for (let round = 0; round < maxRounds; round++) {
      if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages, snaps };
      const live = io && (io.onThink || io.onToken);
      const onDelta = live ? (d) => {
        if (d.reasoning && io.onThink) io.onThink(d.reasoning);
        if (d.content && io.onToken) io.onToken(d.content);
      } : null;
      const data = await chatCompletions(messages, cfg, onDelta, () => io && io.aborted && io.aborted());
      const choice = (data.choices && data.choices[0]) || {};
      const msg = choice.message || {};
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const reasoning = msg.reasoning_content || '';
      let content = msg.content || '';
      if (reasoning && io && io.onThink) io.onThink(reasoning);
      if (!content && reasoning && !toolCalls.length) content = '';
      const usage = data.usage || {};
      bumpStats(toolsUsed, (usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
      const textCalls = toolCalls.length ? [] : parseTextTools(content);
      if (!toolCalls.length && !textCalls.length) {
        if (io && io.onToken && content) io.onToken(content);
        else if (content) writeln(content.trimEnd());
        else if (!reasoning) writeln('(no response)');
        messages.push({ role: 'assistant', content: content || '', reasoning_content: reasoning || undefined });
        lastSnapshots.push({ snaps, messagesLen: messages.length });
        redoStack = [];
        return { ok: true, content, messages, snaps };
      }
      if (content && !textCalls.length && !(io && io.onToken)) writeln(content.trimEnd());
      messages.push({ role: 'assistant', content: content || null, reasoning_content: reasoning || undefined, tool_calls: toolCalls.length ? toolCalls : undefined });
      const calls = toolCalls.length
        ? toolCalls.map(tc => ({
            id: tc.id || ('call-' + Math.random()),
            name: (tc.function && tc.function.name) || tc.name,
            args: parseArgsJson(tc.function ? tc.function.arguments : tc.arguments)
          }))
        : textCalls;
      for (const call of calls) {
        if (io && io.aborted && io.aborted()) return { ok: false, reason: 'abort', messages, snaps };
        toolsUsed.push(call.name);
        const preview = summarizeArgs(call.name, call.args);
        writeln(C.cyan + '▸ ' + call.name + C.reset + ' ' + C.dim + preview + C.reset);
        const result = await executeTool(call.name, call.args, ctx);
        const shown = String(result).split('\n').slice(0, 20).join('\n');
        writeln(C.green + shown + C.reset);
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: String(result).slice(0, 8000) });
      }
      if (textCalls.length && !toolCalls.length) {
        messages.push({ role: 'user', content: 'Tool results are above. Continue. If finished, reply with a short summary and no more <tool> tags.' });
      }
    }
    lastSnapshots.push({ snaps, messagesLen: messages.length });
    return { ok: true, content: '', messages, snaps };
  }

  function summarizeArgs(name, args) {
    if (!args) return '';
    if (name === 'bash') return args.command || '';
    if (name === 'read' || name === 'write' || name === 'edit' || name === 'skill' || name === 'lsp') return args.path || args.name || '';
    if (name === 'glob') return args.pattern || '';
    if (name === 'grep') return (args.pattern || '') + (args.path ? ' ' + args.path : '');
    if (name === 'webfetch') return args.url || '';
    if (name === 'websearch') return args.query || '';
    if (name === 'task') return (args.subagent_type || 'general') + ': ' + (args.description || args.prompt || '').slice(0, 40);
    try { return JSON.stringify(args).slice(0, 80); } catch (e) { return ''; }
  }

  function parseArgv(args) {
    const flags = {}, rest = [];
    for (let i = 0; i < (args || []).length; i++) {
      const a = args[i];
      if (a === '-m' || a === '--model') flags.model = args[++i];
      else if (a === '--agent') flags.agent = args[++i];
      else if (a === '-c' || a === '--continue') flags.continue = true;
      else if (a === '-s' || a === '--session') flags.session = args[++i];
      else if (a === '--prompt') flags.prompt = args[++i];
      else if (a === '--share') flags.share = true;
      else if (a === '--format') flags.format = args[++i];
      else if (a === '-v' || a === '--version') flags.version = true;
      else if (a === '-h' || a === '--help') flags.help = true;
      else if (a && a.startsWith('--model=')) flags.model = a.slice(8);
      else if (a && a.startsWith('--agent=')) flags.agent = a.slice(8);
      else rest.push(a);
    }
    return { flags, rest };
  }

  function helpCli() {
    return [
      'Usage: opencode [project] [options]',
      '       opencode <command> [options]',
      '',
      'Commands:',
      '  opencode             Start the TUI',
      '  opencode run [message..]      Non-interactive agent',
      '  auth login|list|logout',
      '  models [provider]    List models',
      '  session list|delete  Manage sessions',
      '  agent list|create    Manage agents',
      '  mcp list|add         MCP servers',
      '  stats                Token/tool stats',
      '  export [id]          Export session markdown/json',
      '  import <file>        Import session json',
      '  web                  Note: this page is the web client',
      '  serve|attach|acp     Not available in termux-web',
      '  upgrade|uninstall    Package lifecycle',
      '',
      'Flags: --model provider/model   --agent build|plan',
      '       --continue, -c           --session <id>',
      '       --version, -v            --help, -h',
      '',
      'TUI:  tab  cycle agent   ctrl+x leader   ctrl+p palette   /help'
    ].join('\n');
  }

  async function runFromShell(args, stdin) {
    args = args || [];
    const { flags, rest } = parseArgv(args);
    if (flags.version) return 'opencode ' + VERSION + ' (termux-web)';
    if (flags.help || rest[0] === 'help') return helpCli();
    const cmd = rest[0];

    if (cmd === 'auth') {
      const sub = rest[1];
      const cfg = getConfig();
      if (sub === 'login') {
        const provider = rest[2] && PROVIDERS[rest[2]] ? rest[2] : 'opencode';
        const key = rest[2] && PROVIDERS[rest[2]] ? rest[3] : rest[2];
        if (!key) return 'Usage: opencode auth login [provider] <api-key>\nGet a Zen key at ' + PROVIDERS.opencode.auth;
        cfg.provider = PROVIDERS[rest[2]] ? rest[2] : cfg.provider;
        cfg.apiKey = key;
        saveConfig(cfg);
        return 'Logged in to ' + (PROVIDERS[cfg.provider] && PROVIDERS[cfg.provider].name) + '.';
      }
      if (sub === 'logout') { cfg.apiKey = 'public'; saveConfig(cfg); return 'Logged out (back to public key).'; }
      return [
        'Credentials',
        '  provider  ' + cfg.provider,
        '  model     ' + cfg.model,
        '  apiKey    ' + (cfg.apiKey && cfg.apiKey !== 'public' ? cfg.apiKey.slice(0, 8) + '…' : 'public'),
        '  endpoint  ' + (cfg.endpoint || PROVIDERS.opencode.baseUrl)
      ].join('\n');
    }
    if (cmd === 'models') {
      const p = rest[1];
      if (p && PROVIDERS[p]) return PROVIDERS[p].name + '\n  ' + PROVIDERS[p].defaultModel;
      return 'opencode (Zen free)\n  ' + FREE_MODELS.map(m => 'opencode/' + m).join('\n  ') +
        '\n\ngroq\n  groq/' + PROVIDERS.groq.defaultModel +
        '\nxai\n  xai/' + PROVIDERS.xai.defaultModel;
    }
    if (cmd === 'agent') {
      if (rest[1] === 'create') {
        const name = rest[2] || 'custom';
        const FS = window.TermuxFS;
        const path = resolvePath('.opencode/agents/' + name + '.md');
        await mkdirp(FS, path);
        await FS.fsWriteFile(path, '---\ndescription: Custom agent\nmode: subagent\npermission:\n  edit: deny\n---\nYou are a specialized agent.\n');
        return 'Created ' + path;
      }
      return Object.keys(AGENTS).map(k => {
        const a = AGENTS[k];
        return (a.mode === 'primary' ? '*' : ' ') + ' ' + k.padEnd(10) + a.mode.padEnd(10) + a.desc;
      }).join('\n');
    }
    if (cmd === 'mcp') return 'MCP servers: (none configured)\nAdd with: opencode mcp add  (not persisted to a real MCP process in termux-web)';
    if (cmd === 'session') {
      const list = loadSessions();
      if (rest[1] === 'delete') {
        const id = rest[2];
        saveSessions(list.filter(s => s.id !== id));
        return id ? 'Deleted ' + id : 'Usage: opencode session delete <id>';
      }
      if (!list.length) return '(no sessions)';
      return list.map(s => s.id.slice(0, 8) + '  ' + (s.title || '(untitled)') + '  ' + (s.agent || 'build') + '  ' + (s.updated || s.created || '')).join('\n');
    }
    if (cmd === 'stats') {
      const s = loadStats();
      const tools = Object.keys(s.tools || {}).map(k => '  ' + k + '  ' + s.tools[k]).join('\n') || '  (none)';
      return 'runs     ' + s.runs + '\ntokens   ' + s.tokens + '\ncost     $' + (s.cost || 0).toFixed(4) + ' (est.)\ntools\n' + tools;
    }
    if (cmd === 'export') {
      const list = loadSessions();
      const s = rest[1] ? list.find(x => x.id === rest[1] || x.id.startsWith(rest[1])) : list[list.length - 1];
      if (!s) return 'No session to export';
      const md = '# ' + (s.title || 'OpenCode session') + '\n\n' + (s.messages || []).map(m => '## ' + m.role + '\n\n' + (m.content || '')).join('\n\n');
      const FS = window.TermuxFS;
      const path = resolvePath('opencode-session-' + s.id.slice(0, 8) + '.md');
      await FS.fsWriteFile(path, md);
      return flags.format === 'json' ? JSON.stringify(s, null, 2) : 'Exported ' + path;
    }
    if (cmd === 'import') {
      const file = rest[1];
      if (!file) return 'Usage: opencode import <file.json>';
      const raw = await window.TermuxFS.fsReadFile(resolvePath(file));
      if (raw === null) return 'import: file not found';
      const s = JSON.parse(raw);
      const list = loadSessions();
      s.id = s.id || uid();
      list.push(s);
      saveSessions(list);
      return 'Imported session ' + s.id;
    }
    if (cmd === 'web') return 'This GitHub Pages app is the web client.\nOfficial `opencode web` needs a local server (not available here). Use the TUI: opencode';
    if (cmd === 'serve' || cmd === 'attach' || cmd === 'acp') return cmd + ': not available in termux-web (needs a local OpenCode daemon)';
    if (cmd === 'github' || cmd === 'plugin' || cmd === 'pr' || cmd === 'db' || cmd === 'debug') return cmd + ': stubbed in termux-web';
    if (cmd === 'upgrade') return 'opencode ' + VERSION + ' (termux-web)\nUpgrade: refresh this GitHub Pages site.';
    if (cmd === 'uninstall') return uninstall();

    if (cmd === 'run') {
      const prompt = flags.prompt || rest.slice(1).join(' ') || stdin || '';
      if (!prompt) return 'Usage: opencode run <message>';
      if (flags.model) {
        const cfg = getConfig();
        const parts = String(flags.model).split('/');
        if (parts.length === 2 && PROVIDERS[parts[0]]) { cfg.provider = parts[0]; cfg.model = parts[1]; }
        else cfg.model = flags.model;
        saveConfig(cfg);
      }
      const chunks = [];
      const io = {
        write: (s) => chunks.push(String(s).replace(/\r/g, '')),
        writeln: (s) => chunks.push(String(s).replace(/\r/g, '') + '\n')
      };
      let msgs = null;
      if (flags.continue) {
        const list = loadSessions();
        const last = list[list.length - 1];
        if (last && last.messages) msgs = last.messages.slice();
      }
      await runAgent(prompt, io, msgs, { agent: flags.agent || getConfig().agent || 'build', model: flags.model && String(flags.model).split('/').pop() });
      return chunks.join('').replace(/\n+$/, '');
    }
    return '\x1b]termux:opencode\x07';
  }

  async function runOnce(prompt, io) { return runAgent(prompt, io, null); }

  /* ============================== TUI ================================= */
  const SLASH = [
    { cmd: '/connect', desc: 'Add a provider API key' },
    { cmd: '/compact', desc: 'Compact the current session', alias: '/summarize', key: 'ctrl+x c' },
    { cmd: '/details', desc: 'Toggle tool execution details' },
    { cmd: '/editor', desc: 'Compose in a multi-line buffer', key: 'ctrl+x e' },
    { cmd: '/exit', desc: 'Exit OpenCode', alias: '/quit /q', key: 'ctrl+x q' },
    { cmd: '/export', desc: 'Export conversation to Markdown', key: 'ctrl+x x' },
    { cmd: '/help', desc: 'Show this help', key: 'ctrl+x h' },
    { cmd: '/init', desc: 'Create or update AGENTS.md' },
    { cmd: '/models', desc: 'List available models', key: 'ctrl+x m' },
    { cmd: '/new', desc: 'Start a new session', alias: '/clear', key: 'ctrl+x n' },
    { cmd: '/redo', desc: 'Redo undone message + files', key: 'ctrl+x r' },
    { cmd: '/sessions', desc: 'List and switch sessions', alias: '/resume /continue', key: 'ctrl+x l' },
    { cmd: '/share', desc: 'Share current session (local id)' },
    { cmd: '/themes', desc: 'List and change themes', key: 'ctrl+x t' },
    { cmd: '/thinking', desc: 'Toggle reasoning blocks' },
    { cmd: '/undo', desc: 'Undo last message + file changes', key: 'ctrl+x u' },
    { cmd: '/unshare', desc: 'Unshare current session' },
    { cmd: '/agents', desc: 'Switch primary agent', key: 'ctrl+x a' },
    { cmd: '/status', desc: 'Show session status' },
    { cmd: '/rename', desc: 'Rename this session' }
  ];

  function strip(s) { return String(s || '').replace(/\x1b\[[0-9;]*m/g, ''); }
  function charWidth(cp) {
    if (!cp || cp <= 31 || (cp >= 0x7f && cp <= 0x9f)) return 0;
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060) return 0;
    if (cp === 0x20e3 || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
    if (cp >= 0x0300 && cp <= 0x036f) return 0;
    if (cp >= 0x1f000 && cp <= 0x1ffff) return 2;
    if (cp >= 0x2600 && cp <= 0x27bf) return 2;
    if (cp >= 0x2e80 && cp <= 0xa4cf) return 2;
    if (cp >= 0xac00 && cp <= 0xd7a3) return 2;
    if (cp >= 0xf900 && cp <= 0xfaff) return 2;
    if (cp >= 0xfe10 && cp <= 0xfe19) return 2;
    if (cp >= 0xfe30 && cp <= 0xfe6f) return 2;
    if (cp >= 0xff00 && cp <= 0xff60) return 2;
    if (cp >= 0xffe0 && cp <= 0xffe6) return 2;
    if (cp >= 0x1100 && cp <= 0x115f) return 2;
    return 1;
  }
  function visWidth(s) {
    let w = 0;
    for (const ch of strip(s)) w += charWidth(ch.codePointAt(0));
    return w;
  }
  function visSlice(s, n) {
    s = String(s || '');
    n = Math.max(0, n | 0);
    let out = '', i = 0, w = 0;
    while (i < s.length && w < n) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (m) { out += m[0]; i += m[0].length; continue; }
      }
      const cp = s.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      const cw = charWidth(cp);
      if (cw > 0 && w + cw > n) break;
      out += ch;
      i += ch.length;
      w += cw;
    }
    return { text: out, rest: s.slice(i), w };
  }
  function fit(s, n) {
    n = Math.max(0, n | 0);
    const { text, w } = visSlice(s, n);
    return text + (w < n ? ' '.repeat(n - w) : '') + C.reset;
  }
  function sideFit(s, n) {
    n = Math.max(0, n | 0);
    const { text, w } = visSlice(s, n);
    const padsp = w < n ? ' '.repeat(n - w) : '';
    return C.bar + String(text || '').replace(/\x1b\[0m/g, C.reset + C.bar) + padsp + C.reset;
  }
  function wrap(text, width) {
    width = Math.max(1, width | 0);
    const out = [];
    String(text || '').split('\n').forEach(line => {
      let rest = line;
      if (visWidth(rest) <= width) { out.push(rest); return; }
      while (visWidth(rest) > width) {
        const cut = visSlice(rest, width);
        if (!cut.text) {
          const ch = String.fromCodePoint(rest.codePointAt(0));
          out.push(ch);
          rest = rest.slice(ch.length);
          continue;
        }
        out.push(cut.text);
        rest = cut.rest;
      }
      if (rest) out.push(rest);
    });
    return out.length ? out : [''];
  }
  function mdAnsi(s) {
    s = String(s || '');
    s = s.replace(/```[\s\S]*?```/g, block => {
      const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
      return inner.split('\n').map(l => C.cyan + l + C.reset).join('\n');
    });
    s = s.replace(/`([^`\n]+)`/g, C.cyan + '$1' + C.reset);
    s = s.replace(/\*\*\s*([^*]+?)\s*\*\*/g, C.bold + '$1' + C.reset);
    s = s.replace(/__([^_]+)__/g, C.bold + '$1' + C.reset);
    s = s.replace(/\*\*/g, '');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1' + C.dim + '$2' + C.reset);
    s = s.replace(/^#{1,6}\s+(.*)$/gm, C.bold + C.white + '$1' + C.reset);
    return s;
  }
  function pad(s, n) { return fit(s, n); }
  function hline(cols, ch) { return (ch || '─').repeat(Math.max(0, cols)); }

  function start(io, argv) {
    io = io || {};
    const argvp = parseArgv(argv || []);
    const cfg0 = getConfig();
    if (argvp.flags.model) {
      const p = String(argvp.flags.model).split('/');
      if (p.length === 2 && PROVIDERS[p[0]]) { cfg0.provider = p[0]; cfg0.model = p[1]; }
      else cfg0.model = argvp.flags.model;
      saveConfig(cfg0);
    }
    const pathArg = argvp.rest.find(a => a && !a.startsWith('-') && a !== 'run');
    if (pathArg && window.TermuxShell) {
      const p = resolvePath(pathArg);
      window.TermuxShell.setCwd(p);
    }

    const tui = tuiCfg();
    const state = {
      buf: '',
      cursor: 0,
      hist: [],
      histIdx: -1,
      busy: false,
      aborted: false,
      leader: false,
      overlay: null,
      overlayIdx: 0,
      overlayFilter: '',
      slashIdx: 0,
      agent: argvp.flags.agent || cfg0.agent || 'build',
      messages: [],
      log: [],
      sessionId: uid(),
      title: 'New session',
      details: tui.details !== false,
      thinking: !!tui.thinking,
      sidebar: !!(tui.sidebarChosen && tui.sidebar),
      theme: tui.theme || 'opencode',
      started: Date.now(),
      lastDur: 0,
      gitBranch: 'main',
      shared: false,
      renameMode: false,
      pendingAsk: null,
      queue: []
    };

    if (argvp.flags.continue || argvp.flags.session) {
      const list = loadSessions();
      const s = argvp.flags.session ? list.find(x => x.id === argvp.flags.session || x.id.startsWith(argvp.flags.session)) : list[list.length - 1];
      if (s) {
        state.sessionId = s.id;
        state.title = s.title || state.title;
        state.messages = s.messages || [];
        state.agent = s.agent || state.agent;
        state.log = s.log || [];
      }
    }

    let resolveDone;
    const done = new Promise(r => { resolveDone = r; });
    const write = (s) => { if (io.write) io.write(s); };
    const cols = () => (io.cols || (io.getCols && io.getCols()) || 80);
    const rows = () => (io.rows || (io.getRows && io.getRows()) || 24);

    function persist() {
      const list = loadSessions().filter(s => s.id !== state.sessionId);
      list.push({
        id: state.sessionId, title: state.title, agent: state.agent,
        model: getConfig().model, messages: state.messages, log: state.log.slice(-80),
        created: state.started, updated: new Date().toISOString(), cwd: cwdNow()
      });
      saveSessions(list);
    }

    function pushLog(kind, text, extra) {
      state.log.push({ kind, text: String(text || ''), extra: extra || '', t: Date.now() });
      if (state.log.length > 200) state.log.shift();
    }

    function fmtNum(n) {
      return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function sidebarPanel(h, sw) {
      const st = loadStats();
      const tokens = st.tokens || 0;
      const ctxWin = 1000000;
      const pct = Math.min(100, Math.round((tokens / ctxWin) * 1000) / 10);
      const id = 'ses_' + String(state.sessionId || '0').replace(/^ses_/, '');
      const out = [];
      const add = (s, stl) => {
        wrap(String(s || ''), Math.max(1, sw - 1)).forEach(l => out.push((stl || C.muted) + ' ' + l + C.reset));
      };
      add(state.title || 'New session', C.bold + C.white);
      out.push('');
      add(id, C.muted);
      out.push('');
      add('Context', C.bold + C.white);
      add(fmtNum(tokens) + ' tokens', C.muted);
      add(String(pct).replace('.', ',') + '% used', C.muted);
      add('$' + (st.cost || 0).toFixed(2) + ' spent', C.muted);
      out.push('');
      add('LSP', C.bold + C.white);
      add('LSPs are disabled', C.muted);
      out.push('');
      add('▼ Todo', C.bold + C.white);
      const todos = sessionTodos || [];
      if (!todos.length) add('No todos', C.dim);
      else todos.forEach(t => {
        const mark = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
        add(mark + ' ' + (t.content || t.id || ''), t.status === 'completed' ? C.dim : C.white);
      });
      const tail = [];
      wrap(displayCwd() + ':' + (state.gitBranch || 'main'), sw).forEach(l => tail.push(C.muted + l + C.reset));
      tail.push(C.muted + '• OpenCode termux-web' + C.reset);
      tail.push(C.dim + VERSION + C.reset);
      while (out.length + tail.length < h) out.push('');
      return out.slice(0, Math.max(0, h - tail.length)).concat(tail).slice(0, h);
    }

    function render() {
      const W = Math.max(40, cols());
      const H = Math.max(12, rows());
      const showSide = state.sidebar !== false && W >= 72;
      const SW = showSide ? Math.min(34, Math.max(24, Math.floor(W * 0.28))) : 0;
      const CW = showSide ? Math.max(32, W - SW - 1) : W;
      const TW = Math.max(8, CW - 2);
      const lines = [];
      const cfg = getConfig();
      const model = (cfg.provider || 'opencode') + '/' + (cfg.model || FREE_MODELS[0]);
      const ag = state.agent;
      const left = C.bold + C.pink + '█ OpenCode' + C.reset + C.muted + '  ' + VERSION + '-web' + C.reset;
      const right = C.cyan + ag + C.reset + C.muted + '  tab to cycle' + C.reset;
      const chat = [];
      const gap = Math.max(1, CW - visWidth(left) - visWidth(right));
      chat.push(fit(left + ' '.repeat(gap) + right, CW));
      chat.push(fit(C.muted + hline(CW) + C.reset, CW));

      const footer = 4;
      const header = chat.length;
      const bodyH = Math.max(3, H - header - footer);
      const body = [];
      if (!state.log.length) {
        body.push('');
        body.push(C.muted + '  Give me a quick summary of the codebase.' + C.reset);
        body.push(C.muted + '  @file  to attach   !cmd  to run shell   /  for commands' + C.reset);
        body.push('');
      } else {
        for (const item of state.log) {
          if (item.kind === 'user') {
            body.push(C.bold + C.cyan + 'you' + C.reset);
            wrap(mdAnsi(item.text), TW).forEach(l => body.push('  ' + l));
          } else if (item.kind === 'assistant') {
            body.push(C.bold + C.pink + 'opencode' + C.reset + C.muted + '  ▣ ' + ag + ' · ' + (cfg.model || '') + C.reset);
            wrap(mdAnsi(item.text), TW).forEach(l => body.push('  ' + l));
          } else if (item.kind === 'tool') {
            body.push(C.yellow + '  ▸ ' + item.text + C.reset);
            if (state.details) wrap(item.extra, Math.max(12, CW - 4)).slice(0, 8).forEach(l => body.push(C.dim + '    ' + l + C.reset));
          } else if (item.kind === 'think') {
            if (state.thinking !== false) {
              body.push(C.dim + C.yellow + '  thinking' + C.reset);
              wrap(mdAnsi(item.text), TW).forEach(l => body.push(C.dim + '  ' + l + C.reset));
            }
          } else if (item.kind === 'sys') {
            wrap(mdAnsi(item.text), TW).forEach(l => body.push(C.muted + '  ' + l + C.reset));
          }
        }
      }
      const view = body.length > bodyH ? body.slice(body.length - bodyH) : body.concat(Array(bodyH - body.length).fill(''));
      view.forEach(l => chat.push(l));
      drawSlashDropdown(chat, header, CW);

      const midH = chat.length;
      const side = showSide ? sidebarPanel(midH, SW) : [];
      for (let i = 0; i < midH; i++) {
        if (!showSide) lines.push(fit(chat[i] || '', W));
        else lines.push(fit(chat[i] || '', CW) + C.muted + '│' + C.reset + sideFit(side[i] || '', SW));
      }

      const qn = (state.queue && state.queue.length) ? C.muted + '  queued ' + state.queue.length + C.reset : '';
      const status = state.busy
        ? C.yellow + '● ' + ag + ' · ' + model + ' · thinking…  esc interrupt' + C.reset + qn
        : C.green + '▣ ' + ag + ' · ' + model + (state.lastDur ? ' · ' + (state.lastDur / 1000).toFixed(1) + 's' : '') + C.reset + C.muted + '   ctrl+x leader  ctrl+p palette  /help' + C.reset;
      lines.push(pad(status, W));
      lines.push(C.muted + '┌' + '─'.repeat(Math.max(0, W - 2)) + '┐' + C.reset);
      const promptPrefix = state.renameMode ? 'rename> ' : (state.buf.startsWith('!') ? '! ' : '> ');
      const shown = promptPrefix + state.buf;
      lines.push(C.muted + '│' + C.reset + pad(C.white + shown + C.reset, W - 2) + C.muted + '│' + C.reset);
      lines.push(C.muted + '└' + '─'.repeat(Math.max(0, W - 2)) + '┘' + C.reset);

      if (state.overlay) {
        const box = state.overlay;
        const items = (box.items || []).filter(it => !state.overlayFilter || (it.label || it.cmd || '').toLowerCase().includes(state.overlayFilter.toLowerCase()));
        const bw = Math.min(W - 2, Math.max(44, box.width || 58));
        const innerW = bw - 2;
        const head = box.hint ? 3 : 2;
        const bh = Math.min(H - 1, Math.max(head + (items.length || 1) + 2, 10));
        const top = Math.max(0, Math.floor((H - bh) / 2));
        const left = Math.max(0, Math.floor((W - bw) / 2));
        const title = ' ' + (box.title || '') + ' ';
        const frame = (l, mid, r, style) => {
          const body = (style || '') + fit(mid, innerW) + C.reset;
          return fit((' '.repeat(left)) + l + body + r, W);
        };
        const itemStart = box.hint ? 2 : 1;
        const itemRows = bh - itemStart - 1;
        state.overlayGeom = { top, itemStart, bh, left, bw, H, W };
        for (let r = 0; r < bh; r++) {
          let rowStr = '';
          if (r === 0) {
            rowStr = frame('┌', title + '─'.repeat(Math.max(0, innerW - title.length)), '┐');
          } else if (r === bh - 1) {
            rowStr = frame('└', '─'.repeat(innerW), '┘');
          } else if (r === 1 && box.hint) {
            rowStr = frame('│', ' ' + box.hint, '│', C.muted);
          } else {
            const idx = r - itemStart;
            const it = idx >= 0 && idx < itemRows ? items[idx] : null;
            if (!it) {
              rowStr = frame('│', ' ', '│');
            } else {
              const sel = idx === state.overlayIdx;
              const lab = ' ' + (it.cmd || it.label || '').padEnd(16) + ' ' + (it.desc || it.key || '');
              rowStr = frame('│', lab, '│', sel ? (C.selBg + C.selFg) : '');
            }
          }
          lines[top + r] = rowStr;
        }
      }

      write('\x1b[?25l\x1b[?7l\x1b[H');
      for (let i = 0; i < H; i++) {
        const row = i + 1;
        write('\x1b[' + row + ';1H\x1b[2K');
        if (!state.overlay && showSide && i < midH) {
          write(visSlice(chat[i] || '', CW).text + C.reset);
          write('\x1b[' + row + ';' + (CW + 1) + 'H' + C.muted + '│' + C.reset + sideFit(side[i] || '', SW));
        } else {
          write(pad(lines[i] || '', W));
        }
      }
      const ccol = 2 + promptPrefix.length + state.cursor;
      const promptRow = Math.max(1, Math.min(H, lines.length - 1));
      write('\x1b[' + promptRow + ';' + Math.min(W - 2, Math.max(2, ccol)) + 'H\x1b[?7h\x1b[?25h');
    }

    function openOverlay(box) {
      state.overlay = box;
      state.overlayIdx = 0;
      state.overlayFilter = '';
      render();
    }
    function overlayItems() {
      if (!state.overlay) return [];
      const q = (state.overlayFilter || '').toLowerCase();
      return (state.overlay.items || []).filter(it => !q || (it.label || it.cmd || '').toLowerCase().includes(q));
    }
    function closeOverlay() {
      const clear = !!(state.overlay && state.overlay.clearOnClose);
      state.overlay = null;
      if (clear) {
        state.buf = '';
        state.cursor = 0;
      }
      render();
    }
    function confirmOverlay() {
      if (!state.overlay) return false;
      const items = overlayItems();
      const it = items[state.overlayIdx];
      if (it && typeof it.run === 'function') it.run();
      else closeOverlay();
      return true;
    }

    function slashMatches(s, q) {
      const query = String(q || '').toLowerCase();
      const aliases = (s.alias || '').split(/\s+/).filter(Boolean).map(a => a.startsWith('/') ? a.toLowerCase() : '/' + a.toLowerCase());
      if (s.cmd.toLowerCase().startsWith(query)) return 0;
      if (aliases.some(a => a.startsWith(query))) return 1;
      if (s.cmd.toLowerCase().includes(query)) return 2;
      if (query.length > 1 && (s.desc || '').toLowerCase().includes(query.slice(1))) return 3;
      return -1;
    }

    function filteredSlash() {
      const b = state.buf || '';
      if (!b.startsWith('/') || /\s/.test(b)) return [];
      const ranked = SLASH.map(s => ({ s, rank: slashMatches(s, b) })).filter(x => x.rank >= 0);
      ranked.sort((a, b) => a.rank - b.rank || a.s.cmd.localeCompare(b.s.cmd));
      return ranked.map(({ s }) => s);
    }

    function syncSlashMenu() {
      const list = filteredSlash();
      if (!list.length) { state.slashIdx = 0; return; }
      if (state.slashIdx >= list.length) state.slashIdx = 0;
      if (state.slashIdx < 0) state.slashIdx = 0;
    }

    function drawSlashDropdown(lines, header, W) {
      if (state.overlay) return;
      const list = filteredSlash();
      if (!list.length) return;
      syncSlashMenu();
      const innerW = Math.max(24, W - 2);
      const boxH = Math.min(list.length + 2, Math.max(5, lines.length - header));
      const top = Math.max(header, lines.length - boxH);
      const mk = (l, mid, r, st) => fit(l + (st || '') + fit(mid, innerW) + C.reset + r, W);
      for (let r = 0; r < boxH; r++) {
        const rowi = top + r;
        if (r === 0) {
          const t = ' Commands ';
          lines[rowi] = mk('┌', t + '─'.repeat(Math.max(0, innerW - t.length)), '┐');
        } else if (r === boxH - 1) {
          lines[rowi] = mk('└', '─'.repeat(innerW), '┘');
        } else {
          const it = list[r - 1];
          if (!it) {
            lines[rowi] = mk('│', ' ', '│');
          } else {
            const sel = (r - 1) === state.slashIdx;
            const lab = ' ' + it.cmd.padEnd(14) + ' ' + (it.desc || '') + (it.key ? '  ' + it.key : '');
            lines[rowi] = mk('│', lab, '│', sel ? (C.selBg + C.selFg) : '');
          }
        }
      }
    }

    function clearPrompt() {
      state.buf = '';
      state.cursor = 0;
    }

    function fillAndRun(cmd) {
      closeOverlay();
      state.buf = cmd;
      state.cursor = cmd.length;
      state.hist.push(cmd);
      state.histIdx = state.hist.length;
      render();
      setTimeout(() => { handleSlash(cmd); }, 50);
    }

    function paletteItems() {
      return SLASH.map(s => ({ cmd: s.cmd, desc: s.desc, key: s.key, label: s.cmd, run: () => fillAndRun(s.cmd) }));
    }

    async function handleSlash(line) {
      const raw = line.trim();
      const parts = raw.split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(' ');
      if (cmd === '/exit' || cmd === '/quit' || cmd === '/q') { persist(); exit(0); return; }
      if (cmd === '/help') {
        openOverlay({ title: 'Commands', hint: 'esc close   enter escribe y ejecuta', items: SLASH.map(s => ({ cmd: s.cmd, desc: s.desc + (s.key ? '  ' + s.key : ''), label: s.cmd, run: () => fillAndRun(s.cmd) })) });
        return;
      }
      if (cmd === '/new' || cmd === '/clear') {
        persist();
        state.sessionId = uid();
        state.title = 'New session';
        state.messages = [];
        state.log = [];
        sessionTodos = [];
        pushLog('sys', 'New session.');
        render();
        return;
      }
      if (cmd === '/models') {
        const items = FREE_MODELS.map(m => ({ label: 'opencode/' + m, cmd: m, desc: 'Zen free', run: () => { const c = getConfig(); c.provider = 'opencode'; c.model = m; saveConfig(c); closeOverlay(); pushLog('sys', 'Model ' + m); render(); } }));
        openOverlay({ title: 'Models', hint: 'enter to select', items, clearOnClose: true });
        return;
      }
      if (cmd === '/agents') {
        const items = Object.keys(AGENTS).filter(k => AGENTS[k].mode === 'primary').map(k => ({ label: k, desc: AGENTS[k].desc, run: () => { state.agent = k; closeOverlay(); pushLog('sys', 'Agent ' + k); render(); } }));
        openOverlay({ title: 'Agents  (tab cycles Build/Plan)', items, clearOnClose: true });
        return;
      }
      if (cmd === '/themes') {
        openOverlay({
          title: 'Themes',
          items: THEMES.map(t => ({ label: t, run: () => { state.theme = t; const tui = tuiCfg(); tui.theme = t; saveTui(tui); closeOverlay(); pushLog('sys', 'Theme ' + t); render(); } })),
          clearOnClose: true
        });
        return;
      }
      if (cmd === '/sessions' || cmd === '/resume' || cmd === '/continue') {
        const list = loadSessions();
        openOverlay({
          title: 'Sessions',
          clearOnClose: true,
          items: (list.length ? list : [{ title: '(none)', id: '' }]).map(s => ({
            label: (s.id || '').slice(0, 8) + '  ' + (s.title || ''),
            desc: s.agent || '',
            run: () => {
              if (!s.id) { closeOverlay(); return; }
              persist();
              state.sessionId = s.id; state.title = s.title; state.messages = s.messages || []; state.log = s.log || []; state.agent = s.agent || 'build';
              closeOverlay();
            }
          }))
        });
        return;
      }
      if (cmd === '/connect') {
        if (!arg) { pushLog('sys', 'Usage: /connect opencode|groq|xai <api-key>\nZen key: ' + PROVIDERS.opencode.auth + '\nDefault is public (free).'); render(); return; }
        const p = arg.split(/\s+/);
        const cfg = getConfig();
        if (PROVIDERS[p[0]] && p[1]) { cfg.provider = p[0]; cfg.apiKey = p.slice(1).join(' '); if (PROVIDERS[p[0]].defaultModel) cfg.model = PROVIDERS[p[0]].defaultModel; }
        else cfg.apiKey = arg;
        saveConfig(cfg);
        pushLog('sys', 'Connected ' + cfg.provider);
        render();
        return;
      }
      if (cmd === '/details') { state.details = !state.details; const t = tuiCfg(); t.details = state.details; saveTui(t); pushLog('sys', 'details ' + (state.details ? 'on' : 'off')); render(); return; }
      if (cmd === '/thinking') { state.thinking = !state.thinking; pushLog('sys', 'thinking display ' + (state.thinking ? 'on' : 'off')); render(); return; }
      if (cmd === '/compact' || cmd === '/summarize') {
        const kept = state.messages.slice(0, 1).concat(state.messages.slice(-6));
        state.messages = kept;
        pushLog('sys', 'Session compacted.');
        render();
        return;
      }
      if (cmd === '/undo') {
        const snap = lastSnapshots.pop();
        if (!snap) { pushLog('sys', 'Nothing to undo'); render(); return; }
        redoStack.push({ snaps: snap.snaps, log: state.log.slice(), messages: state.messages.slice() });
        await restoreSnaps(snap.snaps);
        state.log = state.log.filter(x => x.kind !== 'assistant' && x.kind !== 'tool').slice(0, -1);
        pushLog('sys', 'Undid last turn (files restored).');
        render();
        return;
      }
      if (cmd === '/redo') {
        const snap = redoStack.pop();
        if (!snap) { pushLog('sys', 'Nothing to redo'); render(); return; }
        state.log = snap.log; state.messages = snap.messages;
        pushLog('sys', 'Redid last turn.');
        render();
        return;
      }
      if (cmd === '/export') {
        const md = state.log.map(i => '## ' + i.kind + '\n\n' + i.text + (i.extra ? '\n\n' + i.extra : '')).join('\n\n');
        const path = resolvePath('opencode-session-' + state.sessionId.slice(0, 8) + '.md');
        await window.TermuxFS.fsWriteFile(path, '# ' + state.title + '\n\n' + md);
        pushLog('sys', 'Exported ' + path);
        render();
        return;
      }
      if (cmd === '/share') { state.shared = true; pushLog('sys', 'Share id: ' + state.sessionId + ' (local only in termux-web)'); render(); return; }
      if (cmd === '/unshare') { state.shared = false; pushLog('sys', 'Unshared'); render(); return; }
      if (cmd === '/status') {
        const cfg = getConfig();
        pushLog('sys', 'OpenCode ' + VERSION + '-web\nagent  ' + state.agent + '\nmodel  ' + cfg.provider + '/' + cfg.model + '\nsession  ' + state.sessionId + '\ncwd  ' + cwdNow() + '\nmessages  ' + state.messages.length);
        render();
        return;
      }
      if (cmd === '/rename') {
        state.renameMode = true;
        state.buf = state.title;
        state.cursor = state.buf.length;
        render();
        return;
      }
      if (cmd === '/editor') {
        pushLog('sys', 'Multi-line editor: type your message, then /exit-editor is not needed — Shift+Enter is not available; submit with Enter. Use \\n for newline.');
        render();
        return;
      }
      if (cmd === '/init') {
        const path = resolvePath('AGENTS.md');
        const existing = await window.TermuxFS.fsReadFile(path);
        const starter = '# AGENTS.md\n\nThis is a Termux Web project (browser Linux environment).\n\n## Build\n- Shell is a JS POSIX subset. Files persist in IndexedDB.\n- Prefer small edits. Do not assume native binaries beyond the simulated shell.\n\n## Conventions\n- Paths are virtual: /data/data/com.termux/files/home\n';
        if (!existing) await window.TermuxFS.fsWriteFile(path, starter);
        pushLog('sys', existing ? 'AGENTS.md already exists. Ask the agent to update it.' : 'Wrote AGENTS.md');
        if (existing) await submit('Update AGENTS.md for this project using /init guidelines.');
        else render();
        return;
      }
      pushLog('sys', 'Unknown command ' + cmd + '  (try /help)');
      render();
    }

    async function submit(text) {
      const line = (text == null ? state.buf : text).trim();
      if (!line) return;
      if (state.busy) {
        state.buf = '';
        state.cursor = 0;
        if (line.startsWith('/')) { handleSlash(line); return; }
        state.queue.push(line);
        state.hist.push(line);
        state.histIdx = state.hist.length;
        render();
        return;
      }
      if (state.renameMode) {
        state.title = line || state.title;
        state.renameMode = false;
        state.buf = '';
        state.cursor = 0;
        persist();
        render();
        return;
      }
      if (line.startsWith('/')) { state.buf = ''; state.cursor = 0; await handleSlash(line); return; }
      if (line.startsWith('!')) {
        const cmd = line.slice(1).trim();
        state.buf = ''; state.cursor = 0;
        pushLog('user', '!' + cmd);
        const out = await window.TermuxShell.shRun(cmd);
        pushLog('tool', 'bash ' + cmd, out || '');
        state.messages.push({ role: 'user', content: 'Command output of `' + cmd + '`:\n' + (out || '') });
        persist();
        render();
        return;
      }
      state.hist.push(line);
      state.histIdx = state.hist.length;
      state.buf = '';
      state.cursor = 0;
      pushLog('user', line);
      state.busy = true;
      state.aborted = false;
      let lastPaint = 0, paintTimer = 0;
      function livePaint() {
        const now = Date.now();
        if (now - lastPaint < 50) {
          if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = 0; lastPaint = Date.now(); render(); }, 50);
          return;
        }
        lastPaint = now;
        render();
      }
      function upsertLog(kind, text) {
        const last = state.log[state.log.length - 1];
        if (last && last.kind === kind && last.live) last.text = text;
        else state.log.push({ kind, text: String(text || ''), extra: '', t: Date.now(), live: true });
        livePaint();
      }
      render();
      const t0 = Date.now();
      const ioAgent = {
        write: (s) => { /* TUI captures via pushLog */ },
        writeln: (s) => {
          const t = String(s || '');
          if (t.indexOf('▸ ') >= 0) pushLog('tool', strip(t).replace(/^▸ /, ''), '');
          else if (t) pushLog('assistant', strip(t));
          render();
        },
        onThink: (text) => upsertLog('think', text),
        onToken: (text) => upsertLog('assistant', text),
        aborted: () => state.aborted,
        ask: (tool, args) => new Promise(resolve => {
          openOverlay({
            title: 'Permission',
            hint: 'y allow   n deny',
            items: [
              { label: 'Allow  ' + tool + '  ' + summarizeArgs(tool, args), run: () => { closeOverlay(); resolve(true); } },
              { label: 'Deny', run: () => { closeOverlay(); resolve(false); } }
            ]
          });
          state.pendingAsk = resolve;
        }),
        askQuestion: (args) => new Promise(resolve => {
          const opts = args.options || ['yes', 'no'];
          openOverlay({
            title: args.header || 'Question',
            hint: args.question || '',
            items: opts.map(o => ({ label: String(o), run: () => { closeOverlay(); resolve(String(o)); } }))
          });
        })
      };
      try {
        const result = await runAgent(line, ioAgent, state.messages.length ? state.messages : null, { agent: state.agent });
        state.messages = result.messages || state.messages;
        if (result.content && !state.log.some(l => l.kind === 'assistant' && l.text === result.content)) {
          pushLog('assistant', result.content);
        }
        if (!state.title || state.title === 'New session') state.title = line.slice(0, 42);
      } catch (e) {
        pushLog('sys', String(e.message || e));
      }
      state.lastDur = Date.now() - t0;
      state.busy = false;
      state.log.forEach(l => { l.live = false; });
      persist();
      if (resolveDone) render();
      const next = state.queue.shift();
      if (next) submit(next);
    }

    function moveCursor(n) {
      state.cursor = Math.max(0, Math.min(state.buf.length, state.cursor + n));
    }

    function onData(data) {
      if (state.leader) {
        state.leader = false;
        const k = data.toLowerCase();
        const map = { n: '/new', l: '/sessions', c: '/compact', d: '/details', e: '/editor', x: '/export', s: '/share', t: '/themes', m: '/models', i: '/init', u: '/undo', r: '/redo', q: '/exit', a: '/agents', h: '/help', b: 'sidebar' };
        if (data === 'q' || k === 'q') { persist(); exit(0); return; }
        if (k === 'b') {
          state.sidebar = !state.sidebar;
          const t = tuiCfg();
          t.sidebar = state.sidebar;
          t.sidebarChosen = true;
          saveTui(t);
          render();
          return;
        }
        if (map[k]) handleSlash(map[k]);
        else render();
        return;
      }
      if (data === '\x18') { state.leader = true; render(); return; } // ctrl+x
      if (data === '\x10') { // ctrl+p palette
        openOverlay({ title: 'Command palette', hint: 'type to filter', items: paletteItems() });
        return;
      }
      if (data === '\x1b' || data === '\x1b[27~') {
        if (state.overlay) {
          if (state.pendingAsk) { const r = state.pendingAsk; state.pendingAsk = null; r(false); }
          state.overlay = null;
        }
        if (state.busy) {
          state.aborted = true;
          state.busy = false;
          pushLog('sys', 'interrupted');
        }
        state.buf = '';
        state.cursor = 0;
        state.overlayFilter = '';
        state.slashIdx = 0;
        render();
        return;
      }
      if (data === '\x03') { // ctrl+c
        if (state.busy) { state.aborted = true; state.busy = false; pushLog('sys', 'interrupted'); render(); return; }
        if (state.buf) { state.buf = ''; state.cursor = 0; render(); return; }
        persist(); exit(130); return;
      }
      if (data === '\x04') { persist(); exit(0); return; } // ctrl+d
      if (data === '\t') {
        const slashList = filteredSlash();
        if (slashList.length) {
          const it = slashList[state.slashIdx];
          if (it && it.cmd) {
            state.buf = it.cmd;
            state.cursor = state.buf.length;
            syncSlashMenu();
            render();
          }
          return;
        }
        const primaries = Object.keys(AGENTS).filter(k => AGENTS[k].mode === 'primary');
        const i = primaries.indexOf(state.agent);
        state.agent = primaries[(i + 1) % primaries.length];
        const cfg = getConfig(); cfg.agent = state.agent; saveConfig(cfg);
        render();
        return;
      }
      if (state.overlay) {
        const items = overlayItems();
        if (data === '\r' || data === '\n' || data === '\r\n') {
          confirmOverlay();
          return;
        }
        if (data === '\x1b[A') { state.overlayIdx = Math.max(0, state.overlayIdx - 1); render(); return; }
        if (data === '\x1b[B') { state.overlayIdx = Math.min(Math.max(0, items.length - 1), state.overlayIdx + 1); render(); return; }
        if (data === '\x7f' || data === '\b') { state.overlayFilter = state.overlayFilter.slice(0, -1); state.overlayIdx = 0; render(); return; }
        if (data.length === 1 && data.charCodeAt(0) >= 32) { state.overlayFilter += data; state.overlayIdx = 0; render(); return; }
        return;
      }
      const slashList = filteredSlash();
      if (slashList.length && data === '\r') {
        const it = slashList[state.slashIdx];
        if (it) fillAndRun(it.cmd);
        else submit();
        return;
      }
      if (slashList.length && data === '\x1b[A') {
        state.slashIdx = Math.max(0, state.slashIdx - 1);
        render();
        return;
      }
      if (slashList.length && data === '\x1b[B') {
        state.slashIdx = Math.min(slashList.length - 1, state.slashIdx + 1);
        render();
        return;
      }
      if (data === '\r') { submit(); return; }
      if (data === '\x1b[A') {
        if (!state.hist.length) return;
        state.histIdx = Math.max(0, state.histIdx - 1);
        state.buf = state.hist[state.histIdx] || '';
        state.cursor = state.buf.length;
        syncSlashMenu();
        render();
        return;
      }
      if (data === '\x1b[B') {
        state.histIdx = Math.min(state.hist.length, state.histIdx + 1);
        state.buf = state.hist[state.histIdx] || '';
        state.cursor = state.buf.length;
        syncSlashMenu();
        render();
        return;
      }
      if (data === '\x1b[C') { moveCursor(1); render(); return; }
      if (data === '\x1b[D') { moveCursor(-1); render(); return; }
      if (data === '\x01') { state.cursor = 0; render(); return; }
      if (data === '\x05') { state.cursor = state.buf.length; render(); return; }
      if (data === '\x7f' || data === '\b') {
        if (state.cursor > 0) {
          state.buf = state.buf.slice(0, state.cursor - 1) + state.buf.slice(state.cursor);
          state.cursor--;
          syncSlashMenu();
          render();
        }
        return;
      }
      if (data === '\x15') { state.buf = state.buf.slice(state.cursor); state.cursor = 0; syncSlashMenu(); render(); return; }
      if (data === '\x0b') { state.buf = state.buf.slice(0, state.cursor); syncSlashMenu(); render(); return; }
      if (data === '\x1b[5~' || data === '\x1b[6~') return;
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        state.buf = state.buf.slice(0, state.cursor) + data + state.buf.slice(state.cursor);
        state.cursor++;
        syncSlashMenu();
        render();
      }
    }

    function exit(code) {
      write('\x1b[?25h\x1b[?7h\x1b[2J\x1b[H');
      if (io.writeln) io.writeln(C.muted + 'bye' + C.reset);
      if (resolveDone) { const r = resolveDone; resolveDone = null; r(code || 0); }
    }

    (async () => {
      try {
        const FS = window.TermuxFS;
        let raw = await FS.fsReadFile(resolvePath('.git/HEAD'));
        if (!raw) raw = await FS.fsReadFile(norm(homeNow() + '/.git/HEAD'));
        if (raw) {
          const m = String(raw).match(/ref:\s*refs\/heads\/(\S+)/);
          state.gitBranch = m ? m[1] : String(raw).trim().slice(0, 8);
          render();
        }
      } catch (e) {}
    })();

    if (argvp.flags.prompt) {
      render();
      setTimeout(() => submit(argvp.flags.prompt), 0);
    } else {
      render();
    }

    function onClick(ev, term) {
      if (!state.overlay) return;
      const items = overlayItems();
      const g = state.overlayGeom;
      if (g && term && ev && typeof ev.clientY === 'number') {
        const el = term.element && (term.element.querySelector('.xterm-rows') || term.element.querySelector('.xterm-screen') || term.element);
        const rect = el.getBoundingClientRect();
        const rows = term.rows || g.H || 24;
        const row = Math.floor((ev.clientY - rect.top) / (rect.height / rows));
        const idx = row - g.top - g.itemStart;
        if (idx >= 0 && idx < items.length) state.overlayIdx = idx;
      }
      confirmOverlay();
    }

    return {
      onData,
      onClick,
      abort: () => { state.aborted = true; exit(130); },
      done,
      getBuf: () => state.buf,
      getOverlayTitle: () => state.overlay && state.overlay.title
    };
  }

  return {
    VERSION, PROVIDERS, FREE_MODELS, TOOLS, AGENTS, THEMES,
    visWidth, fit, wrap, sideFit, mdAnsi,
    getConfig, saveConfig, isInstalled, install, uninstall,
    executeTool, runAgent, runOnce, runFromShell, start
  };
})();

window.TermuxOpenCode = TermuxOpenCode;
