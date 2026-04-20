# Plugins

evjs plugins extend the build pipeline with custom behavior — from injecting bundler rules and modifying output HTML, to collecting build metadata for CI/CD. Plugins are declared in `ev.config.ts` and run in order.

## Quick Example

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup(ctx) {
        let t0: number;
        return {
          buildStart() {
            t0 = Date.now();
            console.log(`Building (${ctx.mode})...`);
          },
          buildEnd(result) {
            console.log(`Done in ${Date.now() - t0}ms`);
            console.log(`${result.clientManifest.assets.js.length} JS assets`);
          },
        };
      },
    },
  ],
});
```

## Plugin Structure

Every plugin is an object with a `name` and an optional `setup()` function:

```ts
interface EvPlugin {
  /** Plugin name — used in logs and error messages. */
  name: string;

  /** Initialize the plugin, return lifecycle hooks. */
  setup?: (ctx: EvPluginContext) => EvPluginHooks | undefined;
}
```

### Setup Context

The `setup` function receives a context with the current mode and the fully resolved config:

```ts
interface EvPluginContext {
  mode: "development" | "production";
  config: ResolvedEvConfig;
}
```

All returned hooks share state through closure — use `setup()` to initialize shared variables and return hooks that reference them.

## Lifecycle Hooks

Hooks run at specific points in the build pipeline:

```mermaid
flowchart LR
    A[buildStart] --> B[bundler]
    B --> C["webpack compile"]
    C --> D["HTML generation"]
    D --> E[transformHtml]
    E --> F[buildEnd]
```

| Hook | Signature | When |
|------|-----------|------|
| `buildStart` | `() => void` | Before compilation begins |
| `bundler` | `(config, ctx) => void` | During bundler config creation |
| `transformHtml` | `(doc, result) => void` | After asset injection, before HTML is emitted |
| `buildEnd` | `(result) => void` | After compilation completes |

All hooks can be `async` (return a `Promise`).

---

### `buildStart`

Runs once before compilation begins. Use for logging, initializing timers, or setting up external services.

```ts
setup() {
  return {
    buildStart() {
      console.log("Compilation starting...");
    },
  };
}
```

---

### `bundler`

Mutate the underlying bundler configuration directly. The `config` type is `unknown` by default — use a typed helper for safety.

```ts
setup() {
  return {
    bundler(config, ctx) {
      // `config` is `unknown` — cast or use the typed helper below
    },
  };
}
```

#### Type-Safe Bundler Config

Import the `webpack()` or `utoopack()` helpers for full TypeScript support across different bundlers:

```ts
import { webpack } from "@evjs/bundler-webpack";
import { utoopack } from "@evjs/bundler-utoopack";

