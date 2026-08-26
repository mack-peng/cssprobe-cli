# AGENTS.md

## Project

`cssprobe-cli` — Runtime CSS probe for layout/scroll/overflow/color/font inspection with session-based browser management. Entrypoint: `bin/cssprobe-cli.js` → `require('../dist/index')`.
Build: `npm run build` (= `tsc` + `esbuild` collector IIFE bundle + `esbuild` daemon entry + `tsx scripts/generate-help.ts`).
Test: `npm test` (= `tsx --test tests/*.test.ts` — Node.js built-in test runner, 58 tests).
Dependencies: `playwright-core`, `zod`. Dev: `typescript`, `@types/node`, `tsx`, `esbuild`.

## Architecture

```
src/
├── index.ts                   # export { program } from './cli/program'
├── cli/
│   ├── program.ts             # Entry: minimist parse → session command dispatch
│   ├── commands.ts            # Command definitions — all Zod schemas
│   ├── command.ts             # declareCommand(), parseCommand() (Zod validation)
│   ├── output.ts              # TextOutput / JsonOutput strategy pattern
│   └── minimist.ts            # Arguments parser (forked from playwright-cli)
├── daemon/
│   ├── session.ts             # Session management (single session, Unix socket)
│   ├── daemon.ts              # Daemon process: browser lifecycle + command execution
│   └── daemonEntry.ts         # Daemon entry point (spawned as child process)
├── engine/
│   ├── types.ts               # Shared types: Snapshot, TreeNode, Finding, Confidence
│   ├── collector.ts           # Browser-side: DOM traversal, computed styles, declared values
│   ├── analyzer.ts            # Node-side: pure functions, confidence model, pattern detection
│   └── renderer.ts            # Markdown / JSON rendering
├── browser/
│   └── launcher.ts            # Playwright wrapper: launch, navigate, inject collector
├── config/
│   ├── config.ts              # Config loader (CLI → env → ~/.cssprobe-clirc profiles)
│   └── helpGenerator.ts       # Build-time: Zod schemas → dist/help.json
└── utils/
    └── socketConnection.ts    # Socket communication (adapted from playwright-cli)
```

## Key Patterns

- **Session-based architecture**: Inspired by playwright-cli. `open` starts a daemon process, subsequent commands connect via Unix socket. Single session (default) mode.
- **Daemon process**: Long-running background process that manages the browser and executes commands. Communicates via Unix domain socket.
- **Three-layer engine**: `collector.ts` (browser, esbuild IIFE) → `analyzer.ts` (Node, pure functions) → `renderer.ts` (Markdown/JSON). Collector only gathers facts; analyzer does inference with confidence; renderer formats output.
- **Collector bundling**: `collector.ts` is bundled by esbuild as an IIFE (`format: 'iife', globalName: '__cssprobe_cli'`). The launcher injects it via `page.addScriptTag({ content })`, then calls `window.__cssprobe_cli.collect(cfg)`.
- **Confidence model**: Every `Finding` carries `confidence: 'DEFINITE' | 'INDEFINITE' | 'UNVERIFIABLE'`. Computed values = DEFINITE. Percent declarations = INDEFINITE. Missing/blocked declarations = UNVERIFIABLE.
- **Command definition**: `declareCommand({ name, category, description, args?, options? })` — purely declarative, no execution logic.
- **Command dispatch**: `minimist` parse → `parseCommand()` Zod validate → session command execution via daemon socket.
- **Output strategy**: `Output` interface → `TextOutput` (Markdown for inspect, tables for lists) / `JsonOutput` (machine-readable JSON).
- **Config priority**: CLI flags → env vars → `~/.cssprobe-clirc` profiles. Switch with `-p <profile>`.
- **State management**: `state-import` converts Netscape cookies. Session persists browser state until `close`.
- **Browser discovery**: `findBrowserExecutable()` scans `~/Library/Caches/ms-playwright/chromium-*` for existing Chrome installations.
- **Error format**: `Error: <message>` → JSON mode: `{ isError: true, error: "<message>" }` → `process.exit(1)`

