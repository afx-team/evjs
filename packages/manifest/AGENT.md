# @evjs/manifest

Shared manifest schema types for the ev framework build system.

## Types

- `Manifest` — Unified manifest interface (`dist/manifest.json`) with `server` and `client` sections.
- `ServerManifestSection` — Server section: `{ entry: string; fns: Record<string, ServerFnEntry>; rsc?: ... }`.
- `ClientManifestSection` — Client section: `{ js: string[]; css: string[]; pages?: ... }`.
- `ServerFnEntry` — `{ moduleId: string; export: string }` — server function metadata.
- `RscEntry` — Reserved for future (React Server Components).
- `PageEntry` — Reserved for future (MPA per-page assets).
- `ServerManifest` — Deprecated alias for backward compat.
- `ClientManifest` — Deprecated alias for backward compat.

## Manifest (v1)
```json
{
  "version": 1,
  "server": {
    "entry": "main.a1b2c3d4.js",
    "fns": {
      "<fnId>": { "moduleId": "f9b6...", "export": "getUsers" }
    }
  }
}
```

## Usage
Produced by `@evjs/webpack-plugin`, consumed by `@evjs/runtime` and adapters:
```ts
import type { Manifest, ServerFnEntry } from "@evjs/manifest";
```
