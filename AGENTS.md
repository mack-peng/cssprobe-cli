# AGENTS.md

## Project

`cssprobe-cli` — Runtime CSS probe for layout/scroll/overflow/color/font inspection with session-based browser management. Entrypoint: `bin/cssprobe-cli.js` → `require('../dist/index')`.
Build: `npm run build` (= `tsc` + `esbuild` collector IIFE bundle + `esbuild` daemon entry + `tsx scripts/generate-help.ts`).
Test: `npm test` (= `tsx --test tests/*.test.ts` — Node.js built-in test runner, 170 tests).
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
│   ├── input.ts               # @file / stdin argument expansion for eval and playwright
│   ├── state-check.ts         # State file validation (cookie expiry, target domain)
│   ├── url-guard.ts           # Login-redirect detection + --expect-url matching
│   └── minimist.ts            # Arguments parser (forked from playwright-cli)
├── daemon/
│   ├── session.ts             # Session management (single session, Unix socket)
│   ├── daemon.ts              # Daemon process: browser lifecycle + command execution
│   ├── flowRunner.ts          # Flow script loader/runner (run command): dynamic import, API injection, console/pageerror capture
│   ├── expect.ts              # Assertion matchers for flow scripts
│   └── daemonEntry.ts         # Daemon entry point (spawned as child process)
├── engine/
│   ├── types.ts               # Shared types: Snapshot, TreeNode, Finding, Confidence
│   ├── collector.ts           # Browser-side: DOM traversal, computed styles, declared values
│   ├── analyzer.ts            # Node-side: pure functions, confidence model, pattern detection
│   ├── evalSerializer.ts      # Self-contained serializer for eval results (runs in-page via JSHandle.evaluate)
│   └── renderer.ts            # Markdown / JSON rendering
├── browser/
│   ├── launcher.ts            # Playwright wrapper: launch, navigate, browser discovery/doctor
│   ├── frames.ts              # Frame listing + resolution (index/name/URL substring)
│   ├── sampler.ts             # Timeline sampling + wait-stable (pure aggregation)
│   └── interactions.ts        # Interaction primitives: click/hover/type/wait-for (shared by daemon + run API)
├── scenario/
│   ├── schema.ts              # Zod schemas for JSON suites, cases and steps
│   ├── runner.ts              # Suite execution: browser per case, vars, artifacts, JUnit
│   ├── assertions.ts          # Pure assertion evaluation (paths, matchers, globals, URL)
│   └── reporters.ts           # Console summary + JUnit XML
├── config/
│   ├── config.ts              # Config loader (CLI → env → ~/.cssprobe-clirc profiles)
│   └── helpGenerator.ts       # Build-time: Zod schemas → dist/help.json
└── utils/
    ├── socketConnection.ts    # Socket communication (adapted from playwright-cli)
    └── screenshot.ts          # Screenshot data-URL → file saving (shared by CLI + flow runner)
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
- **State management**: `state-import` converts Netscape cookies; `state-save` persists the current session's cookies + localStorage after manual login. Session persists browser state until `close`.
- **Browser discovery**: `findBrowserExecutable()` scans the platform Playwright cache (macOS/Linux/Windows, `PLAYWRIGHT_BROWSERS_PATH` override), prefers the revision required by the bundled `playwright-core`, and falls back to the newest install. `doctor` reports expected vs installed revisions.
- **Error format**: `Error: <message>` → JSON mode: `{ isError: true, error: "<message>" }` → `process.exit(1)`

## Commands

### Session Management
- `open [url]` — Open browser in session mode (non-blocking)
  - `--viewport <WxH>` — Set viewport size (e.g. `--viewport 1280x720`)
  - `--state <file>` — Load saved state (cookies + localStorage)
- `close` — Close the browser session
- `status` — Show current session status (URL, title, frame count)
- `frames` — List frames: index, name, URL, main marker
- `doctor` — Diagnose browser installation vs expected Playwright revision

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
  - Returns raw string values (not JSON-quoted) for string results
  - DOM nodes / circular structures are auto-serialized (descriptors, `[Circular]`, `[Function: name]`, depth cap 6)
  - Promises are awaited; `undefined` object/array values become `null`
  - `@file` / `-` (stdin) reads long expressions from disk or stdin
  - `--frame <index|name|url-substring>` evaluates inside an iframe
