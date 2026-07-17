```markdown
# cc-web-control Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `cc-web-control` TypeScript codebase. It covers file organization, code style, commit practices, and testing approaches to help you contribute effectively and maintain consistency.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.
  - Example: `user_controller.ts`, `api_utils.ts`

### Import Style
- Use **relative imports** for referencing modules.
  - Example:
    ```typescript
    import { fetchData } from './api_utils';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In api_utils.ts
    export function fetchData() { /* ... */ }

    // In another file
    import { fetchData } from './api_utils';
    ```

### Commit Messages
- Follow the **Conventional Commits** standard.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average 41 characters).
  - Example:
    ```
    feat: add user authentication middleware
    ```

## Workflows

### Feature Development
**Trigger:** When starting a new feature or module  
**Command:** `/feature-development`

1. Create a new file using snake_case naming.
2. Implement your feature using TypeScript.
3. Use relative imports for dependencies.
4. Export functions or constants using named exports.
5. Write a corresponding test file named `your_feature.test.ts`.
6. Commit your changes using a conventional commit message with the `feat` prefix.

### Testing
**Trigger:** When writing or running tests  
**Command:** `/run-tests`

1. Create a test file with the `.test.ts` suffix (e.g., `api_utils.test.ts`).
2. Write test cases for your module or function.
3. Run your tests using your preferred TypeScript testing framework (framework not specified; check project documentation or use a standard runner like `ts-node` or `jest` if configured).

## Testing Patterns

- Test files are named with the `.test.ts` suffix and placed alongside the modules they test.
- The specific testing framework is not defined; follow standard TypeScript testing practices.
- Example test file:
  ```typescript
  // api_utils.test.ts
  import { fetchData } from './api_utils';

  describe('fetchData', () => {
    it('should return expected data', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command               | Purpose                                 |
|-----------------------|-----------------------------------------|
| /feature-development  | Start a new feature using conventions   |
| /run-tests            | Run all test files in the codebase      |
```
