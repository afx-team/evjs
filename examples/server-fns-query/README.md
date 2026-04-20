# server-fns-query

Query + mutation patterns with multiple API modules (users + posts).

## Run

```bash
npm run dev -w example-server-fns-query
```

## Key Files

| File | Purpose |
|------|---------|
| `src/routes.tsx` | Multi-resource page with `useQuery` / `useMutation` |
| `src/api/users.server.ts` | User CRUD |
| `src/api/posts.server.ts` | Post CRUD |

## What It Demonstrates

- `useQuery(getUsers)` / `useMutation({ mutationFn })` with auto-generated query keys
- `getFnQueryKey(getUsers)` for cache invalidation on mutation success
- Multi-arg server functions: `useQuery(searchUsers, name, email)`
- Error handling with `ServerFunctionError`
