# cssprobe-cli

Runtime CSS probe — inspect layout, scroll, colors, backgrounds, fonts and more in a live browser. Built for both humans and AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)

---

## Why cssprobe-cli?

When an AI agent needs to debug CSS — why is this element overflowing, what's the actual rendered layout, is this container scrollable — it can't see the browser. It guesses from static code, missing runtime-only issues like overflow, scroll chains, and containing block hijacks.

**cssprobe-cli gives the agent eyes.** It opens a real browser, collects computed styles and metrics via injected JavaScript, analyzes them with a confidence model, and returns structured findings — all in one command. The agent asks a question about any selector and gets back the DOM tree, ASCII layout diagram, overflow warnings, and scroll diagnosis without leaving the terminal.

---

## Installation

### For Humans

Copy and paste this prompt to your LLM agent (Claude Code, Cursor, Codex, etc.):

```
Install and configure cssprobe-cli by following the instructions here:
https://raw.githubusercontent.com/mack-peng/cssprobe-cli/main/docs/guide/installation.md
```

Or read the [Installation Guide](docs/guide/installation.md), but seriously, let an agent do it. Humans fat-finger configs.

### For LLM Agents

Fetch the installation guide and follow it:

```bash
curl -s https://raw.githubusercontent.com/mack-peng/cssprobe-cli/main/docs/guide/installation.md
```

Or install directly:

```bash
npm install -g cssprobe-cli
cssprobe-cli skill-install
```

---

## How It Works

```
┌───────────────────────────────────────────────────────────┐
│                      AI Agent                              │
│                                                           │
│  "Is .sidebar overflowing?"                               │
│      calls: cssprobe-cli inspect .sidebar                 │
│                             │                             │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                  cssprobe-cli daemon                       │
│                                                           │
│  collector (IIFE) → analyzer (pure) → renderer (md/json)  │
│                             │                             │
│                             ▼                             │
│               Playwright browser (Chromium)                │
│     getBoundingClientRect · getComputedStyle · DOM walk    │
└───────────────────────────────────────────────────────────┘
```

1. **Session** — `open` spawns a daemon process managing a browser. Commands connect via Unix socket.
2. **Collector** — Injected as IIFE into the page. Walks the DOM, reads computed styles, declared values, and element metrics.
3. **Analyzer** — Pure Node.js functions. Classifies findings with confidence levels (DEFINITE / INDEFINITE / UNVERIFIABLE).
4. **Renderer** — Outputs Markdown (default) or JSON. Includes ASCII layout diagram, DOM tree, and findings.

---

## Quick Start

### 1. Inspect a Page

```bash
# Open browser (non-blocking, starts daemon session)
cssprobe-cli open https://getbootstrap.com/docs/5.3/examples/checkout

# Inspect with CSS selector
cssprobe-cli inspect .container

# Show ASCII layout diagram
cssprobe-cli layout .container

# Show only issues/warnings
cssprobe-cli findings .container

# Close browser when done
cssprobe-cli close
```

### 2. Login-Protected Pages

```bash
# Open browser in headed mode
cssprobe-cli open https://mysite.com --headed

# User manually logs in...

# Save session state for future use
cssprobe-cli playwright "page.context().storageState({path: 'state.json'})"

# Reopen with saved state (no login needed)
cssprobe-cli open https://mysite.com --state state.json --headed
```

### 3. JSON Output

```bash
cssprobe-cli inspect body --json
cssprobe-cli inspect body --json | jq '.findings[] | {id, confidence, message}'
```

---

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `open [url]` | Open browser in session mode (non-blocking) |
| `open [url] --headed` | Show browser window |
| `open [url] --state <file>` | Open with saved cookies + localStorage |
| `open [url] --viewport 1280x720` | Custom viewport size |
| `close` | Close browser session |
| `close --all` | Close all sessions across all workspaces |
| `status` | Show session status |

### CSS Inspection

| Command | Description |
|---------|-------------|
| `inspect <selector>` | Full CSS diagnosis (computed values, declared values, findings) |
| `inspect <selector> --layout` | Include ASCII layout diagram |
| `inspect <selector> --brief` | Compact: tree sketch + warnings/errors only |
| `inspect <selector> --json` | Structured JSON output |
| `tree <selector>` | DOM tree structure |
| `layout <selector>` | ASCII layout diagram |
| `findings <selector>` | Only issues/warnings/errors |

### CSS Injection

| Command | Description |
|---------|-------------|
| `inject-css <css>` | Inject CSS into current page |

### Browser

| Command | Description |
|---------|-------------|
| `resize <width> <height>` | Resize browser viewport |
| `eval <expression>` | Evaluate JavaScript (browser context) |
| `playwright <call>` | Execute Playwright API (Node.js context) |
| `screenshot` | Take screenshot |

### State

| Command | Description |
|---------|-------------|
| `state-import <file>` | Import cookies from Netscape format |

### Configuration

| Command | Description |
|---------|-------------|
| `config-show` | Show current config |
| `config-set <key> <value>` | Set config value |
| `config-list` | List all profiles |
| `config-use <name>` | Switch active profile |
| `config-new <name>` | Create new profile |
| `config-path` | Show config file path |

---

## Confidence Model

Every finding carries a confidence level:

| Level | Meaning |
|-------|---------|
| **DEFINITE** | Based on computed values (facts from getComputedStyle) or accessible declared values |
| **INDEFINITE** | Declared value uses `%` — resolves at runtime |
| **UNVERIFIABLE** | Declared value missing or from blocked cross-origin stylesheet |

The report header shows: `confidence: DEFINITE 8 | INDEFINITE 0 | UNVERIFIABLE 1`

---

## Configuration

```bash
# Set values
cssprobe-cli config-set browser chromium
cssprobe-cli config-set depth 8
cssprobe-cli config-set viewport 375x812

# Profile management
cssprobe-cli config-new staging
cssprobe-cli -p staging config-set browser firefox
cssprobe-cli config-use staging
```

Priority: CLI flags > Environment variables > Config file

```
--browser       CSSPROBE_BROWSER
--depth         CSSPROBE_DEPTH
--headed        CSSPROBE_HEADED
--viewport      CSSPROBE_VIEWPORT
-p, --profile   CSSPROBE_PROFILE
```

Config file: `~/.cssprobe-clirc`

---

## Supported Platforms

| Platform | Architectures |
|----------|---------------|
| macOS | x64, arm64 |
| Linux | x64, arm64 |
| Windows | x64, arm64 |

---

## Development

```bash
npm install
npm run build       # tsc + esbuild collector + daemon entry + generate help.json
npm test            # Run unit tests (58 tests)
npx tsc --noEmit    # Type check only
```

## License

MIT