## Commands

### Session Management
- `open [url]` — Open browser in session mode (non-blocking)
  - `--viewport <WxH>` — Set viewport size (e.g. `--viewport 1280x720`)
  - `--state <file>` — Load saved state (cookies + localStorage)
- `close` — Close the browser session
- `status` — Show current session status

### CSS Inspection
- `inspect <selector>` — Inspect runtime CSS of a page element
- `tree <selector>` — Show DOM tree structure
- `layout <selector>` — Show ASCII layout diagram
- `findings <selector>` — Show only issues/warnings/errors

### CSS Injection
- `inject-css <css>` — Inject CSS into the current page

### Browser
- `resize <width> <height>` — Resize browser viewport
- `eval <expression>` — Evaluate JavaScript (browser context)
- `playwright <call>` — Execute Playwright API call (Node.js context)
- `screenshot` — Take a screenshot

### State
- `state-import [file]` — Import cookies from Netscape format
  - `--out <file>` — Output state file path (default: `~/.cssprobe-cli/states/imported.json`)
  - `--name <name>` — Custom name for the state file (e.g. `mysite` or `mysite.json`)
  - `--merge <file>` — Existing state file to merge into

### Config
- `config-show` / `config-set` / `config-list` / `config-use` / `config-new` / `config-path`

### Skills
- `skill-install` / `skill-uninstall`

## Adding a Command

1. Add `declareCommand({...})` in `src/cli/commands.ts` following the existing pattern
2. Append to `commandsArray` at the bottom of the file
3. Add handler in `src/cli/program.ts` (switch case or dedicated function)
4. Run `npm run build` to regenerate `help.json` and recompile
5. Run `npm test` to verify

## Build Pipeline

```
npm run build
├── 1. tsc                    # Compile TS → dist/ (includes .d.ts)
├── 2. esbuild collector.ts   # Bundle browser-side code → dist/collector-bundle.js (IIFE)
└── 3. tsx generate-help.ts   # Zod schemas → dist/help.json
```

The collector bundle is a self-contained IIFE that exposes `window.__cssprobe_cli.collect(cfg)`. It runs entirely in the browser context — no Node imports.

## Session Mode

cssprobe-cli uses a session-based architecture inspired by playwright-cli:

```bash
# Open browser (starts daemon, non-blocking)
cssprobe-cli open https://example.com

# User operates manually in the browser...

# Run CSS diagnosis
cssprobe-cli inspect .sidebar --json
cssprobe-cli tree .content --depth 3
cssprobe-cli layout .header

# Inject CSS to test changes
cssprobe-cli inject-css ".sidebar { background: red; }"

# Close browser (stops daemon)
cssprobe-cli close
```

### How It Works

1. `open` spawns a daemon process that manages the browser
2. Daemon listens on a Unix socket at `~/Library/Caches/cssprobe-cli/daemon/<hash>/default.sock`
3. Subsequent commands connect to the socket and send commands
4. Daemon executes commands using Playwright's browser API
5. `close` stops the daemon and closes the browser

## What Makes This Different from dom-report

| | dom-report (old) | cssprobe-cli (new) |
|---|---|---|
| Architecture | Browser-side template string (collect + analyze + render mixed) | Three-layer: collector (IIFE) → analyzer (pure) → renderer |
| Dead code | collector.ts 459 lines never imported | Single implementation, no dead code |
| Confidence | None — all findings treated equally | DEFINITE / INDEFINITE / UNVERIFIABLE per finding |
| Output | Single markdown string | Markdown (default) / JSON (--json) |
| Config | `window.__DOM_REPORT_CFG` global + eval two-step | CLI flags → env → rc file, one command |
| ROOT_SELECTOR | Manual or eval probe | `--auto-root` auto-detection |
| Tests | None | 45 unit tests (command, analyzer, output, renderer) |
| Build | Regex stripping CJS module.exports | esbuild IIFE + CJS bundle, clean build |
| Session | None (blocking commands) | Session-based daemon architecture |
