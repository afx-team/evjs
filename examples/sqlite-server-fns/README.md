# sqlite-server-fns

Full CRUD application with SQLite (node:sqlite) — users and todos.

## Run

```bash
npm run dev -w example-sqlite-server-fns
```

## Key Files

| File | Purpose |
|------|---------|
| `src/routes.tsx` | Users list + todo management UI |
| `src/api/db.server.ts` | SQLite database setup |
| `src/api/users.server.ts` | User CRUD (create, delete, getUsers, getUser) |
| `src/api/todos.server.ts` | Todo CRUD (create, toggle, delete) |

## What It Demonstrates

- Node.js built-in `node:sqlite` module
- Multi-table relationships (users → todos)
- `useQuery(getUsers)` / `useMutation({ mutationFn })` with auto-generated query keys
- Direct mutation args: `mutate(id)`, `mutate({ name, email })`
- `getUsers.queryKey()` for cache invalidation
