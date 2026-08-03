# qiankun slave

Demonstrates an evjs qiankun slave application using
`@evjs/plugin-qiankun`.

The app uses the canonical SPA model. `src/pages/page.tsx` and
`src/pages/details/page.tsx` define the slave's local `/` and `/details` Pages.
There is intentionally no physical `/catalog` Page: `/catalog` belongs to the
master runtime route snapshot, which projects that path as the slave router
base. The Pages remain available at `/` and `/details` when the slave runs
standalone, and are mounted at `/catalog` and `/catalog/details` through the
master. The plugin wraps the framework-managed SPA entry and exports qiankun
lifecycles for the master application.

## Run

```bash
npm run dev
```

Open the master example on port `3000` and visit `/catalog` or
`/catalog/details` to mount these local Pages through the master's runtime
route.
