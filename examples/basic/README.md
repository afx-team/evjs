# basic

The standard starting point for an evjs application. Demonstrates both client-side routing and server functions.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/layout.tsx` | SPA root layout |
| `src/pages/` | File-based page routes |
| `src/api/users.server.ts` | `"use server"` CRUD functions |

## What It Demonstrates

- File-based SPA routing from `src/pages`
- `"use server"` directive for auto-discovered server functions
- `useQuery(getUsers)` for type-safe data fetching
- `useMutation({ mutationFn: createUser })` for server-side mutations
- `getFnQueryKey(getUsers)` for cache invalidation
