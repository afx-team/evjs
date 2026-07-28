# Qiankun Plugin

`@evjs/plugin-qiankun` lets an evjs single-page application participate in a
[qiankun](https://github.com/umijs/qiankun) master/slave micro-frontend
topology. It is intentionally a protocol bridge: it wraps the configured app
entry, wires qiankun lifecycles, and loads user-provided resolver/runtime
modules. It does not own application routing, platform site metadata, deployment
fields, or local development proxy conventions.

Use the plugin when an SPA application explicitly runs as a qiankun master or
slave. The default path is the canonical Page-and-Route SPA model. Do not
enable it for MPA applications.

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
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

The resolver returns the qiankun application list and framework options as a
flat object:

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
  sandbox: true,
  prefetch: true,
}));
```

The canonical Route owns the micro-app association next to its `page.tsx`
anchor:

```ts
// src/pages/catalog/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  route: {
    extensions: {
      "@evjs/qiankun": {
        microApp: "catalog",
      },
    },
  },
});
```

The master plugin registers this namespace with `routeExtension()`, validates
that it targets a static Page Route, and generates the qiankun route mapping
from the normalized CoreGraph. When an app does not already define
`activeRule`, the plugin uses that mapping while calling
`registerMicroApps`. The resolver-level `routes` array remains readable for
existing plugin configurations, but new applications should not repeat
canonical paths there.

Keep the qiankun container mounted by the shell while the master is running;
route-local containers should be handled by a higher-level plugin that turns
routes into micro-app components.

```tsx
// src/pages/layout.tsx
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
// src/pages/catalog/page.tsx
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
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

The application remains an ordinary canonical Page application:

```tsx
// src/components/CatalogApp.tsx
export function CatalogApp() {
  return <h1>Catalog</h1>;
}
```

Both `src/pages/page.tsx` and `src/pages/catalog/page.tsx` may default-export
that shared UI. Their directories publish `/` for standalone rendering and
`/catalog` for activation by the master without a second route declaration.

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
automatically renders the canonical framework entry. The plugin does not
support an alternate entry field or infer a magic `src/main.tsx`. Standalone
`@evjs/client` applications own their qiankun/container integration directly.

## Module References

`resolver` and `runtime` accept a string module specifier, a generated module
ref, or an object with a named export:

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

Object references are useful for named exports:

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
Inside another plugin's `contributions()` hook, pass the `GeneratedModuleRef`
returned by `ctx.emit.module()` directly to `contributeQiankunMaster()` or
`contributeQiankunSlave()`.

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
calls it during `mount()` after the optional runtime `mount()` hook. The
generated original entry is inert until the lifecycle calls its exported
`start(container)`, so loading it early from `bootstrap()` cannot mount into the
master document. The first `mount()` uses `start()` to preserve hydration-marker
semantics; the module is cached, and later remounts call `app.render()` exactly
once inside the current qiankun container.

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
    sandbox: true,
    prefetch: true,
  };
}
```

The `/catalog` association still comes from
`src/pages/catalog/page.config.ts#route.extensions`; the resolver does not
repeat the path.

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

For a platform master plugin, emit a resolver module into the same `.ev` IR and
pass the returned opaque ref to the qiankun helper:

```ts
// packages/plugin-platform/src/master.ts
import { merge } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import {
  contributeQiankunMaster,
  QIANKUN_ROUTE_EXTENSION_NAMESPACE,
} from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendMaster(): Plugin {
  return {
    name: "@acme/evjs-platform-mf:master",
    describe(api) {
      api.routeExtension({
        namespace: QIANKUN_ROUTE_EXTENSION_NAMESPACE,
      });
    },
    config(config) {
      merge(config, {
        dev: {
          proxy: [
            ...(config.dev?.proxy ?? []),
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
    async contributions(ctx) {
      const site = ctx.emit.data({
        id: "platform-site",
        scope: { kind: "application" },
        value: await loadPlatformSiteConfig(ctx),
      });
      const resolver = ctx.emit.module({
        id: "master-resolver",
        scope: { kind: "application" },
        source: ({ importOf }) => `
          import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";
          import site from ${JSON.stringify(importOf(site))};

          export default defineQiankunMasterResolver(async () => ({
            apps: site.children,
            sandbox: site.sandbox ?? true,
            prefetch: site.prefetch ?? true,
          }));
        `,
      });

      await contributeQiankunMaster(ctx, {
        resolver,
        externalQiankun: true,
      });
    },
  };
}
```

`merge()` replaces arrays, so a platform plugin that appends a proxy must copy
the existing `config.dev.proxy` entries as shown above. This preserves
application-owned and earlier plugin-owned proxy rules.

The generated resolver adapts platform application metadata to the open
qiankun resolver shape. Canonical route associations remain in Page-local
`route.extensions`; registering the shared namespace lets
`contributeQiankunMaster()` project them. The resolver remains a generated
artifact with manifest provenance, not an unmanaged temporary file:

```ts
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
    sandbox: site.sandbox ?? true,
    prefetch: site.prefetch ?? true,
  };
});
```

For a platform slave plugin, emit the runtime module, pass it to the qiankun
contribution helper, and reuse the qiankun bundler and HTML helpers:

```ts
// packages/plugin-platform/src/slave.ts
import type { Plugin } from "@evjs/ev/plugin";
import {
  applyQiankunSlaveBundlerConfig,
  applyQiankunSlaveHtmlTransform,
  contributeQiankunSlave,
  type QiankunContributionState,
} from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendSlave(): Plugin {
  let qiankunState: QiankunContributionState | undefined;

  return {
    name: "@acme/evjs-platform-mf:slave",
    async contributions(ctx) {
      const runtime = ctx.emit.module({
        id: "slave-runtime",
        scope: { kind: "application" },
        source: `
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
        `,
      });

      qiankunState = await contributeQiankunSlave(ctx, {
        name: inferPlatformAppName(ctx),
        runtime,
        externalQiankun: true,
      });
    },
    setup() {
      return {
        bundlerConfig(config, ctx) {
          applyQiankunSlaveBundlerConfig(config, ctx.bundlerName, qiankunState);
        },
        transformHtml(doc) {
          applyQiankunSlaveHtmlTransform(doc, qiankunState);
        },
      };
    },
  };
}
```

The state returned by `contributeQiankunSlave()` keeps the generated entry,
bundler output, and lifecycle proxy on the same inferred application name.
`applyQiankunSlaveHtmlTransform()` also accepts no state when the default
`evjs-qiankun-slave` name is intentional.

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
