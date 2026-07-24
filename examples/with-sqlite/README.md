# with-sqlite

Full CRUD application with SQLite (node:sqlite) — users and todos.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode |
| `src/pages/layout.tsx` | File-convention root layout |
| `src/pages/page.tsx` | Users list + todo management UI |
| `src/apis/db.server.ts` | SQLite setup plus user and todo CRUD server functions |

## What It Demonstrates

- Node.js built-in `node:sqlite` module
- Multi-table relationships (users → todos)
- `useQuery(getUsers)` / `useMutation({ mutationFn })` with auto-generated query keys
- Direct mutation args: `mutate(id)`, `mutate({ name, email })`
- `getFnQueryKey(getUsers)` for cache invalidation
