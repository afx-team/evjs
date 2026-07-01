# Qiankun Plugin

`@evjs/plugin-qiankun` lets an evjs single-page application participate in a
[qiankun](https://github.com/umijs/qiankun) master/slave micro-frontend
topology. It is intentionally a protocol bridge: it wraps the configured app
entry, wires qiankun lifecycles, and loads user-provided resolver/runtime
modules. It does not own application routing, platform site metadata, deployment
fields, or local development proxy conventions.

Use the plugin when an SPA application explicitly runs as a qiankun master or
slave. The default path is evjs file-convention SPA routing through
`src/pages`. Do not enable it for MPA pages.

## Install

```bash
npm install @evjs/plugin-qiankun qiankun
```

## Master Applications

A master application registers child applications and starts qiankun. Configure
the plugin with `evPluginQiankunMaster()` and provide a resolver module:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

The resolver returns the qiankun application list, optional route mapping, and
qiankun framework options as a flat object:

```ts
// src/qiankun.master.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: "//localhost:3001",
      container: "#slave-container",
    },
  ],
  routes: [
    {
      path: "/catalog",
      microApp: "catalog",
    },
  ],
  sandbox: true,
  prefetch: true,
}));
```

`routes` is an evjs plugin convenience, not a router replacement. When an app
does not already define `activeRule`, the plugin derives it from matching
`routes[].microApp` and registers the app through qiankun's `registerMicroApps`
API. Keep the qiankun container mounted by the shell while the master is
running; route-local containers should be handled by a higher-level plugin that
turns routes into micro-app components.

```tsx
// src/layout/index.tsx
import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/catalog">Catalog</Link>
      </nav>
      {children}
      <section id="slave-container" />
    </main>
  );
}
```

```tsx
// src/pages/catalog.tsx
export default function CatalogPage() {
  return <h1>Catalog workspace</h1>;
}
```

## Slave Applications

A slave application exports qiankun lifecycles for the master while still
rendering by itself outside qiankun. Configure the plugin with
`evPluginQiankunSlave()`:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

The application remains an ordinary file-convention SPA:

```tsx
// src/pages/index.tsx
export default function CatalogPage() {
  return <h1>Catalog</h1>;
}
```

When the master activates the slave at a non-root path, add the matching page
route in the slave as well, for example `src/pages/catalog.tsx`.

Use the runtime module only for lifecycle extensions. It can be empty when the
application does not need extra lifecycle behavior:

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} mounted`, props.container);
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

In qiankun mode the plugin mounts into `props.container`; outside qiankun it
automatically renders standalone. For manually bootstrapped `app.entry` SPAs,
the runtime scopes `document.querySelector(mount)` and
`document.getElementById()` mount lookups to the qiankun container so common
single-SPA entries can keep using `#app`.

## Module References

`resolver` and `runtime` accept either a string module specifier or an object
with a named export:

```ts
type QiankunModuleRef =
  | string
  | {
      module: string;
      exportName?: string;
    };
```

String references read the default export:

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

Object references are useful for generated modules or named exports:

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

Path-like references are resolved from the project root before bundling, so the
generated entry wrapper does not preserve unresolved `./src/...` specifiers.
Package specifiers are resolved from the project as normal dependencies.

## Runtime Shape

The master resolver returns:

```ts
interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: Array<{ path: string; microApp: string }>;
  appNameKeyAlias?: string;
  sandbox?: boolean | Record<string, unknown>;
  prefetch?: boolean | string[] | ((apps: QiankunApp[]) => unknown);
  singular?: boolean | ((app: QiankunApp) => Promise<boolean>);
  fetch?: typeof globalThis.fetch;
  [key: string]: unknown;
}
```

`apps`, `routes`, and qiankun options live at the same level. There is no
`framework` nesting. Any fields other than `apps`, `routes`, and
`appNameKeyAlias` are passed to `qiankun.start()`.

The slave runtime can extend these lifecycles:

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` loads the original app entry. The built-in slave lifecycle
calls it during `mount()` after the optional runtime `mount()` hook.

## Bundling Qiankun

By default, qiankun is bundled with the application:

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

Set `externalQiankun: true` when a deployment environment provides qiankun as an
external:

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## Local Development

The plugin does not implement a local development proxy. If a master needs to
load a slave dev server through the same origin, configure the master app dev
server with `dev.proxy`:

```ts
// ev.config.ts in the master app
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
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

