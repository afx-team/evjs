# qiankun master

Demonstrates an evjs file-convention qiankun master application using
`@evjs/plugin-qiankun`.

The application source uses `src/pages` and `src/layout` like a regular evjs
SPA. Qiankun integration is configured from `ev.config.ts`, and the master
resolver is loaded by the plugin through the framework-managed SPA entry.

## Run

```bash
npm run dev
```

Run the slave example on port `3001` to see `/catalog` activate the child
application. The master example uses `dev.proxy` to serve the slave dev assets
under `/__qiankun_slave/*` during local development, keeping proxy concerns out
of application API routes.
