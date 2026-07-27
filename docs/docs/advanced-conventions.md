# Advanced Convention Control

Canonical client Pages and Routes use positive `src/pages/**/page.*` anchors;
their directories determine URLs. Server request routes remain file
conventions under `src/apis`, and middleware comes from `src/middleware.ts`
plus `src/apis/**/middleware.ts`.

Use the control on this page only when the application intentionally owns its
runtime composition or is migrating from a non-conventional structure.

## Disable File Conventions

File-convention discovery has one project-wide switch:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  conventions: false,
});
```

`conventions: false` disables all framework filesystem discovery together:

- Page and client-route anchors under `src/pages`;
- server file routes under `src/apis`;
- global `src/middleware.ts` and route-scoped
  `src/apis/**/middleware.ts`.

There are no client-, server-, route-, middleware-, or facet-level disable
switches. Do not combine `conventions: false` with an explicit `routing` or
`server.routing` declaration. `server.routing: { dir }` remains available when
file conventions are enabled and only changes the server route directory.

Explicit SPA `application.routes` configuration, reachable modules marked with
`"use server";`, and modules emitted by plugin contributions are not file
conventions. They remain available when filesystem discovery is disabled.
Removed `app`, `pages`, and top-level `routes` declarations are rejected.

Manual browser bootstrap uses the standalone runtime below; it is not a second
canonical routing model.

## Programmatic Browser Apps

When the browser app owns routing itself, use the standalone client runtime
directly. This entry is owned by the application's standalone bundler; evjs
Framework config does not discover or build a magic `src/main.tsx`:

```tsx
// src/main.tsx
import {
  createApp,
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/client";

const rootRoute = createAppRootRoute({
  component: () => (
    <main>
      <Link to="/">Home</Link>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});

const app = createApp({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

This path is for applications that intentionally own their browser router and
bootstrap. It is independent from the framework Page-and-Route model.

## Programmatic Server Apps

Programmatic server apps use `@evjs/server` directly. They are runtime
primitives, not framework file-route inputs, so evjs will not scan source files
for `createRoute()` declarations.

```ts
// src/server.ts
import { createApp, createRoute } from "@evjs/server";
import { serve } from "@evjs/server/node";

const health = createRoute("/api/health", {
  GET: async () => Response.json({ ok: true }),
});

const app = createApp({
  routes: [health],
});

serve(app, { port: 3001 });
```

Do not use `server.entry` for this. It is not a framework config field. If the
server runtime is programmatic, run it as a normal Node, Fetch, Bun, Deno, or
platform entry outside server file-route discovery.
