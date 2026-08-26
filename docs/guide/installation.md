# Installation Guide for LLM Agents

You are an AI agent (opencode, Claude Code, Codex, Cursor, etc.). This guide is written for you. Do not make the human read it.

## Quick Prompt (for humans to copy-paste)

If a human pasted this to you, follow the instructions below:

> Install and configure `cssprobe-cli` using the guide at `docs/guide/installation.md`. Then run `cssprobe-cli inspect <url> <selector>` to analyze the CSS layout of any page.

---

## What You're Installing

`cssprobe-cli` is a CLI that lets you (the agent) inspect the runtime CSS of any web page — layout, scroll behavior, overflow, colors, backgrounds, fonts — all from the command line. It launches a real browser, captures computed styles and DOM structure, and produces a structured report with confidence levels.

Humans should not type these commands. You should.

---

## Step 1: Install the Package

```bash
npm install -g cssprobe-cli
```

Or run without installing (slower but zero setup):

```bash
npx cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body
```

Verify:

```bash
which cssprobe-cli && cssprobe-cli --version
```

If `command not found`, your Node.js global bin isn't on `PATH`:

```bash
export PATH="$(npm root -g)/../bin:$PATH"
```

---

## Step 2: Install Browser

cssprobe-cli uses Playwright to launch a real browser. Install Chromium:

```bash
npx playwright install chromium
```

Verify:

```bash
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body --json | head -5
```

JSON output = it works. `Browser not installed` = run the install command above.

---

## Step 3: Basic Usage

### Inspect a Public Page

```bash
# With explicit selector
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body

# Auto-detect root element
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout

# Local HTML file
cssprobe-cli inspect ./test.html ".container"
```

### JSON Output (for programmatic consumption)

```bash
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body --json
cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body --json | jq '.findings[] | {id, confidence, message}'
```

---

## Step 4: Login-Protected Pages

Many pages require authentication. cssprobe-cli supports three approaches:

### Option A: Import Cookies from Browser Export

1. Export cookies from your browser in Netscape format (e.g., using "EditThisCookie" extension or browser dev tools)
2. Import into cssprobe-cli:

```bash
cssprobe-cli state-import cookies.txt --out ~/.cssprobe-cli/states/mysite.json
```

3. Use the state file:

```bash
cssprobe-cli inspect https://mysite.com/page ".target" --state ~/.cssprobe-cli/states/mysite.json
```

### Option B: Interactive Login

```bash
cssprobe-cli open https://mysite.com --headed
# Browser opens -> complete login manually -> continue inspection

cssprobe-cli inspect .target
```

### Option C: Merge Cookies into Existing State

```bash
cssprobe-cli state-import new-cookies.txt --merge existing-state.json --out updated.json
```

### Option D: Open with Saved State

```bash
# Import cookies first
cssprobe-cli state-import cookies.txt --name mysite

# Open browser with saved state
cssprobe-cli open https://mysite.com --state ~/.cssprobe-cli/states/mysite.json

# Then inspect
cssprobe-cli inspect .target
```

---

## Step 5: Session Mode

For inspecting multiple areas of the same page without re-opening the browser:

```bash
cssprobe-cli open https://mysite.com --state ~/.cssprobe-cli/states/mysite.json

# Run multiple inspections
cssprobe-cli tree .dialog-A
cssprobe-cli layout .sidebar-B
cssprobe-cli findings .modal
cssprobe-cli inspect .dialog-A --json

# Close when done
cssprobe-cli close
```

---

## Step 6: Understand the Output

### Markdown Report (default)

```
# cssprobe-cli report
viewport: 1280×720 | root: .container | nodes: 18
confidence: DEFINITE 8 | INDEFINITE 0 | UNVERIFIABLE 1

## Ancestor chain (root→html)
...

## DOM tree (6 levels deep)
...

## Findings
- ⚠ all heights are % or missing [UNVERIFIABLE] @ div.container
- ✔ div.modal-body scrollable (scrollHeight 2040 > clientHeight 576) [DEFINITE]
- ⚠ div.content overflows parent [DEFINITE]
```

### Confidence Levels

| Level | Meaning |
|-------|---------|
| **DEFINITE** | Based on computed values (facts) or accessible declared values |
| **INDEFINITE** | Declared value uses `%` — resolves at runtime |
| **UNVERIFIABLE** | Declared value missing or from blocked cross-origin stylesheet |

### JSON Output

```json
{
  "meta": { "rootSelector": ".container", "viewport": {...}, "nodeCount": 18 },
  "snapshot": { "ancestors": [...], "tree": {...} },
  "findings": [
    { "id": "anchor-missing", "level": "warning", "confidence": "UNVERIFIABLE", "message": "..." },
    { "id": "scrollable", "level": "info", "confidence": "DEFINITE", "message": "..." }
  ],
  "summary": { "total": 9, "confidence": { "DEFINITE": 8, "INDEFINITE": 0, "UNVERIFIABLE": 1 } }
}
```

---

## Common Failures Agents Face

**"Browser not installed"**
→ Run `npx playwright install chromium`.

**"File not found"**
→ Check the URL or file path. Local files need to exist on disk.

**"Could not auto-detect a root element"**
→ Provide an explicit selector: `cssprobe-cli inspect <url> <selector>`

**"No valid cookies found"**
→ Cookie file must be Netscape format (tab-separated: `domain\tflag\tpath\tsecure\texpires\tname\tvalue`).

**"collector bundle not found"**
→ Run `npm run build` in the cssprobe-cli project directory.

**Cross-origin stylesheet blocked**
→ This is expected. Declared values from blocked sheets are marked UNVERIFIABLE. Computed values from getComputedStyle() are still accurate.

**Page needs login**
→ Use `cssprobe-cli open <url> --headed` for interactive login, or `cssprobe-cli state-import cookies.txt --name mysite` to import cookies.

---

## Environment Variables (Skip Config)

```bash
export CSSPROBE_BROWSER=chromium
export CSSPROBE_DEPTH=6
export CSSPROBE_HEADED=true
export CSSPROBE_VIEWPORT=375x812
export CSSPROBE_PROFILE=default
```

Priority (highest to lowest):
1. CLI flags: `--browser`, `--depth`, `--headed`, `--viewport`
2. Environment variables: `CSSPROBE_BROWSER`, `CSSPROBE_DEPTH`, `CSSPROBE_HEADED`, `CSSPROBE_VIEWPORT`
3. Config file: `~/.cssprobe-clirc`

---

## The One-Liner

For agents that trust copy-paste:

```bash
npm install -g cssprobe-cli && npx playwright install chromium && cssprobe-cli inspect https://getbootstrap.com/docs/5.3/examples/checkout body
```

---

## Done

You now have programmatic control over CSS inspection. Analyze layout, detect overflow, check scroll behavior, verify anchors — all from a terminal an agent can automate.

If something breaks: check that Chromium is installed first. 90% of issues are missing browsers. The other 10% are wrong selectors.
