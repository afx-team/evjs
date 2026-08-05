# Dev Server

## Command

```bash
ev dev
```

No flags needed. Configuration comes from `ev.config.ts` or convention-based
defaults.

## What It Starts

`ev dev` starts a browser-facing dev server and, when the app uses server
capabilities, a server dev runtime:

| Server | Default Port | Purpose |
| --- | --- | --- |
| **Client dev server** | `3000` | Browser bundle, HTML, and Hot Module Replacement (HMR). |
| **Server dev runtime** | `3001` | Server functions, server file routes, SSR, PPR, and RSC requests. |

Each `ev dev` session reserves its client and server ports as one coordinated
pair. When a preferred port is already occupied, evjs selects the next
available pair and prints the mapping before startup. The resolved ports are
then shared by the listener, SPA history fallback, server proxy, and readiness
output. If Utoopack must change the client port again during startup, evjs
retargets the SPA fallback to the actual listener before reporting readiness,
so requests cannot fall through to another app still listening on the
configured port.

Only one dev session can own a project directory at a time. The same project
also cannot run `ev dev`, `ev prepare`, or `ev build` concurrently. A competing
command exits early with the active operation and process ID instead of letting
the processes overwrite `.ev`, route types, `dist`, or deployment artifacts.
Different project directories can run concurrently and coordinate their port
reservations across processes.

The client and API development servers listen on IPv4 interfaces and can be
opened through both `http://localhost:<port>` and
`http://127.0.0.1:<port>`. Startup output lists the `Local` localhost URL and
the machine's `Network` URL; the equivalent
`127.0.0.1` URL remains available without an extra log line. `localhost` and
`127.0.0.1` are different browser origins, so cookies, local storage, and
service workers are not shared between them. With custom HTTPS certificates,
include both addresses in the certificate's subject alternative names when
both URLs are needed.

The client dev server derives its proxy boundary from the active `BuildPlan`.
It proxies requests matching discovered server request Route patterns and
request-time `render: "ssr"` Page patterns, plus only the runtime endpoints
present in that plan. Full SSG Pages stay on the static dev host at their
canonical route after development prerendering. The server-function and RSC
endpoints are exact paths; the PPR endpoint owns its rooted region subtree only
while PPR is active. `server.basePath` itself and unmatched descendants of an
exact endpoint remain available to the SPA.

`/api` has no implicit server meaning. It bypasses SPA history fallback only
when a discovered server route or an explicit `dev.proxy` rule claims it;
otherwise `/api/*` remains available to the client route tree like any other
SPA path.

```mermaid
flowchart TB
  Browser["Browser"]

  subgraph ClientSide["Client dev server :3000"]
    HTML["HTML + browser bundle"]
    HMR["HMR websocket"]
    Proxy["BuildPlan route + runtime proxy"]
  end

  subgraph ServerSide["Server dev runtime :3001"]
    Functions["Server functions"]
    Routes["Server routes"]
    Rendering["SSR / PPR / RSC"]
  end

  subgraph Updates["Framework updates"]
    Files["src/pages/**/page.*\nsrc/apis/**/api.*\nev.config.ts"]
    Plan["refresh CoreGraph\nand .ev plan"]
  end

  Browser --> HTML
  HMR --> Browser
  Browser --> Proxy --> ServerSide
  ServerSide --> Functions
  ServerSide --> Routes
  ServerSide --> Rendering
  Files --> Plan
  Plan --> ClientSide
  Plan --> ServerSide

  classDef browser fill:#fff7ed,stroke:#fb923c,color:#7c2d12;
  classDef client fill:#eef6ff,stroke:#8fb5e8,color:#102a43;
  classDef server fill:#ecfdf5,stroke:#34d399,color:#064e3b;
  classDef update fill:#f3f0ff,stroke:#a78bfa,color:#2e1065;
  class Browser browser;
  class HTML,HMR,Proxy client;
  class Functions,Routes,Rendering server;
  class Files,Plan update;
```

## Configuration

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  dev: {
    port: 3000,                   // Client dev server port
    https: false,                 // Client dev server HTTPS
  },
  server: {
    basePath: "/__evjs",          // Server runtime paths derive from this
    dev: {
      port: 3001,                 // Server dev runtime port
      https: false,               // Server dev runtime HTTPS
    },
  },
});
```

Conventional `src/pages` apps do not need an `entry` field. The dev server uses
the generated page app entry when page routes are discovered.

`dev.port` and `server.dev.port` are preferred ports and must be integer TCP
ports from `1` to `65535`. If either port is unavailable, the current dev
session uses a nearby available port and reports the change. Custom `dev.proxy`
rules must provide a non-empty `context` array of
pathname patterns and a `target` absolute HTTP(S) URL. Context patterns must
start with `/`, must not contain whitespace, a query string, or a hash, and
must not repeat within the same rule. Targets must not contain leading or
trailing whitespace. Use `pathRewrite` to rewrite proxied request paths before
forwarding them to the target.

Custom proxy rules are applied before the built-in proxy for server runtime
paths, so app-specific API proxies can keep their own routing behavior.

`dev.cliShortcuts` controls the interactive CLI keyboard shortcuts engine. The
default is on; set `dev.cliShortcuts: false` to disable it. The engine mirrors
Vite's `bindCLIShortcuts` (readline line events, one key + `Enter`) but ships
no built-in shortcuts of its own — every key is contributed by a plugin via the
`configureShortcuts` setup hook (see [Plugin CLI Shortcuts](#plugin-cli-shortcuts)).
It is always a no-op in CI / non-TTY contexts, and on the wasm/web (Fetch
runtime) dev surface, regardless of this option.

```ts
// ev.config.ts
export default defineConfig({
  dev: {
    cliShortcuts: false, // or { print: false } to hide the help hint
  },
});
```

`ev dev --no-shortcuts` disables the engine for a single run without editing
config.

## Request Flow

1. The client dev server serves browser code and HMR.
2. Server functions, server file routes, SSR, PPR, and RSC requests are routed
   to the server dev runtime.
3. Exact fn/RSC endpoints and active PPR subtrees from the BuildPlan are proxied
   automatically; `server.basePath` is not itself a proxy namespace.
4. Browser and server rebuilds happen as files change, and file-convention Page
   and API Route topology is discovered live. Restart `ev dev` after changing
   plugin identity or ports, or when the selected bundler reports that a plan
   update requires a restart.

Framework control-plane dependencies—such as config files and their
project-local imports, Page and Route declarations, and plugin-added watch
files—share native directory watchers.
If the operating system exhausts native watcher resources, `ev dev` logs a
warning, moves the affected watcher set to dependency polling, and creates
later framework watcher sets in polling mode. Bundler HMR watching remains
adapter-owned. Permission and unknown watcher failures stop the dev session
after cleanup rather than continuing with incomplete coverage.

Framework plan updates are transactional. evjs reserves the bundler generation
before changing generated `.ev` input, then publishes canonical manifests and
HTML only from fresh facts for the selected generation. If analysis, plugin
hooks, linking, or output emission fails, evjs restores the previous generated
and canonical output state before resuming that generation. Adapter settlement
also has a commit boundary: fallible finalization preparation runs while output
is still restorable, and the adapter releases deferred compiler work only after
Core commits the selected canonical output.

## Programmatic API

`ev dev` and `ev build` can also be used programmatically:

```ts
import { dev, build } from "@evjs/cli";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

