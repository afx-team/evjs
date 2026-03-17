# configured-server-fns

Server functions with `ev.config.ts` and module-level query/mutation proxies.

## Run

```bash
npm run dev -w example-configured-server-fns
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Custom ports and settings |
| `src/routes.tsx` | Routes with `createQueryProxy` / `createMutationProxy` |
| `src/api/users.server.ts` | User CRUD functions |

## What It Demonstrates

- `ev.config.ts` with `defineConfig` for custom ports
- `createQueryProxy(module)` for grouped queries
- `createMutationProxy(module)` for grouped mutations
- Direct mutation args: `mutate({ name, email })` (not array-wrapped)
