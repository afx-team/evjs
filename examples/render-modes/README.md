# ev Render Modes Example

This example focuses on the rendering surfaces that evjs owns. The app
simulates a payment operations console with:

- a merchant KPI dashboard loaded through a server function;
- a REST health route for operations service status;
- a CSR support queue page for agent workflows;
- an SSR operations dashboard for document rendering;
- a full-prerender SSR settlement report with no client hydration bundle;
- a PPR campaign monitor with a dynamic offer region;
- an RSC insights page with a client reference.

It exercises the render-mode framework contracts with the webpack adapter:

- explicit app declaration;
- app-owned route declarations that create route-derived SSR/PPR/RSC pages under
  the app document;
- `pages` declarations for standalone page outputs, with render metadata kept in
  the referenced page modules;
- framework-managed SSR React page;
- framework-managed SSR React page with full prerender metadata;
- framework-managed CSR component page;
- PPR page shell plus Suspense-driven dynamic region renderer, delivered with
  streamed shell/region patches in one document response;
- RSC page renderer plus framework Flight endpoint;
- server function transform and REST route;
- split `dist/client/manifest.json`, `dist/server/manifest.json`, and
  `dist/build-output.json` output.

Utoopack remains the default bundler for normal examples. This example uses
webpack because it currently validates dynamic framework entries, component
entry wrapping, and multiple server entries.
