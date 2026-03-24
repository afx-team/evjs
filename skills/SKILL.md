---
name: evjs
description: React meta-framework with type-safe routing, data fetching, and server functions.
---

# evjs Agent Skill

Use this skill when developing applications with the evjs framework.

## Overview

evjs is a React meta-framework built on TanStack Router, TanStack Query, and Hono. It provides:

- **Server Functions** — write backend logic in `.server.ts` files, call from React as if local
- **Server Routes** — build programmatic REST endpoints and APIs using the `route()` handler
- **Query Integration** — type-safe `useQuery(getUsers)` with auto query keys and transport
- **Type-safe Routing** — TanStack Router with file-based route generation
- **Plugin System** — extend builds with custom loaders (e.g. Tailwind, SVG)
- **Convention over Configuration** — works out of the box, optionally configure via `ev.config.ts`

## Quick Start

```bash
npx @evjs/create-app my-app
cd my-app
npm run dev
```

## References

For detailed guides on specific topics, see the `references/` directory:

- [init.md](references/init.md) — Scaffolding projects with `npx @evjs/create-app`
- [dev.md](references/dev.md) — Development server and configuration
- [build.md](references/build.md) — Production builds
- [deploy.md](references/deploy.md) — Deploying to Node, Docker, Deno, and Edge environments
- [routing.md](references/routing.md) — Route definitions, layouts, params, loaders, navigation
- [server-fns.md](references/server-fns.md) — Server functions, queries, mutations, error handling
- [server-routes.md](references/server-routes.md) — Creating REST API endpoints using programmatic `route()`
- [config.md](references/config.md) — `ev.config.ts` options, defaults, client/server settings

## Key Rules

- Server function files must start with `"use server";` directive
- Use `useQuery(getUsers)` to query server functions directly — type-safe args & data
- Use `serverFn()` for loaders, prefetch, and invalidation: `serverFn(getUsers).queryKey`
- Arguments are spread: `useQuery(getUser, id)` not `useQuery(getUser, [id])`
- `ServerError` on server → `ServerFunctionError` on client
- Use `client.plugins` to add custom loaders (Tailwind, CSS modules, etc.)
