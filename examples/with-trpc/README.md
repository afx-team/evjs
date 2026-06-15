# with-trpc

tRPC interop alongside evjs server functions.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/layout/index.tsx` | SPA root layout |
| `src/pages/index.tsx` | UI consuming both tRPC and evjs APIs |
| `src/api/trpc.server.ts` | tRPC router exposed as server function |
| `src/api/users.server.ts` | Standard evjs server functions |

## What It Demonstrates

- tRPC client + server alongside evjs server functions
- `@trpc/server` router defined inside a `"use server"` file
- Both APIs coexist in the same build pipeline
