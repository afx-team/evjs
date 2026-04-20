# @evjs/bundler-utoopack

The default utoopack (`@utoo/pack`) bundler adapter for the evjs framework.

This package provides the internal `utoopackAdapter` that implements the `BundlerAdapter` interface for `ev build` and `ev dev`.

Unlike webpack, utoopack natively supports `"use server"` directives through its unified module graph without needing a custom child compiler. This adapter directly integrates with utoopack's programmatic API to emit client and server manifests.

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
import { utoopack } from "@evjs/bundler-utoopack";

export default defineConfig({
  plugins: [
    {
      name: "my-utoopack-plugin",
      setup() {
        return {
          bundlerConfig: utoopack((config) => {
            // config is typed as ConfigComplete from @utoo/pack
            config.env ??= {};
            config.env.__MY_VAR__ = JSON.stringify("value");
          }),
        };
      },
    },
  ],
});
```
