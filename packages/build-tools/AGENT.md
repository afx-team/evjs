# @evjs/build-tools — Agent Guide

> AI-agent reference for the `@evjs/build-tools` package. This is an internal package — application developers don't use it directly.

## Overview

Bundler-agnostic build utilities for the evjs server function pipeline. Consumed by `@evjs/webpack-plugin` and other bundler adapters.

## API

### `transformServerFile(source, options): string`

Transforms a `"use server"` file for either client or server target.

**Client transform:**
```
Input:  "use server"; export async function getUsers() { return db.find(); }
Output: import { __ev_call } from "@evjs/runtime";
        export const getUsers = __ev_call("hash:getUsers", "hash");
```

**Server transform:**
```
Input:  "use server"; export async function getUsers() { return db.find(); }
Output: import { registerServerFn } from "@evjs/runtime/server";
        export async function getUsers() { return db.find(); }
        registerServerFn("hash:getUsers", getUsers);
```

### `generateServerEntry(config, modules): string`

Generates server entry source code that imports all discovered server modules and bootstraps the Hono app.

```ts
generateServerEntry(
  {
    appFactory: "@evjs/runtime/server#createApp",
    runner: "@evjs/runtime/server#serve",
    middleware: ["./middleware/auth#default"],
  },
  ["./api/users.server", "./api/posts.server"]
);
```

### `detectUseServer(source): boolean`

Returns `true` if source starts with `"use server";` directive.

### `makeFnId(rootContext, resourcePath, exportName): string`

Derives a stable SHA-256 function ID from the project root, file path, and export name.

### `makeReadableFnId(rootContext, resourcePath, exportName): string`

Derives a human-readable function ID: `"relativePath#exportName"` (e.g. `"src/api/hello.server#hello"`). Used in FaaS mode for debugging.

### `generateFaasEntry(config, modules): string`

Generates a standalone FaaS server entry that exports `{ fetch }` for FaaS platforms (Cloudflare Workers, Deno Deploy, etc.).

### `parseModuleRef(ref): { module, export }`

Parses `"module#exportName"` strings into module and export components.

## Types

```ts
interface TransformOptions {
  resourcePath: string;   // absolute path to source file
  rootContext: string;     // project root directory
  isServer: boolean;       // true = server build, false = client
  readableIds?: boolean;   // use human-readable IDs (FaaS mode)
  onServerFn?: (fnId: string, meta: { moduleId: string; export: string }) => void;
}

interface ServerEntryConfig {
  appFactory?: string;     // default: "@evjs/runtime/server#createApp"
  runner?: string;         // e.g. "@evjs/runtime/server#serve"
  middleware?: string[];   // middleware module refs
}
```

## Constants (`RUNTIME`)

Identifiers used in generated code — bundler adapters should use these:

```ts
RUNTIME.serverModule          // "@evjs/runtime/server"
RUNTIME.clientTransportModule // "@evjs/runtime/client/transport"
RUNTIME.registerServerFn      // "registerServerFn"
RUNTIME.clientCall            // "__ev_call"
RUNTIME.fnIdProp              // "evId"
```

## Key Files

| File | Purpose |
|------|---------|
| `src/transforms/index.ts` | `transformServerFile` — main transform |
| `src/transforms/client/` | Client-side SWC transform (stub generation) |
| `src/transforms/server/` | Server-side SWC transform (registration) |
| `src/transforms/utils.ts` | AST utilities |
| `src/entry.ts` | `generateServerEntry`, `generateFaasEntry` |
| `src/codegen.ts` | `detectUseServer` |
| `src/utils.ts` | `makeFnId`, `makeReadableFnId`, `parseModuleRef` |
| `src/types.ts` | Type definitions |

## Writing a New Bundler Adapter

To integrate with a new bundler (e.g., Vite, Rollup):

1. Use `detectUseServer(source)` to identify server function files
2. Call `transformServerFile(source, { isServer, ... })` in your loader/plugin
3. Collect server functions via `onServerFn` callback
4. Call `generateServerEntry(config, collectedModules)` to create the server entry
5. Emit the server entry as a virtual module

See `@evjs/webpack-plugin` for reference implementation.
