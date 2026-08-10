# @evjs/bundler-webpack

Webpack adapter used to validate the evjs graph / build plan / manifest contracts.

The default evjs bundler is Utoopack. This package is the explicit
validation/fallback adapter for plans that require its declared webpack build
capabilities.

To switch a project to webpack, pass the adapter explicitly:

The typed `webpack()` helper always receives the complete `Configuration[]`
set because one evjs plan may create separate client and server compilers.

```ts
import { webpack, webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";
import { definePlugin } from "@evjs/ev/plugin";

const webpackCustomization = definePlugin({
  id: "webpack-customization",
  setup() {
    return {
      configureBundler: webpack((configs) => {
        for (const cfg of configs) {
          cfg.resolve ??= {};
        }
      }),
    };
  },
});

export default defineConfig({
  bundler: webpackAdapter,
  plugins: [webpackCustomization()],
});
```

Implemented capabilities:

- production build through webpack;
- dev mode through webpack-dev-server for client entries;
- server watch builds for SSR/PPR/server runtime entries;
- manifest and HTML relinking from `BuildPlan` + webpack stats;
- framework-managed component pages, SSR, PPR, and RSC Page/Flight builds;
- RSC request validation, renderer matching, Flight
  content-type validation, and defensive server error responses.

Ordinary module edits stay on webpack watch/HMR inside one immutable Session.
For semantic framework config, graph, plan, generated-IR, or bundler-config
changes, the dev Supervisor closes that controller and starts a complete
replacement Session. Framework and bundler inputs remain fixed for the
controller's lifetime. Changing the requested dev ports still requires
restarting `ev dev`.
