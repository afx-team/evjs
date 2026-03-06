# @evjs/build-tools

Bundler-agnostic build utilities for the **ev** framework. Contains all core logic for server function handling, decoupled from any specific bundler.

## Installation

```bash
npm install @evjs/build-tools
```

## Exports

| Export | Description |
|--------|-------------|
| `generateServerEntry(config, modules)` | Generate server entry source from discovered modules |
| `transformServerFile(source, options)` | SWC-based transform for `"use server"` files |
| `detectUseServer(source)` | Check if a file starts with the `"use server"` directive |
| `makeFnId(root, path, name)` | Derive a stable SHA-256 function ID |
| `parseModuleRef(ref)` | Parse `"module#export"` reference strings |
| `ServerEntryConfig` | Config type for server entry generation |
| `TransformOptions` | Options type for file transformation |

## Usage

This package is consumed by bundler adapters (e.g., `@evjs/webpack-plugin`), not directly by application code.

```ts
import {
  generateServerEntry,
  transformServerFile,
  detectUseServer,
} from "@evjs/build-tools";

// Generate server entry source
const entrySource = generateServerEntry(
  { appFactory: "@evjs/runtime/server#createApp" },
  ["/path/to/api/users.server.ts"],
);

// Transform a "use server" file for client build
const clientStub = await transformServerFile(source, {
  resourcePath: "/path/to/api/users.server.ts",
  rootContext: "/path/to/project",
  isServer: false,
});
```

## Source Layout

```
src/
  index.ts                Barrel re-exports
  codegen.ts              SWC parseSync→printSync code emitter (emitCode)
  entry.ts                Server entry generation
  types.ts                Shared types + RUNTIME identifier constants
  utils.ts                detectUseServer, makeFnId, parseModuleRef
  transforms/
    index.ts              Orchestrator: parse → extract → delegate
    utils.ts              extractExportNames (AST traversal)
    client/
      index.ts            buildClientOutput (__ev_call stubs)
    server/
      index.ts            buildServerOutput (registerServerFn + manifest)
```

### RUNTIME Constants

All runtime identifiers in generated code are centralized in `types.ts` — no hardcoded strings in templates:

```ts
import { RUNTIME } from "./types.js";
// RUNTIME.serverModule        → "@evjs/runtime/server"
// RUNTIME.clientTransportModule → "@evjs/runtime/client/transport"
// RUNTIME.registerServerFn    → "registerServerFn"
// RUNTIME.clientCall          → "__ev_call"
// RUNTIME.fnIdProp            → "evId"
```

### Code Generation

`emitCode()` from `codegen.ts` validates and formats generated source via a SWC `parseSync → printSync` roundtrip — catches syntax errors at build time and produces consistent output.

## Bundler Adapter Pattern

```
@evjs/build-tools (pure functions)     Bundler Adapters
────────────────────────────────       ─────────────────
• generateServerEntry()                @evjs/webpack-plugin
• transformServerFile()                  → EvWebpackPlugin
• detectUseServer()                      → server-fn-loader
• makeFnId()
• parseModuleRef()                     (future: @evjs/vite-plugin)
```
