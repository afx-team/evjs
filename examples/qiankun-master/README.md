# qiankun master

Demonstrates an evjs qiankun master application using
`@evjs/plugin-qiankun`.

The application uses the unified Core 0.3 SPA model. `src/pages/page.tsx` and
`src/pages/catalog/page.tsx` define `/` and `/catalog`, while
`src/pages/layout.tsx` is the root layout.
`src/pages/catalog/page.config.ts#route.extensions` associates that canonical
Route with the `catalog` micro-app; the resolver only supplies the child
application and qiankun runtime options. Qiankun integration is configured from
`ev.config.ts`, and the master resolver is loaded by the plugin through the
framework-managed SPA entry.

## Run

```bash
npm run dev
```

Run the slave example on port `3001` to see `/catalog` activate the child
application. The master example uses `dev.proxy` to serve the slave dev assets
under `/__qiankun_slave/*` during local development, keeping proxy concerns out
of application API routes.
