# ev Full Features Example

This example models a merchant operations product rather than a minimal feature
fixture. The app simulates a payment operations console with:

- a merchant KPI dashboard loaded through a server function;
- a REST health route for operations service status;
- a CSR support queue page for agent workflows;
- an SSR operations dashboard for document rendering;
- a PPR campaign monitor with a dynamic offer region;
- an RSC insights page with a client reference;
- a manifest-driven CRM remote workspace with shared React negotiation;
- deployment artifacts derived from `BuildOutput`.

It still exercises the new framework contracts with the webpack adapter:

- explicit app declaration;
- `pages` declarations that own URL path, component, render, and hydration metadata;
- framework-managed SSR React page;
- framework-managed CSR component page;
- PPR page shell plus Suspense-driven dynamic region renderer, delivered with
  streamed shell/region patches in one document response;
- RSC page renderer plus framework Flight endpoint;
- manifest-driven shell remote activation;
- paired remote build in `examples/full-features-remote` that emits
  `dist/evjs-remote.json` from a default-exported React component;
- `useRemoteHost()` for host-side remote activation, explicit remote manifest
  configuration, shared dependency diagnostics, and shell lifecycle ownership;
- server function transform and REST route;
- single `dist/manifest.json`;
- `buildOutput()`, per-document `transformHtml()`, and `buildEnd({ output })`
  deployment adapter hooks;
- deployment artifact generation from `BuildOutput`.

Utoopack remains the default bundler for normal examples. This example uses webpack because it currently validates the complete new-architecture path while Utoopack is still missing dynamic framework entry updates, component entry wrapping, and multi server-entry support.
