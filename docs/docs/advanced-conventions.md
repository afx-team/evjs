# Advanced Convention Control

evjs defaults to file conventions: page routes come from `src/pages`, server
file routes come from `src/apis`, and middleware comes from `src/middleware.ts`
plus `src/apis/**/middleware.ts`. Most applications should keep those defaults.

Use the controls on this page only when the application intentionally owns its
runtime composition or is migrating from a non-conventional structure.

## Disable Framework Discovery

Turn off the conventions you no longer want evjs to discover:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: false,
  server: {
    routing: false,
    conventions: false,
  },
});
```

Use the switches independently when only one convention is being replaced:

| Config | Effect |
| --- | --- |
| `routing: false` | Stops automatic page-route discovery from `src/pages`. |
| `server.routing: false` | Stops server file-route discovery from `src/apis`. |
| `server.conventions: false` | Stops server middleware convention discovery. |
| `server.conventions.middleware: false` | Stops only `src/middleware.ts` and `src/apis/**/middleware.ts` discovery. |
| `routing.conventions.layout: false` | Stops external SPA root layout discovery. Nested route layouts remain part of SPA routing. |

If the app still needs evjs to emit a browser bundle, declare an explicit app or
explicit pages:

```ts
export default defineConfig({
  routing: false,
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },
});
```

## Programmatic Browser Apps

When the browser app owns routing itself, use the standalone client runtime
directly:

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

This path is for apps that do not want evjs to derive route modules from
`src/pages`.

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
