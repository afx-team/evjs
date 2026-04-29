# @evjs/build-tools

Bundler-agnostic build utilities for the **evjs** fullstack framework. Contains all core logic for server function handling, decoupled from any specific bundler.

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

This package is consumed by bundler adapters (e.g., `@evjs/bundler-utoopack`), not directly by application code.

```ts
import {
  generateServerEntry,
  transformServerFile,
  detectUseServer,
} from "@evjs/build-tools";

// Generate server entry source
const entrySource = generateServerEntry(
  { appFactory: "@evjs/server#createApp" },
  ["/path/to/api/users.server.ts"],
);

// Transform a "use server" file for client build
const clientStub = await transformServerFile(source, {
  resourcePath: "/path/to/api/users.server.ts",
  rootContext: "/path/to/project",
  isServer: false,
});
```

## Architecture

### Transform Pipeline

`transformServerFile()` parses the source with SWC, extracts exported function names via AST traversal, then delegates to the appropriate transform:

- **Client transform** — replaces function bodies with `createServerReference()` transport stubs.
- **Server transform** — keeps original source, prepends the `registerServerReference` import, and appends registration calls for each export.

### Entry Generation

`generateServerEntry()` produces a self-contained server entry that imports all discovered `"use server"` modules, creates a Hono app via `createApp()`, and optionally invokes a runtime adapter (e.g., `serve`) for self-starting bundles.

### Code Emitter

All generated code passes through `emitCode()` — a SWC `parseSync → printSync` roundtrip that validates syntax at build time and produces consistently formatted output.

### RUNTIME Constants

All runtime identifiers (module paths, function names, property names) are centralized in a single `RUNTIME` constant — no hardcoded strings in templates:

```ts
RUNTIME.serverModule          // "@evjs/server/register"
RUNTIME.appModule             // "@evjs/server"
RUNTIME.clientTransportModule // "@evjs/client/transport"
RUNTIME.registerServerReference // "registerServerReference"
RUNTIME.createServerReference   // "createServerReference"
RUNTIME.callServer            // "callServer"
```

## Bundler Adapter Pattern

```
@evjs/build-tools (pure functions)     Bundler Adapters
────────────────────────────────       ─────────────────
• generateServerEntry()                @evjs/bundler-utoopack
• transformServerFile()                  → EvBundlerPlugin
• detectUseServer()                      → server-fn-loader
• makeFnId()
• parseModuleRef()                     (future: @evjs/vite-plugin)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/transforms/index.ts` | `transformServerFile` — main transform |
| `src/transforms/client/` | Client-side SWC transform (stub generation) |
| `src/transforms/server/` | Server-side SWC transform (registration) |
| `src/entry.ts` | `generateServerEntry` |
| `src/utils.ts` | `makeFnId`, `parseModuleRef`, `detectUseServer` |
| `src/types.ts` | Type definitions |
