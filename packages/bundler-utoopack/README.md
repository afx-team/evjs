# @evjs/bundler-utoopack

The default utoopack (`@utoo/pack`) bundler adapter for the evjs framework.

This package exports `utoopackAdapter`, which implements the `BundlerAdapter`
interface for `ev build` and `ev dev`.

The adapter integrates with Utoopack's programmatic API, compiles the concrete
entries in `BuildPlan`, and returns build facts for framework output linking.
Its declared capabilities are the authoritative boundary: conventional
server-rendered Page entries are supported, while plans that require RSC or
PPR fail during framework preflight.

## Development Native Ownership

Utoopack development uses one long-lived native-owner Worker for the complete
`ev dev` command. Ownership is intentionally split by lifetime:

| Lifetime | Owner | Responsibility |
| --- | --- | --- |
| `ev dev` process | Framework host | Session protocol, function-valued proxy rewrites, and framework supervision. It does not load Utoopack's native binding. |
| `ev dev` process | Native-owner Worker | Utoopack's native binding, process-global loader scheduler, loader-worker pool, and every sequential native Project. |
| Immutable Session | Native-owner Worker | One Project, development server, subscriptions, and persistent-cache lock. These close completely before the next Session starts. |

Session replacement runs Utoopack's own graceful cleanup inside the owner and
converts its successful process exit into a Session boundary. The Worker then
remains idle for the next immutable Session. Owner startup failures, loader
scheduler failures, unexpected exits, and shutdown timeouts are fail-stop; the
host never creates a second native owner in the same process. Startup also
rejects a host that has already loaded Utoopack's native binding, because that
would recreate cross-environment native ownership.

## Usage

This adapter is enabled by default in evjs. You do not need to configure it manually unless you are overriding another bundler.

If you need to explicitly configure it:

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,
});
```

## Plugin Helper

The `utoopack()` helper wraps your plugin hooks for type-safe configuration mutation:

```ts
import { merge, utoopack } from "@evjs/bundler-utoopack";
import { defineConfig } from "@evjs/ev";
import { definePlugin } from "@evjs/ev/plugin";

const myUtoopackPlugin = definePlugin({
  id: "my-utoopack-plugin",
  setup() {
    return {
      configureBundler: utoopack((config) => {
        // config is typed as ConfigComplete from @utoo/pack
        merge(config, {
          define: {
            __MY_VAR__: JSON.stringify("value"),
          },
        });
      }),
    };
  },
});

export default defineConfig({
  plugins: [myUtoopackPlugin()],
});
```