- `playwright <call>` — Execute Playwright API call (Node.js context)
  - Returns `{ ok: true, value: null, note: ... }` when the call returns no value; throws a clear error message on failure
- `screenshot` — Take a screenshot
  - `--out <path>` — Output file path (default: `~/.cssprobe-cli/screenshots/<timestamp>.png`)

### Interaction
- `click <selector>` — Real mouse click (auto-scroll + actionability wait, works with custom React components)
  - `--nth <n>` — 1-based match index (default: first match; multiple matches without `--nth` fail — strict)
  - `--force` — skip actionability checks
  - `--timeout <ms>` — action timeout (default 30000)
- `hover <selector>` — Real mouse hover (`--nth` / `--force` / `--timeout` as above)
- `type <selector> <text>` — Type text
  - Default: `fill()` (replaces the value); `--sequential` for real key events (custom editors), `--clear` clears first
  - `--press <key>` — press a key after typing (e.g. `Enter`)
  - `--delay <ms>` — keystroke delay for `--sequential`
- `sample "<expr>"` — Sample an expression on an interval (`--interval`, `--duration`, `--key`, `--frame`), returning `summary` + `series`
- `wait-stable "<expr>"` — Wait until the expression stops changing (`--tolerance`, `--window`, `--timeout`, `--interval`, `--frame`)
- `wait-for` — Wait for a condition (three mutually exclusive modes); arrow-function/function predicates are invoked, bare expressions are evaluated as-is
  - `wait-for <selector>` — selector state: `--state visible|hidden|attached|detached` (default visible)
  - `wait-for --js "<predicate>"` — wait until a JS predicate is truthy
  - `wait-for --network-idle` — wait until the page is network-idle
  - `--timeout <ms>` — default 30000; timeout errors name the target
- `scenario run <file>` — Run a JSON scenario suite (fresh browser per case, assertions, artifacts, JUnit)
  - `--state <file>` — Fallback state file for cases without one
  - `--artifacts <dir>` — Artifact directory (default `~/.cssprobe-cli/scenario-runs/<suite>-<timestamp>`)
  - `--junit <file>` — Write a JUnit XML report
  - `--bail` — Stop after the first failing case
  - Steps: `goto`, `reload`, `eval`, `sample`, `waitStable`, `click`, `waitFor`, `screenshot`, `assert`
- `run <file>` — Run a multi-step flow script inside the daemon
  - Script default-exports an async function receiving the API object: `page`, `context`, `frames()`, `newPage()`, `click`, `hover`, `type`, `waitFor`, `inspect`, `screenshot`, `expect`, `log` (CJS also supported)
  - Uncaught page errors are collected in the envelope as `pageErrors[]`
  - `--timeout <ms>` — whole-script guard (default 300000, 0 = unlimited); failure exits 1 and keeps the session alive
  - `screenshot` relative paths resolve against the script's directory; logs collected and returned

### State
- `state-import [file]` — Import cookies from Netscape format
  - `--out <file>` — Output state file path (default: `~/.cssprobe-cli/states/imported.json`)
  - `--name <name>` — Custom name for the state file (e.g. `mysite` or `mysite.json`)
  - `--merge <file>` — Existing state file to merge into
- `state-save` — Save current browser session state (cookies + localStorage)
  - `--name <name>` — State file name (default: `session`)
- `state-check` — Validate a saved state file (cookie count, expiry, target domain coverage)
  - `--state <file>` — State file (default: `~/.cssprobe-cli/states/session.json`)
  - `--url <url>` — Require the cookies to cover this hostname

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
| Tests | None | 45+ unit tests (command, analyzer, output, renderer) |
| Build | Regex stripping CJS module.exports | esbuild IIFE + CJS bundle, clean build |
| Session | None (blocking commands) | Session-based daemon architecture |
