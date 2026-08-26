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
# Open browser (non-blocking, starts daemon session)
cssprobe-cli open https://getbootstrap.com/docs/5.3/examples/checkout

# Open with custom viewport
cssprobe-cli open https://example.com --viewport 1280x720

# Inspect with CSS selector
cssprobe-cli inspect .container

# Show DOM tree
cssprobe-cli tree .container --depth 3

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

# Run diagnosis on authenticated page
cssprobe-cli inspect .dashboard

# Inject CSS to test changes
cssprobe-cli inject-css ".sidebar { background: #f0f0f0; }"

# Take screenshot
cssprobe-cli screenshot

# Close when done
cssprobe-cli close
```

### 3. Import Cookies

```bash
# Import cookies from browser export (Netscape format)
cssprobe-cli state-import cookies.txt --out ~/.cssprobe-cli/states/mysite.json

# Or use --name for simpler syntax
cssprobe-cli state-import cookies.txt --name mysite

# Open browser with saved state
cssprobe-cli open https://mysite.com --state ~/.cssprobe-cli/states/mysite.json
```

### 4. JSON Output

```bash
cssprobe-cli open https://getbootstrap.com/docs/5.3/examples/checkout
cssprobe-cli inspect body --json
cssprobe-cli inspect body --json | jq '.findings[] | {id, confidence, message}'
cssprobe-cli close
```

---

## Session Mode

cssprobe-cli uses a session-based architecture for non-browser interaction:

```bash
# Start session (opens browser, returns immediately)
cssprobe-cli open <url>

# Run commands (each command is independent, non-blocking)
cssprobe-cli inspect <selector>
cssprobe-cli tree <selector>
cssprobe-cli layout <selector>
cssprobe-cli findings <selector>
cssprobe-cli inject-css <css>
cssprobe-cli screenshot
cssprobe-cli eval <expression>

# Check session status
cssprobe-cli status

# End session (closes browser)
cssprobe-cli close
```

---

## Commands

### Session Management

```bash
cssprobe-cli open [url]           # Open browser in session mode (non-blocking)
cssprobe-cli open [url] --viewport 1280x720  # Open with custom viewport
cssprobe-cli open [url] --state ~/.cssprobe-cli/states/mysite.json  # Open with saved state
cssprobe-cli close                # Close browser session
cssprobe-cli status               # Show session status
```

### CSS Inspection

```bash
cssprobe-cli inspect <selector>   # Full CSS diagnosis
cssprobe-cli tree <selector>      # DOM tree structure
cssprobe-cli layout <selector>    # ASCII layout diagram
cssprobe-cli findings <selector>  # Only issues/warnings/errors
```

### CSS Injection

```bash
cssprobe-cli inject-css <css>     # Inject CSS into current page
```

### Browser

```bash
cssprobe-cli resize <width> <height>  # Resize browser viewport
cssprobe-cli eval <expression>    # Evaluate JavaScript (browser context)
cssprobe-cli playwright <call>    # Execute Playwright API (Node.js context)
cssprobe-cli screenshot           # Take screenshot
```

### State

```bash
cssprobe-cli state-import [file]  # Import cookies from Netscape format
```

### Configuration

```bash
cssprobe-cli config-show          # Show current config
cssprobe-cli config-set <key> <value>  # Set config value
cssprobe-cli config-list          # List all profiles
cssprobe-cli config-use <name>    # Switch active profile
cssprobe-cli config-new <name>    # Create new profile
cssprobe-cli config-path          # Show config file path
```

---

## inspect Options

```bash
cssprobe-cli inspect <selector> [options]

Arguments:
  <selector>                  CSS selector for root element

Options:
  --json                      Output structured JSON
  --brief                     Compact output: tree sketch + warnings/errors only
  --layout                    ASCII layout diagram
  --depth <n>                 DOM tree depth (default: auto, max 20)
```

---

## tree Options

```bash
cssprobe-cli tree <selector> [options]

Arguments:
  <selector>                  CSS selector for root element

Options:
  --depth <n>                 Tree depth (default: auto, max 20)
```

---

## inject-css

```bash
cssprobe-cli inject-css <css>

Arguments:
  <css>                       CSS code to inject into the current page
```

---

## state-import

Import cookies from Netscape format (browser export standard) into a Playwright state file.

```bash
# From file
cssprobe-cli state-import cookies.txt --out mystate.json

# From file with custom name (saves to ~/.cssprobe-cli/states/<name>.json)
cssprobe-cli state-import cookies.txt --name mysite

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
cssprobe-cli config-set viewport 375x812

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
--viewport      CSSPROBE_VIEWPORT
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
npm run build       # tsc + esbuild collector + daemon entry + generate help.json
npm test            # Run unit tests (45 tests)
npx tsc --noEmit    # Type check only
```

## License

MIT
