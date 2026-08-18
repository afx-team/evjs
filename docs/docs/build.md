# Build

Inspect the application before creating production output:

```bash
ev inspect
ev build
```

## Commands

| Command | Use it for | Writes output? |
| --- | --- | --- |
| `ev inspect` | Validate config, routes, rendering, plugins, and bundler capabilities | No |
| `ev inspect --json` | Feed the same application summary to tooling | No |
| `ev prepare` | Generate framework entries and declarations without bundling | `.ev` and generated declarations |
| `ev build` | Create production browser/server output | `.ev`, declarations, and `dist` |

Only one `dev`, `prepare`, or `build` operation can change output for the same
project at a time.

## Inspect first

`ev inspect` reports the public application shape:

- SPA or MPA mode;
- discovered pages and their URL patterns;
- HTML documents and rendering choices;
- server functions and API routes;
- installed plugins and page settings;
- selected bundler and missing capabilities;
- diagnostics with source locations.

Treat a non-zero exit as a configuration or application-structure error. In
CI, run inspect before the production build when you want faster, focused
feedback.

## Production output

The default layout separates browser files from server files:

```text
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── ...
├── server/                          # present when server work is required
│   └── ...
└── deployment-metadata.json
```

- `dist/client` contains HTML, JavaScript, CSS, and public assets.
- `dist/server` contains the server bundle for server functions, API routes,
  SSR, PPR, or RSC.
- `deployment-metadata.json` is consumed by deployment tooling. Application
  code should not import or edit it.

Treat `.ev`, `dist`, `src/route-types.d.ts`, and `src/plugin-types.d.ts` as
generated output.

## Change output directories

Use `output.client` and `output.server` when a host expects another layout:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist/public",
    server: "dist/runtime",
  },
});
```

Both paths must remain separate, non-nested descendants of `dist` and use
portable `/` separators. They cannot contain empty, `.` or `..` segments.

Set `output.crossOriginLoading` to `false`, `"anonymous"`, or
`"use-credentials"` to control the `crossorigin` attribute on generated asset
tags and dynamic chunk loading.

## SPA output

A normal CSR SPA emits one application document and browser route assets.
Static SSG pages additionally emit HTML at their route paths:

```text
/           -> dist/client/index.html
/report     -> dist/client/report/index.html
```

Request-time SSR, PPR, and RSC routes use the server output. They are not
independent static HTML files.

## MPA output

MPA creates one HTML document for each static page route:

```text
/           -> dist/client/index.html
/report     -> dist/client/report.html
/foo/bar    -> dist/client/foo/bar.html
```

A colocated `index.html` supplies a page-specific template. Dynamic `$param`
and `$...splat` paths are rejected because one dynamic pattern cannot name one
build-time document.

SSR MPA pages still require a server-capable target. CSR and SSG MPA pages can
be deployed statically when they use no other server capabilities.

## Browser compatibility

Production compatibility is opt-in:

```ts title="ev.config.ts"
export default defineConfig({
  target: {
    android: 6,
    ios: 10,
  },
});
```

This lowers production client syntax and includes core-js for ECMAScript
built-ins. Development remains optimized for the active bundler. To load
core-js from a separately hosted UMD file, configure `polyfill.coreJs` with an
absolute HTTP(S) URL.

See [Configuration](./config#browser-compatibility) for validation and scope.

## Rendering requirements

Rendering choices can require different build and deployment capabilities:

| Page behavior | Browser output | Server output | Static hosting alone? |
| --- | --- | --- | --- |
| CSR | Client entry | No | Yes |
| SSR | Optional hydration entry | Renderer | No |
| SSG | Generated HTML, optional hydration | Build-time only | Yes, unless another feature needs a server |
| PPR | Shell/client assets as applicable | Runtime renderer | No |
| RSC | Client component assets | Runtime renderer | No |

Run `ev inspect` after selecting PPR or RSC to confirm the selected bundler
supports the page. The complete authoring matrix is in
[Rendering](./rendering).

## Pre-build checklist

Before shipping, verify:

- `routing.mode` is intentional;
- every public page uses exactly one `page.*` variant and default-exports a
  component;
- route directories use valid static, `$param`, terminal `$...splat`, or
  `(group)` segments;
- MPA pages use static paths and no router-only boundaries;
- every `page.config.*` exports supported static data;
- server-function modules begin with `"use server";` and export named
  callables;
- every public API route uses one `api.*` anchor with uppercase HTTP methods;
- page routes, redirects, API routes, and framework endpoints do not conflict;
- the HTML template contains the configured mount element;
- the deployment target supports every server and rendering capability.

Then run the repository or application checks appropriate to your project,
followed by:

```bash
ev inspect
ev build
```

## Next step

Choose a target and adapter in [Deployment](./deploy). If the build output is
unexpected, compare the resolved application in `ev inspect` with the source
tree before inspecting generated files.
