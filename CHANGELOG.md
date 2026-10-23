# Changelog

## [Unreleased]

### Added
- `frames` command and `--frame <index|name|url-substring>` on `eval` / `inspect` / `tree` / `layout` / `findings` / `inject-css`
- `sample "<expr>"` (interval timeline + summary) and `wait-stable "<expr>"` (tolerance + stable window)
- `doctor` command: platform-aware browser cache discovery, expected vs installed Playwright revisions and install hint
- `state-check` command: cookie expiry and target-domain coverage for saved state files
- `open --expect-url <regex>` and `open --fail-on-login` guards
- Flow API: `context`, `frames()`, `newPage()`, `expect` matchers; `pageErrors` in the result envelope

### Changed
- `eval` / `playwright` accept `@file` and `-` (stdin)
- `eval` awaits promise results and preserves `undefined` object/array fields as `null`
- `status` now reports the current URL, title and frame count
- Browser discovery supports macOS, Linux and Windows cache roots and prefers the revision expected by `playwright-core`

All notable changes are documented on the [GitHub Releases](https://github.com/mack-peng/cssprobe-cli/releases) page.

## [0.3.0] - 2026-09-16

### Added
- MCP server (`cssprobe-cli mcp`, stdio): 10 tools — open / inspect / tree / layout / findings / eval / screenshot / inject_css / close / status
- `mcp-install` / `mcp-uninstall`: auto-configure MCP clients (Claude Code, Cursor, Codex CLI, opencode, Gemini CLI, Hermes)
- `mcpName` (`io.github.mack-peng/cssprobe-cli`) for the official MCP Registry
- README MCP section; `llms.txt` MCP pointer

### Changed
- Session commands (open/close/status/inspect/…) now share one implementation between CLI and MCP (`src/cli/session-ops.ts`); behavior unchanged

## [0.2.26] - 2026-09-16

### Added
- npm / stars badges, star CTA and `llms.txt` for agent discovery
- Cross-link to companion tool `cssgraph`

See [releases](https://github.com/mack-peng/cssprobe-cli/releases) for the complete history.
