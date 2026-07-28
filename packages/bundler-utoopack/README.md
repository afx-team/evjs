# @evjs/bundler-utoopack

The default utoopack (`@utoo/pack`) bundler adapter for the evjs framework.

This package exports `utoopackAdapter`, which implements the `BundlerAdapter`
interface for `ev build` and `ev dev`.

The adapter integrates with Utoopack's programmatic API, compiles the concrete
entries in `BuildPlan`, and returns build facts for framework output linking.
Its declared capabilities are the authoritative boundary: plans that require
unsupported server rendering, RSC, or PPR fail during framework preflight.

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
import { defineConfig } from "@evjs/ev";
import { merge, utoopack } from "@evjs/bundler-utoopack";

export default defineConfig({
  plugins: [
    {
      name: "my-utoopack-plugin",
      setup() {
        return {
          bundlerConfig: utoopack((config) => {
            // config is typed as ConfigComplete from @utoo/pack
            merge(config, {
              define: {
                __MY_VAR__: JSON.stringify("value"),
              },
            });
          }),
        };
      },
    },
  ],
});
```
