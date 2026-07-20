```markdown
# cc-web-control Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `cc-web-control` TypeScript codebase. You'll learn how to structure files, write and organize code, follow commit message standards, and implement and run tests. While no specific framework is detected, the repository maintains clear conventions for maintainable and scalable TypeScript projects.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.
  - Example: `user_controller.ts`, `api_utils.ts`

### Import Style
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { fetchData } from './api_utils';
    ```

### Export Style
- Use **named exports** for functions, classes, and constants.
  - Example:
    ```typescript
    // In api_utils.ts
    export function fetchData() { ... }
    export const API_URL = '...';

    // In another file
    import { fetchData, API_URL } from './api_utils';
    ```

### Commit Messages
- Follow the **conventional commit** format.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average ~45 characters).
  - Example:  
    ```
    feat: add user authentication middleware
    ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature  
**Command:** `/feature-development`

1. Create a new TypeScript file using snake_case.
2. Implement the feature using named exports.
3. Use relative imports to include dependencies.
4. Write or update corresponding test files (`*.test.ts`).
5. Commit changes with a `feat:` prefix and a concise message.

### Testing
**Trigger:** When verifying code functionality  
**Command:** `/run-tests`

1. Ensure test files are named with the `.test.ts` suffix.
2. Use the project's preferred testing framework (unknown; check project docs or package.json).
3. Run tests using the appropriate command (e.g., `npm test` or `yarn test`).
4. Review test results and address any failures.

## Testing Patterns

- Test files are named with the `*.test.ts` pattern.
  - Example: `user_controller.test.ts`
- The specific testing framework is not detected; check the project documentation or dependencies for details.
- Place test files alongside the modules they test or in a dedicated `tests/` directory.

## Commands
| Command               | Purpose                                  |
|-----------------------|------------------------------------------|
| /feature-development  | Guide for adding a new feature           |
| /run-tests            | Steps to run and verify tests            |
```