# Plan: Fix “/ command completion” visibility in Web UI

Date: 2026-03-02

## Context / Problem

Users expect Claude Code’s “slash command palette / completion list” to appear in the Web mirror when they type `/`.

Observed symptom:

- In the Web page, typing `/` does not show any completion list (“没有结果返回”).

Evidence:

- The completion list *does* exist in the tmux pane output when we type `/` (and/or press Tab). For example `tmux capture-pane -p` shows:
  - `User skills (~/.claude/skills, ~/.claude/commands)`
  - followed by a list of skills
  - `Esc to close`

Likely cause:

- Frontend `cleanOutput()` currently hides the last prompt line (regex matches `❯ ...`) to avoid displaying “editing-in-progress” content.
- Depending on terminal behavior, the slash palette/completion content may be rendered near the prompt line and can be hidden or appear “unchanged” after cleaning, so the UI looks like “no results”.
- Also, browser caching can keep old frontend code; a hard refresh is required after changes.

## Constraints

- No heavy terminal emulator dependency (keep current simple `<pre>` mirror).
- Avoid leaking secrets; keep output as-is but do not print config values in docs/logs.

## Success Criteria (Acceptance)

1. In the Web UI, typing `/` (sent without Enter) results in visible completion/palette content in the mirrored terminal output.
2. The terminal output updates reliably (no “filtered away” content that prevents rendering).
3. Unit tests cover the output cleaning behavior so we don’t regress.

## Design Options

1) **Minimal: stop hiding prompt line** (recommended)
- Remove/relax “hide last prompt line” behavior in output cleaning.
- Pros: minimal change, fixes visibility for interactive UI near prompt.
- Cons: Web mirror may show “in-progress input” lines.

2) Add a UI toggle “hide prompt line”
- Default off.
- Pros: preserves previous behavior for those who want it.
- Cons: more UI/state.

3) Integrate xterm.js and render escapes
- Pros: best fidelity.
- Cons: much larger scope.

## Recommended Approach

Option 1: keep the Web mirror faithful and show prompt line content.

## Implementation Plan (TDD)

### Files

- Modify: `public/client.js` (use shared cleaner; adjust behavior to not hide prompt line)
- Add: `public/terminal_cleaner.js` (export `cleanOutput` for browser + Node tests)
- Modify: `public/index.html` (load `terminal_cleaner.js` before `client.js`)
- Add: `test/terminal_cleaner.test.js`
- Modify: `package.json` (add `test` script if missing)

### Step 1 (Red): Add failing test

Add a test that asserts:

- Given a sample output containing a prompt line and slash palette lines, `cleanOutput()` keeps the palette text (and does not blank the prompt line).

Run:

```bash
node --test
```

Expected (Red):

- Fails because current `cleanOutput()` blanks the prompt line (or otherwise removes relevant content).

### Step 2 (Green): Implement minimal fix

- Move `cleanOutput()` into `public/terminal_cleaner.js`.
- Remove the “hide last prompt line” behavior (or narrow it to only remove a pure `❯` line if desired).
- Update `public/client.js` to call the shared `cleanOutput()`.

Run:

```bash
node --test
```

Expected (Green):

- Tests pass.

### Step 3 (Manual verification)

1. Restart server.
2. Hard refresh browser (`Cmd+Shift+R` / `Ctrl+F5`).
3. In the Web input:
   - Type `/` and send.
   - Verify palette list appears.

### Ship

- `git add -A && git commit -m "fix: show slash palette output in web mirror" && git push`
- If push is not configured, record the reason.

