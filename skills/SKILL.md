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
- **Page-and-Route Model** — use positive `src/pages/**/page.*` anchors; each
  containing directory owns one Page scope and derives its URL in SPA and MPA
- **Page Configuration** — use adjacent build-time `page.config.ts` for static
  title/named metadata, core rendering settings, and namespaced plugin
  extensions
- **Application Configuration** — use top-level namespaced `extensions` for
  plugin-owned static Application data
- **Plugin System** — declare Application/Page extension ownership and extend
  builds with `buildStart`, `bundlerConfig`, `transformHtml`, and `buildEnd`
  hooks
- **Minimal Routing Config** — `ev.config.ts` selects `routing.mode`; other
  configuration is optional

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
- Canonical SPA and MPA routes use one positive anchor:
  `src/pages/**/page.{ts,tsx,js,jsx}`. The complete containing directory is the
  Page scope and determines its URL; `index.*` and other colocated files are
  ordinary Page-private source.
- Select only the materialization with `routing: { mode: "spa" }` or
  `routing: { mode: "mpa" }`. Do not invent separate SPA and MPA Page trees.
- Source trees whose published entries use `index.tsx` require a one-time
  conversion: move or rename every published entry to `page.tsx`, move Page
  configuration to adjacent `page.config.ts`, and then configure only
  `routing.mode`. Canonical discovery reads only positive `page.*` anchors.
- Explicit `application.routes` and `component`/`routes` config are SPA-only
  route-tree inputs. Their converters must reject MPA materialization and
  normalize into the canonical graph. Prefer moving each component to its URL
  directory as `page.tsx`; do not introduce another route-tree input.
- The optional canonical root layout is `src/pages/layout.tsx`; nested layouts
  use `layout.*` in route directories. Do not create `__root.tsx` or an
  external `src/layout/index.tsx` framework layout.
- Put optional build-time Page settings in adjacent `page.config.ts` via
  `definePageConfig()`. Core fields include `title`, named `meta`, `render`,
  `hydrate`, `prerender`, and `rsc`; plugin-owned values go under namespaced
  `extensions`. `meta` emits only `<meta name="..." content="...">` entries.
- `page.config.ts` is not a browser entry. Core title and named metadata are
  materialized by the framework; plugins must explicitly project any extension
  runtime data or code they need.
- MPA Pages are independent router-free React entries and should use normal
  `<a href>` links.
- Page components are plain default exports. Do not wrap them in `definePage`
  and do not type props as framework route props.
- Read route data with `usePageParams()`, `usePageSearch()`, and
  `usePageLoaderData()` from `@evjs/ev/route`.
- Search params use `Record<string, string>` without implicit number, boolean,
  or JSON coercion. Convert values explicitly in `validateSearch`; repeated
  query keys keep the last value.
- Use `Link`, `Navigate`, `useLinkProps`, and `redirect` from `@evjs/ev/navigation`
  for SPA navigation. Generated `route-types.d.ts` augments
  `@evjs/ev/route`; app code should not import TanStack Router directly.

**React Data Loading:**
- Page loaders should fetch using: `context.queryClient.ensureQueryData(getFnQueryOptions(myFn))`
- Invalidate cache after mutations: `queryClient.invalidateQueries({ queryKey: getFnQueryKey(myFn) })`
- Access server function metadata: `myFn.fnId`, `myFn.fnName`, `getFnQueryKey(myFn, ...args)`

**Misc:**
- Put static plugin-owned Application values under top-level
  `config.extensions`; plugins register them with `applicationExtension()`
  before `setup()`. Page-local values remain under `page.config.ts`
  `extensions` and use `pageExtension()`.
- Extension values are strict JSON graph data. Keep functions and secrets out;
  use typed plugin factory options or explicit module references for executable
  behavior.
- Use `plugins` in config to extend the build pipeline via `buildStart`,
  `bundlerConfig`, `transformHtml`, and `buildEnd`
- `ev dev` permits one active session per project directory and coordinates client/server port pairs across concurrently running projects; configured ports are preferred, may move when occupied, and the SPA fallback follows Utoopack's actual startup port
- Client and API dev servers accept both `localhost` and `127.0.0.1`; treat them as separate browser origins for cookies, storage, and service workers
