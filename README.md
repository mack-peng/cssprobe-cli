# cssprobe-cli

Runtime CSS probe — inspect layout, scroll, colors, backgrounds, fonts and more in a live browser. Built for both humans and AI agents.

## Installation

### For Humans

```bash
npm install -g cssprobe-cli
```

### For LLM Agents

```bash
cssprobe-cli skill-install
```

---

## Quick Start

### 1. Inspect a Page

```bash
# With explicit selector
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout ".container"

# Auto-detect root element
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout

# Local HTML file
cssprobe-cli inspect ./test.html ".container"
```

### 2. Login-Protected Pages

```bash
# Import cookies from browser export (Netscape format)
cssprobe-cli state-import cookies.txt --out ~/.cssprobe-cli/states/mysite.json

# Or interactive login
cssprobe-cli login https://mysite.com

# Then inspect with state
cssprobe-cli inspect https://mysite.com/page ".target" --state ~/.cssprobe-cli/states/mysite.json
```

### 3. JSON Output

```bash
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body --json
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body --json | jq '.findings[] | {id, confidence, message}'
```

---

## Output Modes

| Flag | Output | Use Case |
|------|--------|----------|
| (default) | Markdown report with ancestor chain, DOM tree, findings | Terminal viewing |
| `--json` | Structured JSON with snapshot, findings, confidence summary | Scripts, `jq` pipes, AI agent consumption |

---

## Commands

### Inspection

```bash
cssprobe-cli inspect <url> [selector]    # Inspect CSS layout
cssprobe-cli login <url>                 # Interactive login, save state
cssprobe-cli state-import [file]         # Import cookies from Netscape format
```

### Inspection

```bash
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body
```

### Configuration

```bash
cssprobe-cli config-show                 # Show current config
cssprobe-cli config-set <key> <value>    # Set config value
cssprobe-cli config-list                 # List all profiles
cssprobe-cli config-use <name>           # Switch active profile
cssprobe-cli config-new <name>           # Create new profile
cssprobe-cli config-path                 # Show config file path
```

---

## inspect Options

```bash
cssprobe-cli inspect <url> [selector] [options]

Arguments:
  <url>                       URL, file:// path, or local HTML file
  [selector]                  CSS selector for root (auto-detected if omitted)

Options:
  --json                      Output structured JSON
  --headed                    Show browser window
  --browser <engine>          chromium|firefox|webkit (default chromium)
  --zoom                      Run 1x/0.5x viewport diagnosis
  --depth <n>                 DOM tree depth (default: auto)
  --max-nodes <n>             Node count cap (default 60)
  --up-to <tag>               Ancestor stop tag (default html)
  --state <file>              Load saved state (cookies + localStorage)
  --brief                     Compact output: tree sketch + warnings/errors only
```

---

## state-import

Import cookies from Netscape format (browser export standard) into a Playwright state file.

```bash
# From file
cssprobe-cli state-import cookies.txt --out mystate.json

# From stdin
cat cookies.txt | cssprobe-cli state-import --out mystate.json

# Merge into existing state
cssprobe-cli state-import new-cookies.txt --merge existing.json --out merged.json
```

Netscape format (tab-separated):
```
.example.com	TRUE	/	TRUE	1813025057	session_id	abc123
.example.com	TRUE	/	FALSE	-1	lang	zh-CN
```

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

# Show current config
cssprobe-cli config-show

# Profile management
cssprobe-cli config-new staging
cssprobe-cli -p staging config-set browser firefox
cssprobe-cli config-use staging
cssprobe-cli config-list
```

Priority: CLI flags > Environment variables > Config file

```
--browser       CSSPROBE_BROWSER
--depth         CSSPROBE_DEPTH
--headed        CSSPROBE_HEADED
-p, --profile   CSSPROBE_PROFILE
```

Config file: `~/.cssprobe-clirc`

---

## Agent Skill

```bash
# Install skill for all detected agents
cssprobe-cli skill-install

# Install for a specific agent
cssprobe-cli skill-install --target opencode
cssprobe-cli skill-install --target claude

# Remove installed skills
cssprobe-cli skill-uninstall
```

---

## Global Options

```
--json              Output as JSON (default: Markdown)
--raw               Output raw result without formatting
--help [command]    Show help for a command or global
--version           Show version
-p, --profile       Use named config profile
```

---

## Development

```bash
npm install
npm run build       # tsc + esbuild collector bundle + generate help.json
npm test            # Run unit tests
npx tsc --noEmit    # Type check only
```

## License

MIT
