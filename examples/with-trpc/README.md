# with-trpc

tRPC interop alongside evjs server functions.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode |
| `src/pages/layout.tsx` | File-convention root layout |
| `src/pages/page.tsx` | UI consuming both tRPC and evjs APIs |
| `src/trpc.ts` | tRPC router and procedure definitions |
| `src/apis/trpc.server.ts` | Server-function dispatcher bridge into the tRPC router |

## What It Demonstrates

- tRPC client + server alongside evjs server functions
- A `"use server"` bridge dispatching calls into an `@trpc/server` router
- Both APIs coexist in the same build pipeline
