# Qiankun Plugin

`@evjs/plugin-qiankun` lets an evjs single-page application participate in a
[qiankun](https://github.com/umijs/qiankun) master/slave micro-frontend
topology. It wraps the framework-owned SPA entry, exposes qiankun lifecycles,
and bridges an asynchronous master snapshot into evjs runtime routes.

Use the plugin only when an SPA explicitly runs as a qiankun master or slave.
It does not provide an MPA integration.

## Install

```bash
npm install @evjs/plugin-qiankun qiankun
```

## Master Applications

Configure the master with `evPluginQiankunMaster()` and a resolver module:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

The resolver returns one authoritative, application-level `apps/routes`
snapshot:

```ts
// src/qiankun.master.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: "//localhost:3001/index.html",
      props: {
        locale: "en-US",
      },
    },
    {
      name: "reports",
      entry: "//localhost:3002/index.html",
    },
  ],
  routes: [
    {
      path: "/catalog",
      microApp: "catalog",
      microAppProps: {
        section: "products",
      },
    },
    {
      path: "/reports",
      microApp: "reports",
      mode: "match",
    },
    {
      path: "/legacy-catalog",
      redirect: "/catalog",
    },
  ],
  history: "browser",
  settings: {
    sandbox: true,
  },
  prefetch: ["catalog"],
}));
```

The master does not declare a fixed qiankun container or `activeRule`. Before
the framework starts rendering, the plugin resolves the snapshot and installs
an evjs runtime route overlay. Each micro-app route renders a generated React
component that owns its container and calls qiankun `loadMicroApp()`.

The route forms are:

- `{ path, microApp }` uses `"prepend"` mode by default. `/catalog` therefore
  owns `/catalog` and its descendants, and the matched prefix becomes the
  mounted slave's base.
- `{ path, microApp, mode: "match" }` matches only that route path instead of
  prepending the path to the slave base.
- `{ path, redirect }` creates a runtime redirect. The target may be an
  absolute application path or an `http(s)` URL.
- `microAppProps` adds route-specific props. Ordinary fields override fields
  from `app.props`; nested `settings` can refine qiankun load settings, and
  nested `lifeCycles` run after the matching master lifecycle hooks for that
  route.

Resolver route paths accept ordinary `:param` and `*` syntax. The bridge
normalizes them for the evjs runtime router and rejects duplicate, malformed,
or unresolved routes before rendering the master.

The master source tree only needs its own canonical shell Pages:

```text
src/
├── pages/
│   ├── layout.tsx
│   └── page.tsx           # /
└── qiankun.master.ts
```

There is intentionally no `src/pages/catalog/page.tsx` and no static
`#slave-container`. The runtime component supplied by the `/catalog` overlay
owns both concerns:

```tsx
// src/pages/layout.tsx
import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link>
        <a href="/catalog">Catalog</a>
      </nav>
      {children}
    </main>
  );
}
```

### Runtime overlay boundary

Resolver routes are runtime state, not authoring input for the canonical
CoreGraph:

- they do not create canonical Pages, Routes, or Documents;
- they do not modify `application.routes`, the BuildPlan, or deployment route
  metadata;
- they are not included in generated `src/route-types.d.ts` Page names,
  `RoutePath`, or typed navigation targets;
- they are installed through the generated application's runtime update API
  before its first render.

Keep canonical navigation type usage for canonical Pages. When a URL exists
only in a runtime site snapshot, its availability and validation belong to the
platform/runtime layer; the example above therefore uses an ordinary link for
`/catalog`.

## Slave Applications

A slave exports qiankun lifecycles while remaining independently renderable.
Configure it with `evPluginQiankunSlave()`:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

The slave declares only its own root and internal Pages:

```text
src/
├── pages/
│   ├── page.tsx             # local /
│   └── details/
│       └── page.tsx         # local /details
└── qiankun.slave.ts
```

It does not duplicate the master's `/catalog` path in its source tree. With a
default `"prepend"` master route at `/catalog`, the master passes `/catalog` as
the slave base. The slave's local `/` is then rendered at `/catalog`, and its
local `/details` is rendered at `/catalog/details`.

The slave lifecycle loads the original generated entry, projects the received
`base` and `history` through `pagesApp.updateRuntime()`, and only then calls the
entry's first `start()`. The generated Pages app defers router construction
until that runtime projection is available, so the first router is created
with the mounted base and history instead of being patched after creation.
When run outside qiankun, the same Pages remain available under their
standalone base.

If a mounted slave later receives a different base, history, or runtime route
overlay, the Pages app creates and loads a candidate router with the existing
Query client. It switches the rendered provider only after that candidate is
ready; a failed candidate leaves the active router in place. This replacement
boundary uses TanStack Router's public construction and loading APIs rather
than depending on its internal match stores.

While mounted with browser or hash history, the slave uses a scoped history
adapter. Slave `Link` and `useNavigate()` calls still update the shared browser
URL, and native back/forward events update both the host and slave routers, but
the slave does not replace the host's global `history.pushState` or
`history.replaceState` methods. The adapter is released on unmount. Memory
history remains isolated and does not write the browser URL.

Application layouts must not add their own `popstate` listener that compares
`window.location` with `useLocation()` and renders a corrective `Navigate`.
The scoped adapter is the single synchronization point, so native traversal
continues to respect Router blockers and qiankun mount/unmount ownership.
When a mounted master changes the URL programmatically without emitting
`popstate`, its route component forwards the href change through the qiankun
update lifecycle. The slave refreshes its scoped adapter only when the browser
URL and Router history differ.

The generated route types remain local to the slave source tree: they describe
`/` and `/details`, not the externally assigned `/catalog` prefix.

The optional runtime module adds lifecycle behavior; it does not replace the
framework entry:

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} preparing to mount`, {
      container: props.container,
      base: props.base,
      history: props.history,
    });
  },
  afterMount(_props, ctx) {
    console.log(`${ctx.name} mounted`);
  },
  afterUpdate(_props, ctx) {
    console.log(`${ctx.name} updated`);
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

In qiankun mode the plugin mounts into `props.container`. Outside qiankun it
automatically starts the same canonical SPA entry. It does not infer a magic
`src/main.tsx` or expose a second application entry model. Slave code must use
the supplied container; the plugin never rewrites global `document` lookup
methods to redirect selectors.

## Module References

`resolver` and `runtime` accept a string module specifier, a generated module
ref, or an object selecting a named export:

```ts
import type { GeneratedModuleRef } from "@evjs/ev/plugin";

