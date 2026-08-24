# AGENTS.md

## Project

`cssprobe-cli` — Runtime CSS probe for layout/scroll/overflow/color/font inspection. Entrypoint: `bin/cssprobe-cli.js` → `require('../dist/index')`.
Build: `npm run build` (= `tsc` + `esbuild` collector IIFE bundle + `tsx scripts/generate-help.ts`).
Test: `npm test` (= `tsx --test tests/*.test.ts` — Node.js built-in test runner, 26 tests).
Dependencies: `playwright-core`, `zod`. Dev: `typescript`, `@types/node`, `tsx`, `esbuild`.

## Architecture

```
src/
├── index.ts                   # export { program } from './cli/program'
├── cli/
│   ├── program.ts             # Entry: minimist parse → dispatch → engine call
│   ├── commands.ts            # 10 command definitions — all Zod schemas
│   ├── command.ts             # declareCommand(), parseCommand() (Zod validation)
│   ├── output.ts              # TextOutput / JsonOutput strategy pattern
│   └── minimist.ts            # Arguments parser (forked from playwright-cli)
├── engine/
│   ├── types.ts               # Shared types: Snapshot, TreeNode, Finding, Confidence
│   ├── collector.ts           # Browser-side: DOM traversal, computed styles, declared values
│   ├── analyzer.ts            # Node-side: pure functions, confidence model, pattern detection
│   └── renderer.ts            # Markdown / JSON rendering
├── browser/
│   └── launcher.ts            # Playwright wrapper: launch, navigate, inject collector, state loading
└── config/
    ├── config.ts              # Config loader (CLI → env → ~/.cssprobe-clirc profiles)
    └── helpGenerator.ts       # Build-time: Zod schemas → dist/help.json
```

## Key Patterns

- **Three-layer engine**: `collector.ts` (browser, esbuild IIFE) → `analyzer.ts` (Node, pure functions) → `renderer.ts` (Markdown/JSON). Collector only gathers facts; analyzer does inference with confidence; renderer formats output.
- **Collector bundling**: `collector.ts` is bundled by esbuild as an IIFE (`format: 'iife', globalName: '__cssprobe-cli'`). The launcher injects it via `page.addScriptTag({ content })`, then calls `window.__cssprobe-cli.collect(cfg)`.
- **Confidence model**: Every `Finding` carries `confidence: 'DEFINITE' | 'INDEFINITE' | 'UNVERIFIABLE'`. Computed values = DEFINITE. Percent declarations = INDEFINITE. Missing/blocked declarations = UNVERIFIABLE.
- **Command definition**: `declareCommand({ name, category, description, args?, options? })` — purely declarative, no execution logic.
- **Command dispatch**: `minimist` parse → `parseCommand()` Zod validate → `switch(commandName)` → handler function.
- **Output strategy**: `Output` interface → `TextOutput` (Markdown for inspect, tables for lists) / `JsonOutput` (machine-readable JSON).
- **Config priority**: CLI flags → env vars → `~/.cssprobe-clirc` profiles. Switch with `-p <profile>`.
- **State management**: `--state <file>` loads Playwright storage state (cookies + localStorage). `state-import` converts Netscape cookies. `login` does interactive login + save state.
- **Browser discovery**: `findBrowserExecutable()` scans `~/Library/Caches/ms-playwright/chromium-*` for existing Chrome installations.
- **Error format**: `Error: <message>` → JSON mode: `{ isError: true, error: "<message>" }` → `process.exit(1)`

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

The collector bundle is a self-contained IIFE that exposes `window.__cssprobe-cli.collect(cfg)`. It runs entirely in the browser context — no Node imports.

## What Makes This Different from dom-report

| | dom-report (old) | cssprobe-cli (new) |
|---|---|---|
| Architecture | Browser-side template string (collect + analyze + render mixed) | Three-layer: collector (IIFE) → analyzer (pure) → renderer |
| Dead code | collector.ts 459 lines never imported | Single implementation, no dead code |
| Confidence | None — all findings treated equally | DEFINITE / INDEFINITE / UNVERIFIABLE per finding |
| Output | Single markdown string | Markdown (default) / JSON (--json) |
| Config | `window.__DOM_REPORT_CFG` global + eval two-step | CLI flags → env → rc file, one command |
| ROOT_SELECTOR | Manual or eval probe | `--auto-root` auto-detection |
| Tests | None | 26 unit tests (command, analyzer, output) |
| Build | Regex stripping CJS module.exports | esbuild IIFE bundle, clean build |
| Auth | None | `--state`, `login`, `state-import` |
