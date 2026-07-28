# qiankun slave

Demonstrates an evjs qiankun slave application using
`@evjs/plugin-qiankun`.

The app uses the unified Core 0.3 SPA model. `src/pages/page.tsx` and
`src/pages/catalog/page.tsx` define `/` and `/catalog`. Their shared UI lives
in `src/components/CatalogApp.tsx` rather than inside either Page scope. The
plugin wraps the framework-managed SPA entry and exports qiankun lifecycles for
the master application.

## Run

```bash
npm run dev
```

Open the master example on port `3000` and visit `/catalog`.
