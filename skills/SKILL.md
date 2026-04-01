---
name: evjs
description: React fullstack framework with type-safe routing, data fetching, and server functions.
---

# evjs Agent Skill

Use this skill when developing applications with the evjs framework.

## Overview

evjs is a React fullstack framework built on TanStack Router, TanStack Query, and Hono. It provides:

- **Server Functions** — write backend logic in files (we recommend using the `.server.ts` suffix), call from React as if local
- **Server Routes** — build programmatic REST endpoints and APIs using the `route()` handler
- **Query Integration** — type-safe `useQuery(getUsers)` with auto query keys and transport
- **Type-safe Routing** — TanStack Router with file-based route generation
- **Plugin System** — extend the framework via `config` and `bundler` hooks in plugins
- **Convention over Configuration** — works out of the box, optionally configure via `ev.config.ts`

## Quick Start

```bash
npx @evjs/create-app my-app
cd my-app
npm run dev
```

## References

For detailed guides on specific topics, see the `references/` directory:

- [init.md](../docs/docs/quick-start.md) — Scaffolding projects with `npx @evjs/create-app`
- [project-structure.md](../docs/docs/project-structure.md) — Recommended directory structure and domain-driven design (features)
- [dev.md](../docs/docs/dev.md) — Development server and configuration
- [build.md](../docs/docs/build.md) — Production builds
- [deploy.md](../docs/docs/deploy.md) — Deploying to Node, Docker, Deno, and Edge environments
- [client-routes.md](../docs/docs/client-routes.md) — Route definitions, layouts, params, loaders, navigation
- [server-functions.md](../docs/docs/server-functions.md) — Server functions, queries, mutations, error handling
- [server-routes.md](../docs/docs/server-routes.md) — Creating REST API endpoints using programmatic `route()`
- [config.md](../docs/docs/config.md) — `ev.config.ts` options, defaults, client/server settings

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
- **Route Paths:** Always use string literals for `path` values (e.g., `path: "/posts"`). The type system **rejects** broad `string` variables and template strings at compile time.

**React Data Loading:**
- Route loaders should fetch using: `context.queryClient.ensureQueryData(getFnQueryOptions(myFn))`
- Invalidate cache after mutations: `queryClient.invalidateQueries({ queryKey: getFnQueryKey(myFn) })`
- Access server function metadata: `myFn.fnId`, `myFn.fnName`, `getFnQueryKey(myFn, ...args)`

**Misc:**
- Use `plugins` in config to extend the build pipeline via `config` and `bundler` hooks
