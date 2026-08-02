# qiankun master

Demonstrates an evjs qiankun master application using
`@evjs/plugin-qiankun`.

The application uses the canonical SPA model. `src/pages/page.tsx`
defines the file-convention `/` Page, while `src/pages/layout.tsx` is the root
layout. There is intentionally no physical `/catalog` Page or fixed slave
container in the master source tree.

The application-level resolver supplies the child applications, their runtime
route mappings, and qiankun route-component settings. Its `/catalog` route is
installed as a runtime overlay, whose generated component owns the child
container and mounts the slave's root Page with `/catalog` as its base. This is
also the integration point for a site platform that distributes `apps` and
`routes` at runtime. Because runtime routes are not part of generated static
route types, the example uses ordinary links when navigating to `/catalog`.
Qiankun integration is configured from `ev.config.ts`, and the resolver is
loaded by the plugin through the framework-managed SPA entry.

## Run

```bash
npm run dev
```

Run the slave example on port `3001` to see `/catalog` mount its root Page and
`/catalog/details` mount its local details Page. The master example uses
`dev.proxy` to serve the slave dev assets under
`/__qiankun_slave/*` during local development, keeping proxy concerns out of
application API routes.
