# configured-server-fns

Server functions with `ev.config.ts` and `useQuery` / `useMutation`.

## Run

```bash
npm run dev -w example-configured-server-fns
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Custom ports and settings |
| `src/routes.tsx` | Routes with `useQuery` / `useMutation` |
| `src/api/users.server.ts` | User CRUD functions |

## What It Demonstrates

- `ev.config.ts` with `defineConfig` for custom ports
- Plugin with `setup()` → `bundler: utoopack(...)` for type-safe bundler config
- `useQuery(getUsers)` for fetching data with auto-generated keys
- `useMutation({ mutationFn })` with `getUsers.queryKey()` for cache invalidation
- Direct mutation args: `mutate({ name, email })` (not array-wrapped)
