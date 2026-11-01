# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A runnable, concept-first cookbook for the [Agent2Agent (A2A) Protocol](https://a2a-protocol.org/latest/).
Every recipe is a deterministic, self-contained pair of A2A agents (no LLM, API key, or network
dependency). The A2A v1.0 specification is the source of truth whenever a recipe and the current
protocol appear to differ. See [README.md](README.md) for the full recipe index and protocol mental
model (Agent Card, Message/Part/Task/Artifact, task lifecycle, cross-agent correlation), and
[AGENTS.md](AGENTS.md) for contributor-facing style/PR conventions — both are worth reading in full
before making non-trivial changes.

Use Node.js 24 or newer, as specified in [.nvmrc](.nvmrc). Native ES modules only: no TypeScript,
no bundler/transpiler, no generated code.

## Commands

```bash
npm ci                    # install exact locked deps (use npm install only when changing deps)
npm run cookbook -- 01    # run one recipe (01-11) end to end (server + client + console output)
npm run cookbook -- all   # run every recipe in sequence
npm test                  # run the full Vitest suite once
npm run test:watch        # rerun affected tests on change
npm run format            # rewrite files with Prettier
npm run format:check      # verify formatting (CI-equivalent check)
```

Run a single recipe's tests directly with Vitest, e.g.:

```bash
npx vitest run recipes/06-delegating-agent/index.test.js
npx vitest run -t "publishes a marked fallback"   # filter by test name across the suite
```

## Architecture

### The `src/lib` boundary

- [src/lib/a2a-hapi.js](src/lib/a2a-hapi.js) is the _only_ framework-specific code in the repo. It
  adapts Hapi's request/response cycle to the SDK's framework-neutral `JsonRpcTransportHandler`:
  Agent Card route, the JSON-RPC POST route, content-type/parse-error mapping, and SSE streaming
  (via a `PassThrough` pumped from the handler's async iterator). It intentionally does not know
  about tasks, events, or push notifications — `DefaultRequestHandler` (from `@a2a-js/sdk/server`)
  owns all of that.
- [src/lib/create-server.js](src/lib/create-server.js) wires an `AgentExecutor` + `AgentCard` into a
  `DefaultRequestHandler` and a Hapi server, always binding to an ephemeral port (`port: 0`) unless
  overridden. `startServer`/`stopServers` are the shared lifecycle helpers every recipe and test uses
  to bring servers up and tear them down cleanly.
- [src/lib/a2a-builders.js](src/lib/a2a-builders.js) has the constructors recipes use to build
  Messages, Parts, Agent Cards, and task snapshots, plus `publishTask`/`publishStatus`/
  `publishArtifact` helpers for emitting events from an executor's event bus.
- [src/lib/validation.js](src/lib/validation.js) (`withMessageValidation`) wraps a request handler in
  a `Proxy` that validates an inbound message _before_ it reaches the executor, so malformed input
  surfaces as a protocol `RequestMalformedError` rather than a failed Task — executor failures and
  input-validation failures are deliberately different error paths.
- [src/lib/auth.js](src/lib/auth.js) is a single 401 error type used by recipes that gate requests on
  authentication.

### The recipe contract

Each `recipes/NN-topic/` directory is independent and has exactly three files: `index.js`,
`index.test.js`, and `README.md`. Every `index.js` exports `createServer()` (and often a second
downstream-agent factory), `runClient()`, and `runDemo()`. `runDemo()` is what
[scripts/run-recipe.js](scripts/run-recipe.js) calls for both `npm run cookbook -- NN` and `-- all`;
it must start its own server(s), run the client interaction, print a one-line summary, and stop
every server it started (`finally { await stopServers(...) }`).

Executors follow the `AgentExecutor` shape (`execute(requestContext, eventBus)` /
`cancelTask()`) from `@a2a-js/sdk/server`. A recipe that delegates to another agent (06, 07) is
simultaneously an A2A server _and_ an A2A client — it holds its own `ClientFactory`-created client
to a downstream URL and tracks parent→child correlation itself (`{ agentUrl, contextId, taskId }`),
since `contextId`/`taskId` are only meaningful within the agent that issued them.

### Wire vs. SDK representation

In SDK/JS memory a text Part is `{ content: { $case: 'text', value: 'hello' } }`; on the JSON-RPC
wire it is simply `{ "text": "hello" }`. `a2a-builders.js` and `firstPart()` exist specifically to
keep this translation out of every recipe; don't hand-construct Parts inline in recipe code.

### Testing

Tests are integration tests: they start real Hapi listeners on ephemeral ports via the official
`@a2a-js/sdk/client`, not mocks. [vitest.config.js](vitest.config.js) forces
`sequence.concurrent: false` — tests in this repo are written assuming sequential execution, so don't
parallelize the suite. Always register server cleanup in `afterEach`/`finally` (see any
`index.test.js` for the `const servers = []; afterEach(() => stopServers(...servers.splice(0)))`
pattern) to avoid leaked listeners between tests.
