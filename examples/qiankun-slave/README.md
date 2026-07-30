# qiankun slave

Demonstrates an evjs qiankun slave application using
`@evjs/plugin-qiankun`.

The app uses the canonical SPA model. `src/pages/page.tsx` defines its
root Page at `/`, and its UI lives in `src/components/CatalogApp.tsx`. There is
intentionally no physical `/catalog` Page: `/catalog` belongs to the master
runtime route snapshot, which projects that path as the slave router base when
mounting this root Page. The same root Page remains available at `/` when the
slave runs standalone. The plugin wraps the framework-managed SPA entry and
exports qiankun lifecycles for the master application.

## Run

```bash
npm run dev
```

Open the master example on port `3000` and visit `/catalog` to mount this root
Page through the master's runtime route.
