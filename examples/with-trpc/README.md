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
| `src/apis/trpc.server.ts` | tRPC router and evjs server functions |

## What It Demonstrates

- tRPC client + server alongside evjs server functions
- `@trpc/server` router defined inside a `"use server"` file
- Both APIs coexist in the same build pipeline
