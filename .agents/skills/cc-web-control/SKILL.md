```markdown
# cc-web-control Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill guides you through the development patterns and conventions used in the `cc-web-control` TypeScript codebase. You'll learn about file organization, code style, commit message standards, and testing patterns to ensure consistency and maintainability in your contributions.

## Coding Conventions

### File Naming
- Use **kebab-case** for all file names.
  - Example:  
    ```
    user-profile.ts
    data-fetcher.test.ts
    ```

### Import Style
- Use **relative imports** for referencing modules within the codebase.
  - Example:
    ```typescript
    import { fetchData } from './data-fetcher';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In user-profile.ts
    export function getUserProfile(id: string) { ... }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average ~72 characters).
  - Example:
    ```
    feat: add user profile fetch functionality
    ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature to the codebase  
**Command:** `/feature-development`

1. Create a new branch for your feature.
2. Implement the feature using TypeScript, following kebab-case file naming.
3. Use relative imports and named exports.
4. Write or update tests in files matching `*.test.*`.
5. Commit changes with a `feat:` prefix and a concise message.
6. Open a pull request for review.

### Writing Tests
**Trigger:** When adding or updating tests  
**Command:** `/write-tests`

1. Create or update test files with the pattern `*.test.*` (e.g., `data-fetcher.test.ts`).
2. Write tests for your modules/functions.
3. Run the test suite (testing framework is unknown; check project scripts).
4. Ensure all tests pass before committing.

## Testing Patterns

- Test files are named using the pattern `*.test.*` (e.g., `example.test.ts`).
- The specific testing framework is not detected; refer to project documentation or scripts for running tests.
- Place tests alongside or near the modules they cover.

  ```typescript
  // data-fetcher.test.ts
  import { fetchData } from './data-fetcher';

  describe('fetchData', () => {
    it('should return expected data', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command              | Purpose                                  |
|----------------------|------------------------------------------|
| /feature-development | Start the feature development workflow   |
| /write-tests         | Start the test writing workflow          |
```
