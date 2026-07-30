# qiankun slave

Demonstrates an evjs qiankun slave application using
`@evjs/plugin-qiankun`.

The app uses the canonical SPA model. `src/pages/page.tsx` defines `/`, while
`src/pages/details/page.tsx` defines the local `/details` Page. There is
intentionally no physical `/catalog` Page: `/catalog` belongs to the master
runtime route snapshot, which projects that path as the slave router base.
The two local Pages therefore mount at `/catalog` and `/catalog/details`, while
remaining available at `/` and `/details` when the slave runs standalone. The
plugin wraps the framework-managed SPA entry and exports qiankun lifecycles for
the master application.

## Run

```bash
npm run dev
```

Open the master example on port `3000` and visit `/catalog` to mount this root
Page through the master's runtime route.
