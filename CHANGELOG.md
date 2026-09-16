# Changelog

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
