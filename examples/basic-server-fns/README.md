# basic-server-fns

Basic server functions with `query()` / `mutation()` wrappers.

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
- `query(fn).useQuery()` for data fetching
- `mutation(fn).useMutation()` for mutations
- `invalidates` for auto cache invalidation on mutation success