{
  name: "yaml-support",
  setup() {
    return {
      bundlerConfig(config, ctx) {
        // Safe mutation for webpack
        webpack((cfg) => {
          cfg.module?.rules?.push({
            test: /\.yaml$/,
            type: "json",
          });
        })(config, ctx);

        // Safe mutation for utoopack
        utoopack((cfg) => {
          cfg.module ??= {};
          cfg.module.rules ??= {};
          cfg.module.rules[".yaml"] = { type: "json" };
        })(config, ctx);
      },
    };
  },
}
```

The helpers wrap your callback and only execute when the corresponding bundler is active.

---

### `transformHtml`

Mutate the output HTML **document** after evjs injects `<script>` and `<link>` tags, but before the file is written to disk.

The hook receives a parsed DOM document (`EvDocument`) — use standard DOM methods to manipulate it. No fragile string replacement needed.

```ts
setup() {
  return {
    transformHtml(doc, result) {
      // Inject a <meta> tag
      const meta = doc.createElement("meta");
      meta.setAttribute("name", "generator");
      meta.setAttribute("content", "evjs");
      doc.head?.appendChild(meta);

      // Inject a comment with build info
      const count = result.clientManifest.assets.js.length;
      const comment = doc.createComment(` ${count} JS assets `);
      doc.head?.appendChild(comment);
    },
  };
}
```

#### Multiple Plugins

When multiple plugins define `transformHtml`, they all receive the **same document** and their mutations accumulate in order:

```ts
plugins: [
  pluginA,  // adds <meta name="a">
  pluginB,  // adds <meta name="b"> — sees pluginA's <meta> already in the DOM
]
```

#### `EvDocument` API

The `EvDocument` interface is a bundler-agnostic subset of the standard DOM API. Key methods:

| Category | Methods |
|----------|---------|
| **Querying** | `querySelector()`, `querySelectorAll()`, `getElementById()` |
| **Attributes** | `getAttribute()`, `setAttribute()`, `removeAttribute()`, `hasAttribute()` |
| **Tree mutation** | `appendChild()`, `removeChild()`, `insertBefore()`, `append()`, `prepend()`, `remove()` |
| **Content** | `insertAdjacentHTML()`, `innerHTML` (get/set), `outerHTML` (read-only), `textContent` |
| **Creation** | `createElement()`, `createTextNode()`, `createComment()` |
| **Traversal** | `head`, `body`, `parentNode`, `firstChild`, `children`, `childNodes` |

Import the type for explicit annotations:

```ts
import type { EvDocument } from "@evjs/ev";
```

---

### `buildEnd`

Runs after compilation completes. Receives the `EvBuildResult` containing both manifests:

```ts
interface EvBuildResult {
  clientManifest: ClientManifest;      // assets, routes
  serverManifest?: ServerManifest;     // entry, fns (undefined if server: false)
  isRebuild: boolean;                 // true in dev watch mode
}
```

```ts
setup() {
  return {
    buildEnd(result) {
      console.log("JS:", result.clientManifest.assets.js);
      console.log("CSS:", result.clientManifest.assets.css);

      if (result.serverManifest) {
        console.log("Server fns:", Object.keys(result.serverManifest.fns));
      }
    },
  };
}
```

## Recipes

### Inject Build-Time Constants

```ts
import { webpack } from "@evjs/bundler-webpack";
import { utoopack } from "@evjs/bundler-utoopack";

{
  name: "env-inject",
  setup() {
    return {
      bundlerConfig(config, ctx) {
        webpack((cfg) => {
          const { DefinePlugin } = require("webpack");
          cfg.plugins ??= [];
          cfg.plugins.push(
            new DefinePlugin({
              __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
              __APP_VERSION__: JSON.stringify("1.0.0"),
            }),
          );
        })(config, ctx);

        utoopack((cfg) => {
          cfg.env ??= {};
          cfg.env.__BUILD_TIME__ = JSON.stringify(new Date().toISOString());
          cfg.env.__APP_VERSION__ = JSON.stringify("1.0.0");
        })(config, ctx);
      },
    };
  },
}
```

### Write a Deploy Manifest

```ts
import fs from "node:fs";

{
  name: "deploy-manifest",
  setup(ctx) {
    return {
      buildEnd(result) {
        fs.writeFileSync(
          "dist/deploy.json",
          JSON.stringify({
            builtAt: new Date().toISOString(),
            mode: ctx.mode,
            js: result.clientManifest.assets.js,
            css: result.clientManifest.assets.css,
            hasServer: !!result.serverManifest,
          }, null, 2),
        );
      },
    };
  },
}
```

### Add a CSP Nonce to Scripts

```ts
import crypto from "node:crypto";

{
  name: "csp-nonce",
  setup() {
    return {
      transformHtml(doc) {
        const nonce = crypto.randomBytes(16).toString("base64");

        // Add nonce to all injected scripts
        for (const script of doc.querySelectorAll("script")) {
          script.setAttribute("nonce", nonce);
        }

        // Inject CSP meta tag
        const meta = doc.createElement("meta");
        meta.setAttribute("http-equiv", "Content-Security-Policy");
        meta.setAttribute(
          "content",
          `script-src 'nonce-${nonce}' 'strict-dynamic'`,
        );
        doc.head?.appendChild(meta);
      },
    };
  },
}
```

### Inject Analytics Snippet

```ts
{
  name: "analytics",
  setup() {
    return {
      transformHtml(doc) {
        doc.body?.insertAdjacentHTML(
          "beforeend",
          `<script defer src="https://analytics.example.com/script.js"
                  data-website-id="abc-123"></script>`,
        );
      },
    };
  },
}
```

## Example Project

See [`examples/basic-plugins`](https://github.com/evaijs/evjs/tree/main/examples/basic-plugins) for a working example that demonstrates all four hooks.
