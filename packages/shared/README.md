# @evjs/shared

> Shared utility types, errors, and constants for the **evjs** fullstack framework.

## Features

- **Protocol Schemas** — Shared types for the server function wire format.
- **Unified Error Handling** — `ServerError` and `ServerFunctionError` types for consistent error propagation.
- **Config Definitions** — Types and default values for `ev.config.ts`.
- **Framework Discovery** — Utils for resolving project root and discovered manifests.

## Install

```bash
npm install @evjs/shared
```

## Structure

- **Config**: `EvConfig`, `ResolvedEvConfig`, and `defineConfig()`.
- **Errors**: `ServerError`, `ServerFunctionError`.
- **Constants**: `CONFIG_DEFAULTS`, `PROTOCOL_VERSION`.
- **Discovery**: `resolveProjectRoot()`, `loadManifest()`.

## Core Logic

This package contains shared logic and types used by both the client-side (`@evjs/client`) and server-side (`@evjs/server`) runtimes.

```ts
import { ServerError } from "@evjs/shared";

// Throwing structured errors
throw new ServerError("USER_NOT_FOUND", "The requested user does not exist", {
  userId: "123",
});
```

The error then flows seamlessly through the transport layer to the client.

## License

MIT