Then point the resolver at the proxied HTML entry. qiankun 3 consumes an HTML
entry URL, not a `{ scripts, styles, html }` object. `evPluginQiankunSlave()`
marks the emitted entry script for qiankun 3 and rewrites generated root-relative
JS/CSS asset URLs to relative URLs, so the same slave HTML can be consumed under
a path prefix such as `/__qiankun_slave`.

```ts
const slaveBase = "/__qiankun_slave";

export default async function resolveQiankunMaster() {
  return {
    apps: [
      {
        name: "catalog",
        entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
        container: "#slave-container",
      },
    ],
    routes: [{ path: "/catalog", microApp: "catalog" }],
    sandbox: true,
    prefetch: true,
  };
}
```

Keep this proxy in `dev.proxy`, not in `src/apis`; application API routes should
not be used as micro-frontend asset proxies.

## Extending For A Platform

Large organizations often have a micro-frontend platform above qiankun: a site
configuration service, deployment-specific app identifiers, default sandbox
rules, route mapping conventions, or platform-specific mount props. Keep that
platform logic outside `@evjs/plugin-qiankun`.

The recommended layering is composition:

- `@evjs/plugin-qiankun` owns the qiankun protocol bridge.
- A platform plugin owns platform metadata, generated resolver/runtime modules,
  default dev proxy rules, and deployment conventions.
- Business applications consume the platform plugin and usually do not create
  `src/qiankun.master.ts` or `src/qiankun.slave.ts` manually.

For a platform master plugin, generate a resolver module and pass it to the
open plugin:

```ts
// packages/plugin-platform/src/master.ts
import { merge } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendMaster(): Plugin[] {
  const generatedResolver = createGeneratedMasterResolverModule();

  return [
    {
      name: "@acme/evjs-platform-mf:master-config",
      config(config) {
        merge(config, {
          dev: {
            proxy: [
              {
                context: ["/__platform_slave"],
                target: "http://localhost:3001",
                pathRewrite: { "^/__platform_slave": "" },
                changeOrigin: true,
                secure: false,
              },
            ],
          },
        });
        return config;
      },
    },
    evPluginQiankunMaster({
      resolver: {
        module: generatedResolver,
      },
      externalQiankun: true,
    }),
  ];
}

function createGeneratedMasterResolverModule(): string {
  // Return an absolute path to a generated module owned by the platform plugin.
  return "/absolute/path/to/generated-master-resolver.ts";
}
```

The generated resolver adapts platform metadata to the open qiankun resolver
shape:

```ts
// generated-master-resolver.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => {
  const site = await loadPlatformSiteConfig();

  return {
    apps: site.children.map((child) => ({
      name: child.name,
      entry: child.entry,
      container: child.container,
      props: child.props,
    })),
    routes: site.routes.map((route) => ({
      path: route.path,
      microApp: route.childName,
    })),
    sandbox: site.sandbox ?? true,
    prefetch: site.prefetch ?? true,
  };
});
```

For a platform slave plugin, generate a runtime module and pass the inferred app
name to the open plugin:

```ts
// packages/plugin-platform/src/slave.ts
import type { Plugin } from "@evjs/ev/plugin";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendSlave(): Plugin[] {
  const generatedRuntime = createGeneratedSlaveRuntimeModule();
  const appName = inferPlatformAppName();

  return [
    evPluginQiankunSlave({
      name: appName,
      runtime: {
        module: generatedRuntime,
      },
      externalQiankun: true,
    }),
  ];
}

function createGeneratedSlaveRuntimeModule(): string {
  return "/absolute/path/to/generated-slave-runtime.ts";
}

function inferPlatformAppName(): string {
  return "catalog";
}
```

The generated slave runtime can normalize platform-specific mount props before
business code observes them:

```ts
// generated-slave-runtime.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props) {
    const platformProps = normalizePlatformProps(props);
    Reflect.set(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__", platformProps);
  },
  unmount() {
    Reflect.deleteProperty(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__");
  },
});
```

This keeps the open plugin stable and reusable while allowing platform plugins
to map internal site configuration, app identity, aliases, route conventions,
and deployment defaults into the qiankun protocol at the edge.

## Boundaries

`@evjs/plugin-qiankun` includes:

- master and slave app-entry wrapping;
- resolver/runtime module loading;
- qiankun lifecycle exports;
- standalone slave rendering;
- `externalQiankun` bundler external support;
- TypeScript helper functions for resolver/runtime modules.

It does not include:

- platform-specific site configuration protocols;
- organization-specific app identity fields;
- deployment metadata or release platform fields;
- local development HTML rewrite services;
- automatic master proxy generation;
- additional router semantics beyond route-to-`activeRule` mapping.
