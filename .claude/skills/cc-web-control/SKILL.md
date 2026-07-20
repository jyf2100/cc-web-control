```markdown
# cc-web-control Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `cc-web-control` JavaScript codebase. It covers file organization, code style, commit message conventions, and testing approaches. By following these guidelines, contributors can ensure consistency and maintainability across the project.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.
  - Example:  
    ```
    user_controller.js
    data_utils.ts
    ```

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```js
    import { fetchData } from './data_utils';
    ```

### Export Style
- Use **named exports** for functions, constants, and classes.
  - Example:
    ```js
    // In data_utils.js
    export function fetchData() { ... }
    export const DATA_LIMIT = 100;
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use prefixes like `chore` and `feat`.
- Keep commit message length around 47 characters.
  - Example:
    ```
    feat: add user authentication middleware
    chore: update dependencies to latest versions
    ```

## Workflows

### Creating a New Feature
**Trigger:** When adding new functionality  
**Command:** `/new-feature`

1. Create a new file using snake_case naming.
2. Implement the feature using named exports.
3. Import any dependencies using relative paths.
4. Write corresponding tests in a `.test.ts` file.
5. Commit changes using the `feat:` prefix.
   - Example: `feat: implement user login endpoint`

### Refactoring or Maintenance
**Trigger:** When updating dependencies or refactoring code  
**Command:** `/chore`

1. Make necessary code or dependency updates.
2. Ensure all imports/exports follow conventions.
3. Run tests to confirm stability.
4. Commit changes using the `chore:` prefix.
   - Example: `chore: refactor data fetching logic`

### Writing and Running Tests
**Trigger:** When validating code correctness  
**Command:** `/test`

1. Create or update test files with the `.test.ts` extension.
2. Write tests for all new or changed functionality.
3. Run the test suite using the project's test runner.
4. Ensure all tests pass before merging.

## Testing Patterns

- Test files use the `*.test.ts` naming pattern.
- The specific testing framework is not detected; use standard JavaScript/TypeScript testing practices.
- Place tests alongside or near the code they validate.
- Example test file:
  ```ts
  // data_utils.test.ts
  import { fetchData } from './data_utils';

  test('fetchData returns expected result', () => {
    expect(fetchData()).toBeDefined();
  });
  ```

## Commands
| Command        | Purpose                                   |
|----------------|-------------------------------------------|
| /new-feature   | Start a new feature implementation        |
| /chore         | Perform maintenance or refactoring tasks  |
| /test          | Run or write tests                        |
```