type QiankunModuleRef =
  | string
  | GeneratedModuleRef
  | {
      module: string | GeneratedModuleRef;
      exportName?: string;
    };
```

String references read the default export:

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

Object references select named exports:

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

Path-like references are resolved from the project root before bundling.
Package specifiers are resolved from project dependencies. From another
plugin's `emitIR()` hook, pass the opaque `GeneratedModuleRef` returned
by `ctx.emit.module()` directly to `emitQiankunMasterIR()` or
`emitQiankunSlaveIR()`.

## Runtime Shape

The public master shape is:

```ts
type QiankunHistoryType = "browser" | "hash" | "memory";
type QiankunRouteMode = "prepend" | "match";
type QiankunLoadSettings = import("qiankun").AppConfiguration;
type QiankunLifeCycles = import("qiankun").LifeCycles<
  Record<string, unknown>
>;

interface QiankunApp {
  name: string;
  entry: string;
  props?: Record<string, unknown> & {
    settings?: QiankunLoadSettings;
  };
}

type QiankunRoute =
  | {
      path: string;
      microApp: string;
      mode?: QiankunRouteMode;
      microAppProps?: Record<string, unknown> & {
        settings?: QiankunLoadSettings;
        lifeCycles?: QiankunLifeCycles;
      };
    }
  | {
      path: string;
      redirect: string;
    };

interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: QiankunRoute[];
  base?: string;
  history?: QiankunHistoryType;
  settings?: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
  prefetch?: boolean | "all" | string[];
  prefetchThreshold?: number;
}
```

`base` defaults to `/`, `history` defaults to `"browser"`, and a missing
`mode` defaults to `"prepend"`. `settings` is shared by route-mounted
applications. App and route settings layer over it, and route lifecycle hooks
are composed after master lifecycle hooks. The public bridge does not add
request policy or interpret platform-specific fields.

`prefetch: "all"` prefetches every app after the master starts, while a string
array prefetches the selected app names. `prefetch: true` waits for the first
mounted app and then prefetches up to `prefetchThreshold` other apps; the
threshold defaults to `5`.

`route.microApp` strictly matches `app.name`. Higher-level integrations must
normalize external records into the canonical `{ name, entry }` shape before
returning the snapshot. Unknown fields on the master, app, or route structure
are rejected rather than ignored; extensible integration data belongs in
`props` or `microAppProps`.

The master passes the route-derived values through the slave lifecycle props:

```ts
interface QiankunLifecycleProps {
  container?: Element | string | null;
  base?: string;
  history?:
    | QiankunHistoryType
    | { type: "browser" }
    | { type: "hash" }
    | {
        type: "memory";
        initialEntries?: string[];
        initialIndex?: number;
      };
  [key: string]: unknown;
}
```

The optional slave runtime supports:

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  afterMount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
  afterUpdate?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` loads the original generated entry without starting it.
Calling it during `bootstrap()` is safe. The first `mount()` configures runtime
base/history before `start()`; subsequent remounts reuse the loaded module and
call its render path inside the current container.

`mount()` and `update()` run before the framework-owned entry work.
`afterMount()` runs only after base/history projection and entry `start()` or
`render()` complete successfully. `afterUpdate()` runs after a successful
projection commit and also runs for mounted updates that do not change the
projection. All lifecycle operations remain serialized: a queued update or
unmount waits for the preceding post lifecycle to settle. An `afterMount()`
failure participates in mount rollback; an `afterUpdate()` failure rejects that
update without rolling back the already committed projection.

## Bundling Qiankun

By default, qiankun is bundled with the application:

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

Set `externalQiankun: true` only when the runtime environment provides the
module:

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## Local Development

The plugin does not create a development proxy. Configure `dev.proxy` when a
master needs to load a slave dev server through the same origin:

```ts
// master ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 3000,
    proxy: [
      {
        context: ["/__qiankun_slave"],
        target: "http://localhost:3001",
        pathRewrite: {
          "^/__qiankun_slave": "",
        },
        changeOrigin: true,
        secure: false,
      },
    ],
  },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

Point the resolver app entry at the proxied HTML. qiankun 3 expects an HTML
entry URL rather than a `{ scripts, styles, html }` object:

```ts
const slaveBase = "/__qiankun_slave";

export default async function resolveQiankunMaster() {
  return {
    apps: [
      {
        name: "catalog",
        entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
      },
    ],
    routes: [{ path: "/catalog", microApp: "catalog" }],
    settings: { sandbox: true },
    prefetch: true,
  };
}
```

`evPluginQiankunSlave()` marks the emitted entry script and rewrites generated
root-relative JS/CSS URLs to relative URLs, so the same slave HTML can be
consumed below a proxy prefix. Keep asset proxies in `dev.proxy`, not in
`src/apis`; application request Routes should not proxy micro-frontend assets.

## Platform Composition

A higher-level integration plugin can reuse `emitQiankunMasterIR()` or
`emitQiankunSlaveIR()` from its `emitIR()` method and the matching
`createQiankun*Hooks()` helper from `setup()`. It must normalize external data
before passing a resolver or runtime module to the public bridge and compose
returned hooks with any additional lifecycle behavior it owns.

Applications install either the public master/slave factory or the higher-level
integration factory, not both. Platform-specific configuration does not belong
in Page config.

## Boundaries

`@evjs/plugin-qiankun` includes:

- master and slave framework-entry wrapping;
- resolver/runtime module loading;
- application-level `apps/routes` validation;
- runtime prepend, match, redirect, and micro-app route components;
- generated micro-app containers and qiankun loading;
- slave base/history projection before first render;
- slave lifecycle exports and standalone rendering;
- `externalQiankun` support;
- contribution and hook helpers for platform composition.

It does not include:

- external platform data protocols or identity mapping;
- platform-specific runtime, deployment, or development policy;
- automatic local development proxies;
- Page-level qiankun settings;
- canonical CoreGraph Pages, Routes, or Documents derived from resolver data;
- generated `RoutePath` entries for runtime resolver routes.