const appConfig = {
  routing: {
    mode: "spa" as const,
  },
};

// Start dev server with an explicit bundler adapter
await dev(
  { ...appConfig, dev: { port: 3000 } },
  { cwd: "./my-app", bundler: utoopackAdapter },
);

// Run a canonical Page-and-Route production build
await build(appConfig, { cwd: "./my-app", bundler: utoopackAdapter });
```

The `bundler` option follows the same adapter contract as `ev.config.ts`: it
must have a non-empty `name`, declared build/dev `capabilities`, and `build` /
`dev` functions. Framework preflight compares the active BuildPlan with those
capabilities before starting the adapter.

`@evjs/cli` also exports programmatic helpers that inject the default Utoopack
adapter, matching the `ev dev` and `ev build` commands.

For programmatic `dev()`, a supplied config is authoritative by default and is
not replaced by a config file during startup. Calling `dev(undefined, options)`
loads the discovered config, while `reloadInitialConfig: true` explicitly asks
the provided or default `loadConfig` function to replace a supplied startup
config. A custom `loadConfig` can still be retained for later watched reloads
with `reloadInitialConfig: false`.

The `cliShortcuts` programmatic option overrides `dev.cliShortcuts`: pass
`false` to disable the interactive shortcuts engine regardless of
`ev.config.ts` (mirrors `ev dev --no-shortcuts`). When omitted, the config-file
value (default on) is authoritative.

## Plugin CLI Shortcuts

While `ev dev` runs in a TTY (and not under `CI`), plugins can register
interactive keyboard shortcuts. Core ships **no built-in shortcuts** — every key
(including `h` for help) is contributed by a plugin. This mirrors Vite's
`bindCLIShortcuts` mechanics (one key + `Enter`, with concurrent presses
dropped) but leaves the action set to the ecosystem.

Register shortcuts from a plugin's `setup()` hook:

```ts
// my-evjs-plugin.ts
import { spawn } from "node:child_process";
import { defineConfig } from "@evjs/ev";

const shortcutsPlugin = {
  id: "my-shortcuts",
  setup() {
    return {
      configureShortcuts() {
        return [
          {
            key: "o",
            description: "open the dev server in the browser",
            action(session) {
              spawn("open", [session.origin]);
            },
          },
          {
            key: "u",
            description: "show server url",
            action(session) {
              console.log(session.origin);
            },
          },
          {
            key: "r",
            description: "restart the server runtime",
            action(session) {
              session.restartServerRuntime();
            },
          },
          {
            key: "q",
            description: "quit",
            action(session) {
              session.close();
            },
          },
        ];
      },
    };
  },
};

export default defineConfig({ plugins: [shortcutsPlugin] });
```

The `configureShortcuts` hook returns a `CLIShortcut[]`, and the first plugin to
register a key owns it (later duplicates are dropped). Each `action` receives the
live `DevSession`:

- `origin: string` — the client dev server URL
  (`http(s)://localhost:<port>`).
- `restartServerRuntime()` — restart the Hono API server child through the
  same serialized restart path used when a server bundle becomes ready.
  No-ops when there is no server-runtime entry.
- `close()` — trigger dev shutdown (equivalent to `Ctrl-C`).

When bound with a help key, pressing `h` + `Enter` lists every registered
shortcut; `ev dev` prints a `press h + enter to show help` hint at startup.

Scope: this targets the standard Node dev server (the utoopack dev worker plus
the Hono API child). The wasm/web (Fetch runtime) dev surface has no Node child
process and no interactive TTY loop, so the engine stays a no-op there.

## Transport

The default HTTP transport works without app code. Call `initTransport()` at app
startup only when you need to customize the built-in HTTP adapter or replace it
with a custom adapter.

- In **dev mode**, the client dev server proxies the exact server-function
  endpoint, the exact RSC endpoint when RSC is active, and the PPR subtree when
  PPR is active to the server dev runtime.
- In **production**, client and server are typically on the same origin.
- Use `transport.baseUrl` when browser-initiated server function requests should
  target a different origin.
- Use `credentials` and `headers` for the built-in HTTP adapter; fetch `mode` is
  not configurable.
