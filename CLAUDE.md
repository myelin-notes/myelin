# Conventions
- This repo uses `yarn` not npm.
- Avoid `// ------ CATEGORY -------` style comments in the code. 3+ of these in a single file may indicate that the file should be split up further — but use critical thinking, sometimes keeping them together is still the right call.
- We are using react 19 compiler. Avoid useMemo and useCallback when the react compiler is able to handle it.