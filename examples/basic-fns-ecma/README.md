# basic-fns-ecma

Server functions with the ECMA/Fetch adapter — works on Deno, Bun, and edge runtimes.

## Run

```bash
npm run dev -w example-basic-fns-ecma

# Production
npm run build -w example-basic-fns-ecma
npm run start -w example-basic-fns-ecma
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | App bootstrap |
| `src/routes.tsx` | Routes + components |
| `src/api/messages.server.ts` | Server functions |
| `ev.config.ts` | Uses `@evjs/runtime/server/ecma` backend |

## What It Demonstrates

- `createFetchHandler` from `@evjs/runtime/server/ecma`
- Portable server bundle (no Node.js-specific APIs)
- Custom backend configuration via `ev.config.ts`
