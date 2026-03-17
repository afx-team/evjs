# sqlite-server-fns

Full CRUD application with SQLite (better-sqlite3) — users and todos.

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

- Native addon (`better-sqlite3`) via webpack server externals
- Multi-table relationships (users → todos)
- `createQueryProxy` + `createMutationProxy` for grouped API
- Direct mutation args: `mutate(id)`, `mutate({ name, email })`
- `invalidates` for auto cache invalidation
