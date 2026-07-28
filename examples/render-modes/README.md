# ev Render Modes Example

This example applies all rendering modes to one canonical
Page-and-Route tree. The app simulates a payment operations console with:

- a merchant KPI dashboard loaded through a server function;
- a REST health route for operations service status;
- a CSR support queue page for agent workflows;
- an SSR operations dashboard for document rendering;
- a full-prerender SSR settlement report with no client hydration bundle;
- a PPR campaign monitor with a dynamic offer region;
- an RSC insights page with a client reference.

`src/pages/**/page.tsx` files are the only Page and client-route anchors. Their
directories derive `/`, `/support`, `/dashboard`, `/settlement-report`,
`/campaign`, and `/insights`; `ev.config.ts` only selects
`routing.mode: "spa"`.

Each Page keeps its rendering settings in an adjacent build-time
`page.config.ts`:

- the root and support Pages use CSR;
- dashboard uses SSR with load hydration;
- settlement report uses fully prerendered SSR without hydration;
- campaign uses partially prerendered SSR with streamed region patches;
- insights uses SSR with the RSC component model.

The same config contract also owns static Page metadata independently of the
rendering mode:

- the root CSR Page declares a title plus description, keywords, viewport, and
  theme color;
- the SSR dashboard and prerendered settlement report declare route-specific
  title, description, and theme color values;
- Pages without title/meta restore the shared HTML template baseline when they
  become the deepest active SPA Page.

Private source is colocated without route-name prefixes:
`src/pages/components/RenderModePage.tsx`,
`src/pages/campaign/OfferRegion.tsx`, and
`src/pages/insights/InsightsBadge.tsx` are ordinary modules because only
`page.tsx` creates a Page.

Utoopack remains the default bundler for client-only examples. This example
uses webpack because its declared build capabilities cover server rendering,
PPR, and RSC.
