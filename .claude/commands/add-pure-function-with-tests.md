---
name: add-pure-function-with-tests
description: Workflow command scaffold for add-pure-function-with-tests in cc-web-control.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-pure-function-with-tests

Use this workflow when working on **add-pure-function-with-tests** in `cc-web-control`.

## Goal

Adds a new pure function to the codebase along with corresponding unit tests.

## Common Files

- `*.cjs`
- `test/*.test.cjs`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement the pure function in a .cjs file (e.g., claude_session.cjs, public/projectsView.cjs, public/switch_sheet.cjs)
- Create or update a corresponding test file in test/ (e.g., test/claude_session.test.cjs, test/projectsView.test.cjs, test/switch_sheet.test.cjs)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.