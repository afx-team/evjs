# server-fns-query

Query + mutation proxies with multiple API modules (users + posts).

## Run

```bash
npm run dev -w example-server-fns-query
```

## Key Files

| File | Purpose |
|------|---------|
| `src/routes.tsx` | Multi-resource page with proxy API |
| `src/api/users.server.ts` | User CRUD |
| `src/api/posts.server.ts` | Post CRUD |

## What It Demonstrates

- Multiple `createQueryProxy` / `createMutationProxy` namespaces (`api.users`, `api.posts`)
- `queryKey()` for manual cache invalidation
- `queryOptions()` for route loaders with `ensureQueryData`
- `Promise.all` in loader for parallel data fetching
