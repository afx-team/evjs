# basic

The standard starting point for an evjs application. Demonstrates both client-side routing and server functions.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/layout/index.tsx` | SPA root layout |
| `src/pages/` | Page route files |
| `src/api/users.server.ts` | `"use server"` CRUD functions |

## What It Demonstrates

- SPA page routing from `src/pages`
- `"use server"` directive for auto-discovered server functions
- `useQuery(getUsers)` for type-safe data fetching
- `useMutation({ mutationFn: createUser })` for server-side mutations
- `getFnQueryKey(getUsers)` for cache invalidation
