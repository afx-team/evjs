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
- [server-functions.md](references/server-functions.md) — Server functions, queries, mutations, error handling
- [server-routes.md](references/server-routes.md) — Creating REST API endpoints using programmatic `route()`
- [config.md](references/config.md) — `ev.config.ts` options, defaults, client/server settings

## Key Rules

**Server Functions (RPC):**
- Server function files must start with `"use server";` directive or Webpack will bypass them
- Use `useQuery(getUsers)` to query server functions directly — type-safe args & data
- Arguments are spread: `useQuery(getUser, id)` not `useQuery(getUser, [id])`
- For mutations, wrap args in objects/arrays: `mutate({ name, email })` or `mutate([name, email])`
- `ServerError` on server → automatically mapped to `ServerFunctionError` on client

**REST Routes (`route()`):**
- Use `route()` for REST API endpoints, webhooks, or standard Web Request/Response handling
- If mixing `route()` endpoints, you must explicitly configure `server.entry` in `ev.config.ts`

**React Data Loading:**
- Route loaders should fetch using: `context.queryClient.ensureQueryData(serverFn(myFn))`
- Invalidate cache after mutations: `queryClient.invalidateQueries({ queryKey: myFn.queryKey() })`
- Access server function metadata: `myFn.fnId`, `myFn.fnName`, `myFn.queryKey(...args)`

**Misc:**
- Use `client.plugins` in config to add custom Webpack loaders (Tailwind, SCSS, SVG, etc.)
