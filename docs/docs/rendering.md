# Rendering

Choose how each page reaches the browser with adjacent `page.config.ts`.
Pages without rendering configuration use client-side rendering (CSR).

## Choose a mode

Start with the simplest mode that meets the page's needs:

| Mode | Choose it when | Server required at request time? | Browser JavaScript |
| --- | --- | --- | --- |
| CSR | Content is app-like, user-specific, or loaded after navigation | No | Renders the page |
| SSR | The first response needs page HTML or request data | Yes | Optional hydration |
| SSG | The same HTML can be created during the build | No | Optional hydration |
| PPR | A stable shell can be built ahead while regions resolve later | Yes | No page-level hydration |
| RSC | The page is rendered through React Server Components | Yes | Client components only |

Rendering is independent from route discovery: the page stays in the same
directory and keeps the same URL.

## Client-side rendering

CSR is the default. You can omit `page.config.ts` entirely or state the choice
explicitly:

```ts title="src/pages/dashboard/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "csr",
});
```

Do not set `hydrate` for CSR. The browser creates the React tree rather than
hydrating server-created markup.

Use CSR when the page does not need meaningful HTML before JavaScript runs.

## Server-side rendering

SSR renders the page for each document request:

```ts title="src/pages/account/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "load",
});
```

`hydrate: "load"` makes the server-rendered page interactive after the client
bundle loads. Use `hydrate: "none"` for HTML that should remain non-interactive
at page level.

SSR requires a server-capable deployment target.

## Static generation

SSG creates page HTML during `ev build`:

```ts title="src/pages/about/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssg",
  hydrate: "none",
});
```

Use `hydrate: "load"` when the generated page becomes interactive in the
browser. SSG defaults to no hydration when `hydrate` is omitted.

Static output can be served without a request-time renderer. In SPA mode,
static pages are emitted at their semantic paths: `/report` becomes
`report/index.html`.

## Partial prerendering

PPR builds a reusable page shell and resolves dynamic regions at request time:

```ts title="src/pages/feed/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: { partial: true },
});
```

PPR uses SSR delivery, requires a compatible bundler and a server-capable
deployment target, and cannot be combined with RSC on the same page.

## React Server Components

Enable RSC for a page with `rsc: true`:

```ts title="src/pages/catalog/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  rsc: true,
});
```

RSC pages use request-time server rendering. They require a compatible bundler
and a server-capable deployment target. Page-level hydration remains disabled;
interactive client components manage their own browser behavior.

## Supported combinations

| `render` | `hydrate` | Additional field | Result |
| --- | --- | --- | --- |
| omitted or `"csr"` | omitted | — | Browser-rendered page |
| `"ssr"` | `"load"` or omitted | — | Request-time HTML, then hydration |
| `"ssr"` | `"none"` | — | Request-time HTML without page hydration |
| `"ssg"` | `"load"` | — | Build-time HTML, then hydration |
| `"ssg"` | `"none"` or omitted | — | Build-time HTML without page hydration |
| `"ssr"` | `"none"` or omitted | `prerender: { partial: true }` | PPR |
| `"ssr"` | `"none"` or omitted | `rsc: true` | RSC |

evjs reports unsupported combinations during `ev inspect` and `ev build`.

## Add page metadata

Rendering settings can share the same file with static page metadata:

```ts title="src/pages/pricing/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Pricing",
  meta: {
    description: "Compare plans and features.",
    viewport: "width=device-width, initial-scale=1",
  },
  render: "ssg",
  hydrate: "load",
});
```

`meta` creates `<meta name="..." content="...">` entries. It does not provide
a general head-element API. A page-specific HTML template can provide other
static tags when needed.

## SPA and MPA behavior

SPA and MPA use the same page rendering fields, with different document
ownership:

- SPA normally has a shared application document. Static SSG pages also emit
  HTML at their route paths.
- MPA creates one document for every static page route. A colocated
  `index.html` can customize that page's template.
- MPA does not support dynamic page paths, splats, or browser-router-only
  boundaries.

Rendering a page on the server does not automatically make an MPA application,
and choosing MPA does not automatically select SSR.

## Verify the result

Run these commands before deployment:

```bash
ev inspect
ev build
```

`ev inspect` reports the resolved rendering choice and capability errors.
After `ev build`, check `dist/client` for browser assets and static HTML, and
`dist/server` when request-time rendering is required.

Continue with [Build](./build) or compare hosting options in
[Deployment](./deploy).
