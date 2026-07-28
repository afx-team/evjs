# @evjs/bundler-webpack

Webpack adapter used to validate the evjs graph / build plan / manifest contracts.

The default evjs bundler is Utoopack. This package is the explicit
validation/fallback adapter for plans that require its declared webpack build
or development capabilities.

To switch a project to webpack, pass the adapter explicitly:

```ts
import { defineConfig } from "@evjs/ev";
import { webpack, webpackAdapter, type WebpackConfig } from "@evjs/bundler-webpack";

export default defineConfig<WebpackConfig>({
  bundler: webpackAdapter,
  plugins: [
    {
      name: "webpack-customization",
      setup() {
        return {
          bundlerConfig: webpack((configs) => {
            for (const cfg of configs) {
              cfg.resolve ??= {};
            }
          }),
        };
      },
    },
  ],
});
```

Implemented build capabilities:

- production build through webpack;
- dev mode through webpack-dev-server for client entries;
- server watch builds for SSR/PPR/server runtime entries;
- manifest and HTML relinking from `BuildPlan` + webpack stats;
- generated/HTML-only dev plan updates without restarting the compiler;
- framework-managed component pages, SSR, PPR, and RSC Page/Flight builds;
- RSC request validation, renderer matching, Flight
  content-type validation, and defensive server error responses.

Entry, Route, server-topology, resolution, or bundler-config changes require
restarting `ev dev`; the adapter rejects those plan updates explicitly.
