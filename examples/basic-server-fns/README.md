# basic-server-fns

Basic server functions with type-safe `useQuery()` / `useMutation()`.

## Run

```bash
npm run dev -w example-basic-server-fns
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | App bootstrap |
| `src/routes.tsx` | Routes + components |
| `src/api/users.server.ts` | `"use server"` CRUD functions |

## What It Demonstrates

- `"use server"` directive for auto-discovered server functions
- `useQuery(getUsers)` for type-safe data fetching
- `useMutation({ mutationFn: createUser })` for mutations
- `getUsers.queryKey()` for cache invalidation
