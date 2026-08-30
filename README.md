# Termux Web

A working Termux-style Linux environment in the browser, hosted at
[fivetechsoft.github.io/termux](https://fivetechsoft.github.io/termux/).

This is **not** a copy of [termux.github.io](https://github.com/termux/termux.github.io).
It is an operational terminal: filesystem, POSIX-like shell, packages, and
[OpenCode](https://opencode.ai) as a coding agent.

## Use

Open the site, wait for the prompt, then:

```bash
help
ls
pkg search opencode
opencode
```

### OpenCode

Modeled on [anomalyco/opencode](https://github.com/anomalyco/opencode) (TUI, slash commands, tools, agents). It is still a browser runtime, not the native binary.

```bash
opencode                          # full-screen TUI
opencode run "create hello.py"    # one-shot agent
opencode models
opencode auth list
opencode agent list
opencode session list
opencode stats
opencode --version
```

TUI (same ideas as upstream):

- `tab` cycle **build** / **plan**
- `ctrl+x` leader (`n` new, `l` sessions, `m` models, `h` help, `q` quit, …)
- `ctrl+p` command palette
- `/help` `/init` `/undo` `/compact` `/export` `/connect` …
- `@file` attach, `!cmd` shell into the session
- Tools: bash, read, write, edit, apply_patch, glob, grep, webfetch, websearch, todowrite, skill, question, task, lsp

Free OpenCode Zen models work out of the box via `https://api.fivetechsoft.com/zen/v1`
(public key). Optional own key inside the TUI:

```
/connect opencode <key>     # https://opencode.ai/auth
/connect groq <key>
/connect xai <key>
```

Default model: `laguna-s-2.1-free`, with fallback across other `*-free` ids.

Install paths that also work:

```bash
pkg install opencode
npm install -g opencode-ai
curl -fsSL https://opencode.ai/install | bash
```

Inside the TUI: `/help` `/models` `/model <id>` `/new` `/exit` and `!ls`.

The agent can read, write, edit, grep, glob, and run shell commands against the
persistent IndexedDB disk.

## What works

| Area | Commands |
| --- | --- |
| Files | `ls` `cat` `cd` `mkdir` `touch` `rm` `mv` `cp` `find` |
| Text | `echo` `grep` `head` `tail` `wc` `sort` `sed`-like `tr` `cut` |
| Shell | pipes `\|`, redirects `> >>`, `&& \|\| ;`, `$()`, globs |
| Packages | `pkg` / `apt` install, search, list |
| Network | `curl` `wget` |
| Runtimes | `node` `python` `bash` |
| Git | `git init/status/add/commit/log` |
| AI | `opencode` (agent + TUI), `ai` |

Files persist in IndexedDB (`termux-disk`). Extra keys include **OC** to launch OpenCode.

## Run locally

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`.

```bash
node tests/verify.mjs
```
