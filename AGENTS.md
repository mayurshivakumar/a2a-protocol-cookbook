# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js 24+ cookbook for the Agent2Agent (A2A) Protocol. Shared Hapi, authentication, validation, and A2A construction helpers live in `src/lib/`. Runnable examples are under `recipes/NN-topic/`; each recipe contains `index.js`, a colocated `index.test.js`, and a focused `README.md`. `scripts/run-recipe.js` is the command-line recipe launcher. Root configuration includes `vitest.config.js` and Prettier settings.

Keep protocol-independent utilities in `src/lib/`. Keep scenario-specific servers, clients, and fixtures inside their recipe. New recipes should follow the numbered directory pattern and export `createServer()`, `runClient()`, and `runDemo()` where applicable.

## Build, Test, and Development Commands

- `npm ci` installs the exact locked dependencies; use `npm install` when intentionally changing them.
- `npm run cookbook -- 01` runs one recipe (`01` through `11`).
- `npm run cookbook -- all` executes the complete cookbook sequence.
- `npm test` runs the Vitest suite once.
- `npm run test:watch` reruns affected tests during development.
- `npm run format:check` verifies formatting; `npm run format` rewrites files.

There is no compilation step: the project uses native ES modules and runs source files directly.

## Coding Style & Naming Conventions

Use JavaScript ES modules, `async`/`await`, and named exports. Prettier is authoritative: two-space indentation, single quotes, no semicolons, trailing ES5 commas, and a 100-character print width. Use `camelCase` for variables/functions, `PascalCase` for classes, and descriptive kebab-case recipe directories. Preserve the deterministic, API-key-free character of examples.

## Testing Guidelines

Vitest tests are named `*.test.js` and colocated with the code they exercise. Integration tests may start live Hapi servers on ephemeral ports; always stop them in `afterEach`/`finally` to prevent leaked listeners. Cover both successful protocol flows and relevant wire errors, lifecycle transitions, authentication failures, or degradation paths. Run `npm test` and `npm run cookbook -- all` before submitting.

## Commit & Pull Request Guidelines

The repository currently has no commit history, so no local convention is established. Use short, imperative, scoped subjects, optionally Conventional Commits (for example, `feat(recipe-12): add capability negotiation`). Keep commits focused. Pull requests should explain the protocol concept and behavior changed, identify affected recipes, link related issues/specification sections, and list verification commands. Include logs or screenshots only when they clarify observable output; update recipe and root documentation when behavior changes.
