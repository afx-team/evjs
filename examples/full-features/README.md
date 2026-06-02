# ev Full Features Example

This example exercises the new framework contracts with the webpack adapter:

- explicit app declaration;
- `pages` declarations that own URL path, component, render, and hydration metadata;
- framework-managed SSR React page;
- framework-managed CSR component page;
- PPR page shell plus dynamic region renderer;
- RSC page renderer plus framework Flight endpoint;
- manifest-driven shell remote activation;
- paired remote build in `examples/full-features-remote` that emits
  `dist/evjs-remote.json`;
- server function transform and REST route;
- single `dist/manifest.json`;
- `buildOutput()`, per-document `transformHtml()`, and `buildEnd({ output })`
  deployment adapter hooks;
- deployment artifact generation from `BuildOutput`.

Utoopack remains the default bundler for normal examples. This example uses webpack because it currently validates the complete new-architecture path while Utoopack is still missing dynamic framework entry updates, component entry wrapping, and multi server-entry support.
