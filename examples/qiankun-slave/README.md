# qiankun slave

Demonstrates an evjs file-convention qiankun slave application using
`@evjs/plugin-qiankun`.

The app uses `src/pages` like a regular evjs SPA. The plugin wraps the
framework-managed SPA entry and exports qiankun lifecycles for the master
application.

## Run

```bash
npm run dev
```

Open the master example on port `3000` and visit `/catalog`.
