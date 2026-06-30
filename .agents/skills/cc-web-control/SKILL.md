```markdown
# cc-web-control Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill outlines the core development patterns, coding conventions, and workflows for contributing to the `cc-web-control` JavaScript codebase. The repository is structured for clarity and maintainability, with a strong focus on modular pure functions, UI features, accessibility, and robust testing. No specific framework is used, and the project emphasizes conventional commits, clear documentation, and test-driven development.

## Coding Conventions

- **File Naming:**  
  Use `snake_case` for all file names.  
  _Example:_  
  ```
  claude_session.cjs
  projects_view.js
  tokens.css
  ```

- **Import Style:**  
  Always use relative imports.  
  _Example:_  
  ```js
  import { getSession } from './claude_session.cjs';
  ```

- **Export Style:**  
  Use named exports for all modules.  
  _Example:_  
  ```js
  // claude_session.cjs
  function getSession() { ... }
  function setSession() { ... }
  export { getSession, setSession };
  ```

- **Commit Messages:**  
  Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes: `feat`, `docs`, `refactor`, `style`, `fix`, `test`.  
  _Example:_  
  ```
  feat: add project switching logic to projects_view
  fix: correct session timeout bug in claude_session
  ```

## Workflows

### Add Pure Function with Tests
**Trigger:** When introducing a new pure function (utility or rendering logic) and ensuring it is tested.  
**Command:** `/add-pure-function`

1. Implement the pure function in a `.cjs` file (e.g., `claude_session.cjs`, `public/projectsView.cjs`).
2. Create or update a corresponding test file in `test/` (e.g., `test/claude_session.test.cjs`).
3. Use named exports for your function.
4. Ensure all logic is covered by unit tests.

_Example:_
```js
// public/switch_sheet.cjs
function switchSheet(sheetId) { ... }
export { switchSheet };
```
```js
// test/switch_sheet.test.cjs
import { switchSheet } from '../public/switch_sheet.cjs';
test('switchSheet switches correctly', () => { ... });
```

---

### Feature or UI Implementation with Tests
**Trigger:** When adding a new feature or UI component, ensuring it is covered by tests.  
**Command:** `/add-feature-ui`

1. Implement or update feature logic in `public/*.js` or `public/*.cjs`.
2. Update or add related HTML in `public/*.html`.
3. Update or add related CSS in `public/*.css`.
4. Add or update corresponding test files in `test/*.test.cjs`.

_Example:_
```js
// public/new_feature.cjs
function enableFeature() { ... }
export { enableFeature };
```
```html
<!-- public/new_feature.html -->
<button id="enable-feature">Enable</button>
```
```css
/* public/new_feature.css */
#enable-feature { ... }
```
```js
// test/new_feature.test.cjs
import { enableFeature } from '../public/new_feature.cjs';
test('enableFeature activates feature', () => { ... });
```

---

### Design Spec and Implementation Plan Documentation
**Trigger:** When documenting a new feature, redesign, or implementation plan.  
**Command:** `/add-spec-docs`

1. Create or update a spec file in `docs/superpowers/specs/*.md`.
2. Create or update a plan file in `docs/superpowers/plans/*.md`.
3. Follow markdown formatting for clarity.

_Example:_
```
docs/superpowers/specs/new_feature.md
docs/superpowers/plans/new_feature_plan.md
```

---

### Token CSS Update with Tests
**Trigger:** When adding or refactoring CSS tokens (variables) and verifying them with tests.  
**Command:** `/update-css-tokens`

1. Update or add tokens in `public/tokens.css`.
2. Update or add related CSS in `public/style.css` or other CSS files.
3. Add or update corresponding test files in `test/tokens.test.cjs`.

_Example:_
```css
/* public/tokens.css */
:root {
  --primary-color: #0055ff;
}
```
```css
/* public/style.css */
body { color: var(--primary-color); }
```
```js
// test/tokens.test.cjs
test('primary color token is defined', () => { ... });
```

---

### Accessibility and WCAG Fix with Test Assertions
**Trigger:** When improving accessibility (a11y) or WCAG compliance, with corresponding test assertions.  
**Command:** `/fix-a11y`

1. Update relevant CSS/JS/HTML for accessibility or WCAG improvements.
2. Add or update test assertions in `test/*.test.cjs` to verify a11y or WCAG compliance.

_Example:_
```html
<!-- public/example.html -->
<button aria-label="Close" id="close-btn">×</button>
```
```js
// test/example.test.cjs
test('close button has aria-label', () => { ... });
```

## Testing Patterns

- **Test Files:**  
  Located in the `test/` directory, named as `*.test.cjs`.
- **Test Coverage:**  
  Every pure function, feature, CSS token, and accessibility fix should have corresponding tests.
- **Framework:**  
  Not explicitly specified; use standard Node.js or your preferred test runner.
- **Example Test:**
  ```js
  // test/claude_session.test.cjs
  import { getSession } from '../public/claude_session.cjs';
  test('getSession returns valid session', () => {
    expect(getSession()).toBeDefined();
  });
  ```

## Commands

| Command             | Purpose                                                        |
|---------------------|----------------------------------------------------------------|
| /add-pure-function  | Add a new pure function with corresponding unit tests          |
| /add-feature-ui     | Implement a new feature or UI component with tests             |
| /add-spec-docs      | Add or update design specs and implementation plan docs        |
| /update-css-tokens  | Update or add CSS tokens and verify with tests                 |
| /fix-a11y           | Improve accessibility or WCAG compliance and add test checks   |
```
