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
| `server.entry.mjs` | Custom ECMA server entry using `@evjs/server/ecma` runtime |

## What It Demonstrates

- `createFetchHandler` from `@evjs/server/ecma`
- Portable server bundle (no Node.js-specific APIs)
- Custom runtime configuration via `ev.config.ts`
