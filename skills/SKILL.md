---
name: evjs
description: React fullstack framework with type-safe routing, data fetching, and server functions.
---

# evjs Agent Skill

Use this skill when developing applications with the evjs framework.

## Overview

evjs is a React fullstack framework built on TanStack Query, Hono, Utoopack,
and a framework-owned SPA router runtime. It provides:

- **Server Functions** — write backend logic in files (we recommend using the `.server.ts` suffix), call from React as if local
- **Server Routes** — build file-based REST endpoints under `src/apis` with uppercase HTTP method exports
- **Query Integration** — type-safe `useQuery(getUsers)` with auto query keys and transport
- **File-based Page Routing** — write default-exported React pages under
  `src/pages`; evjs generates type-safe navigation and owns the router details
- **Plugin System** — extend builds with `buildStart`, `bundlerConfig`, `transformHtml`, and `buildEnd` hooks
- **Convention over Configuration** — works out of the box, optionally configure via `ev.config.ts`

## Quick Start

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

## References

For detailed guides on specific topics, see the docs:

- [quick-start.md](../docs/docs/quick-start.md) — Scaffolding projects with `npx @evjs/create-app`
- [project-structure.md](../docs/docs/project-structure.md) — Recommended directory structure and domain-driven design (features)
- [dev.md](../docs/docs/dev.md) — Development server and configuration
- [build.md](../docs/docs/build.md) — Production builds
- [deploy.md](../docs/docs/deploy.md) — Deploying to Node, Docker, Deno, and Edge environments
- [client-routes.md](../docs/docs/client-routes.md) — Route definitions, layouts, params, loaders, navigation
- [server-functions.md](../docs/docs/server-functions.md) — Server functions, queries, mutations, error handling
- [server-routes.md](../docs/docs/server-routes.md) — Creating file-based REST API endpoints and API route middleware
- [config.md](../docs/docs/config.md) — `ev.config.ts` options, defaults, client/server settings

## Key Rules

**Server Functions (RPC):**
- Server function files must start with `"use server";` so evjs can transform and register them
- Use `useQuery(getUsers)` to query server functions directly — type-safe args & data
- Arguments are spread: `useQuery(getUser, id)` not `useQuery(getUser, [id])`
- For mutations, wrap args in objects/arrays: `mutate({ name, email })` or `mutate([name, email])`
- `ServerError` on server → automatically mapped to `ServerFunctionError` on client

**Server File Routes:**
- Use `src/apis` for framework-managed REST endpoints and export uppercase HTTP method handlers such as `GET`, `POST`, `PUT`, and `DELETE`
- Put API route middleware in `src/apis/**/middleware.ts`; it applies only to descendant server file routes
- Use `src/middleware.ts` only for framework request middleware that should also cover server functions, SSR, PPR, and RSC
- Programmatic `createRoute()` remains a standalone `@evjs/server` runtime primitive, not an evjs file-route convention

**Page Routing:**
- SPA page routes live in `src/pages` and use an optional root layout at
  `src/layout/index.tsx`; do not create `__root.tsx`, `src/layout.tsx`, or
  root-level layout files such as `src/pages/layout.tsx`.
- MPA page routing uses `routing: { mode: "mpa" }`; pages are independent
  router-free React entries and should use normal `<a href>` links.
- Page components are plain default exports. Do not wrap them in `definePage`
  and do not type props as framework route props.
- Read route data with `usePageParams()`, `usePageSearch()`, and
  `usePageLoaderData()` from `@evjs/ev/route`.
- Use `Link`, `Navigate`, `useLinkProps`, and `redirect` from `@evjs/ev/navigation`
  for SPA navigation. Generated `route-types.d.ts` augments
  `@evjs/ev/route`; app code should not import TanStack Router directly.

**React Data Loading:**
- Page loaders should fetch using: `context.queryClient.ensureQueryData(getFnQueryOptions(myFn))`
- Invalidate cache after mutations: `queryClient.invalidateQueries({ queryKey: getFnQueryKey(myFn) })`
- Access server function metadata: `myFn.fnId`, `myFn.fnName`, `getFnQueryKey(myFn, ...args)`

**Misc:**
- Use `plugins` in config to extend the build pipeline via `buildStart`, `bundlerConfig`, `transformHtml`, and `buildEnd`
