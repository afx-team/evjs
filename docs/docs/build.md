# Build

## Command

```bash
ev build
```

`ev build` reads `ev.config.ts`, discovers configured page and server
conventions, runs the active bundler, and writes production artifacts.

Use `ev inspect` when you want a quick preflight without writing `dist` or
`.ev`:

```bash
ev inspect
ev inspect --json
```

`ev inspect` reports the resolved routing mode, discovered page routes, server
functions, server routes, render metadata, generated route type location, and
diagnostics. Errors make the command exit non-zero.

Use `ev prepare` when you want the generated framework IR but not a full build:

```bash
ev prepare
```

`ev prepare` writes `.ev/` with the discovered app graph, final build plan,
generated entry facades, plugin generated artifacts, framework slots, and
import edges. It does not run the bundler and does not write `dist`.

## Output

By default evjs separates public browser files from server files:

```txt
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   ├── [chunk].[hash].js
│   └── manifest.json
├── server/
│   ├── main.[hash].js
│   └── manifest.json
└── build-output.json
```

Use `output.client` and `output.server` when your host expects public files in a
different directory:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

That writes browser assets directly under `dist` and server artifacts under
`dist-server`:

```txt
dist/
├── index.html
├── main.[hash].js
├── [chunk].[hash].js
└── manifest.json
dist-server/
├── main.[hash].js
└── manifest.json
```

Generated HTML embeds the `ClientRuntime` needed by the browser bootstrap.
`client/manifest.json` is lightweight deployment metadata: SPA manifests keep
top-level public assets, while MPA manifests keep assets on each routing page.
`server/manifest.json` preserves the server entry filename plus the server route
projection. Runtime-only `FrameworkRuntime` data is injected into dev and
deployment bootstraps instead of being emitted as JSON. `build-output.json` is
canonical deployment metadata. Application code should not import or edit
deployment metadata files.

## Page Output

`routing.mode` controls how page files under `src/pages` are emitted:

| Mode | Output |
| --- | --- |
| `spa` | One browser app shell for the discovered page tree. |
| `mpa` | One independent HTML document and client entry per discovered CSR page. |

Page modules can opt into server rendering or static rendering with literal
exports:

```tsx
export const render = "ssr";
export const hydrate = "load";

export default function ProductPage() {
  return <main>Product</main>;
}
```

For build-time static generation, use `render = "ssg"` on a statically
addressable page. `ev build` renders that page into an emitted HTML document
such as `dist/client/report.html`, and deployment metadata represents it as a
`static-page` route. For server pages with partial prerendering, use
`render = "ssr"` with `prerender = { partial: true }`.

```tsx
import { Suspense } from "react";

export const render = "ssr";
export const hydrate = "none";
export const prerender = { partial: true } as const;

export default function CampaignPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <CampaignContent />
    </Suspense>
  );
}
```

Partial prerendering is experimental. Treat React `Suspense` plus the
`prerender` export as the public authoring API; do not depend on generated
internal region IDs or manifest details.

RSC pages use SSR plus `rsc = true` and require `server.rsc`:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    rsc: true,
  },
});
```

```tsx
export const render = "ssr";
export const rsc = true;
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

RSC pages cannot also use partial prerendering. Split those concerns into
separate routes for now.

## Server Functions And Routes

Files with `"use server";` are included when they are imported by reachable app,
page, server route, or middleware code. The build makes them callable from the
browser through the server runtime.

Server file routes are discovered from `src/apis` by default:

```ts
// src/apis/api/health.ts
export const GET = async () => Response.json({ ok: true });
```

## Build Checks

When a build fails, check the inputs users control first:

- `ev.config.ts` exports `defineConfig(...)` and uses public config keys.
- HTML templates contain the configured mount element, usually
  `<div id="app"></div>`.
- `src/pages` routes follow the file conventions: `index.*` directory roots,
  `$param` dynamic segments, `$...splat` SPA catch-alls, and URL-safe static
  segments.
- Page modules default-export a React component.
- Page rendering metadata uses literal values.
- `"use server"` modules start with the directive and export named functions.
- `src/apis` route modules export uppercase HTTP methods such as `GET` or
  `POST`.

## Key Points

- `ev build` is the production build command.
- `ev inspect` is the preflight command when you need diagnostics without
  writing generated output.
- Browser files and server files are split by default.
- Use `output.client` / `output.server` to match a deployment platform's folder
  layout.
- Do not import generated manifest files from application code.
