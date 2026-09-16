export const SERVER_INSTRUCTIONS = `cssprobe-cli — runtime CSS probe for AI agents.

It opens a real browser session and answers questions that static code cannot:
why an element overflows, where its scroll chain goes, what it actually renders
as. Findings carry a confidence level (DEFINITE / INDEFINITE / UNVERIFIABLE) —
report UNVERIFIABLE items as "needs verification", never as conclusions.

Typical workflow:
1. cssprobe_open — start a session (optionally with a URL; headed: true when a
   login is needed, then ask the user to sign in manually).
2. cssprobe_inspect / cssprobe_layout / cssprobe_findings — query a selector.
   inspect returns DOM tree + layout + findings; layout is the ASCII diagram;
   findings lists only issues/warnings/errors.
3. cssprobe_eval / cssprobe_inject_css — probe or patch the live page.
4. cssprobe_screenshot — capture the current page to a PNG file.
5. cssprobe_close — stop the session when done.

Notes:
- One shared "default" session: open once, run many queries, close at the end.
- Any command without an open session returns guidance instead of failing.
- Pair with cssgraph (static CSS knowledge graph MCP) for the full picture:
  cssgraph finds where styles come from, cssprobe shows what they render as.
- Prefer narrow selectors (".card > .title") to keep output small.`;
