# @evjs/build-tools

Bundler-agnostic build utilities for the **ev** framework. This package contains all the core logic for server function handling, decoupled from any specific bundler.

## Features

- **`generateServerEntry(config, modules)`**: Generates server entry source code from discovered modules and app configuration.
- **`transformServerFile(source, options)`**: SWC-based transformation for `"use server"` files — produces client stubs or server registrations.
- **`detectUseServer(source)`**: Checks whether a file starts with the `"use server"` directive.
- **`makeFnId(rootContext, resourcePath, exportName)`**: Derives a stable SHA-256 function ID.
- **`parseModuleRef(ref)`**: Parses `"module#exportName"` reference strings.

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

## Architecture

```
@evjs/build-tools (pure functions)     Bundler Adapters
────────────────────────────────       ─────────────────
• generateServerEntry()                @evjs/webpack-plugin
• transformServerFile()                  → EvWebpackPlugin
• detectUseServer()                      → server-fn-loader
• makeFnId()
• parseModuleRef()                     (future: @evjs/vite-plugin)
```
