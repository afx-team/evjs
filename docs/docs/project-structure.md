# Project Structure

evjs applications should use page routes as the default client boundary. For
documentation and new applications, use one complete structure and delete
folders that the app does not need yet.

## Recommended Structure

```text
my-evjs-app/
├── ev.config.ts                 # framework config
├── index.html                   # shared HTML template with <div id="app">
├── package.json
├── .gitignore                   # ignores evjs generated artifacts
├── public/                      # copied static files
├── tsconfig.json
└── src/
    ├── styles.css               # global CSS / Tailwind entry
    ├── middleware.ts            # global server middleware
    ├── layout/
    │   └── index.tsx            # optional SPA root layout
    ├── pages/                   # page routes
    │   ├── layout.tsx           # optional SPA route layout
    │   ├── index.tsx            # /
    │   ├── (marketing)/
    │   │   └── about.tsx        # /about
    │   ├── dashboard.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
    ├── api/
    │   └── operators.server.ts  # "use server" functions
    ├── apis/                    # server file routes
    │   ├── middleware.ts        # route-scoped server route middleware
    │   └── api/
    │       └── health.ts        # /api/health server file route
    ├── components/              # reusable UI
    ├── features/                # domain modules
    │   └── operations/
    │       ├── components/
    │       ├── hooks/
    │       ├── model.ts
    │       └── types.ts
    ├── lib/                     # browser-safe shared helpers
    └── hooks/                   # app-wide React hooks
```

This shape covers the complete framework surface:

- `ev.config.ts` customizes routing mode, server paths, plugins, or
  explicit page outputs only when defaults are not enough.
- `pages/` is the client route source of truth. SPA mode maps it to a
  framework-owned app entry; MPA mode maps it to independent page entries.
- A root layout source module is optional in SPA mode. The default `src/pages`
  route directory looks beside it for one of `src/layout.tsx`,
  `src/layout.ts`, `src/layout.jsx`, `src/layout.js`, or the matching
  `src/layout/index.*` source modules. Custom `routing.dir` values use the
  parent of that route directory. Keep exactly one auto-discovered root layout
  module, or use `routing.conventions.layout` for a custom location. Explicit
  layout modules must use `.ts`, `.tsx`, `.js`, or `.jsx`; declaration, test,
  spec, story, client-only, and server-only files are not accepted. Set
  `routing.conventions.layout: false` to disable external root layout
  discovery.
- `pages/**/layout.*` and `pages/**/layout/index.*` are SPA route layouts. They
  create pathless layout routes inside the discovered route tree, so
  `src/pages/layout.tsx` wraps the root page routes and
  `src/pages/posts/layout.tsx` wraps children below `/posts`. MPA pages should
  import shared components directly or share HTML templates when they need
  common chrome.
- `<routing-dir-parent>/route-types.d.ts` is generated in SPA mode for
  type-safe navigation. The default `src/pages` writes
  `src/route-types.d.ts`; `routing.dir: "./src/app/pages"` writes
  `src/app/route-types.d.ts`. MPA mode removes stale generated route type
  files. The generated declaration uses the generated-only
  `@evjs/client/internal/route-types` helper and augments the client runtime
  navigation types. Keep generated route types ignored and do not import them
  from application code.
- Rendering metadata lives with page modules.
- `api/*.server.ts` contains server functions.
- `api/*.routes.ts` contains standard HTTP route handlers.
- `server.ts` composes `@evjs/server` routes, middleware, and framework rendering.
- `features/` keeps domain logic out of route/page files.

## Convention Matrix

Use this table as the source of truth when creating files. Only a few paths are
framework conventions; the rest are ordinary project organization.
For a dedicated filename and scope reference, see
[File Conventions](./file-conventions.md).

Quick rules:

- Route files live under the configured `routing.dir` and use `.ts`, `.tsx`,
  `.js`, or `.jsx`.
- Directory roots use `index.*`; dynamic segments use `$param`; static
  segments stay lowercase and URL-safe.
- Route groups such as `(marketing)` are supported as pathless organization and
  do not add URL segments. Malformed group segments are rejected. Dynamic param
  names must be safe identifiers; reserved object-property names and `$_splat`
  are rejected.
- `_`-prefixed files and folders are private helpers, not URL routes.
- Dot-prefixed files/folders, `.d.ts`, test/spec, Storybook,
  `*.client.*`, and `*.server.*` files under the route directory are ignored so
  colocated support files do not become routes.
- SPA root layout auto-discovery accepts one `layout.*` or `layout/index.*`
  source module beside the route directory. SPA route layouts use `layout.*` or
  `layout/index.*` modules inside the route directory. Use
  `routing.conventions.layout` for a custom external root layout module. MPA
  routes do not consume framework layouts.
- If an output cannot follow the directory shape, use explicit `pages` config
  instead of hand-writing `routing.routes`.

Migration rules stay explicit rather than adding alternate filename dialects:

- Rename bracket dynamic routes such as `[id].tsx` to `$id.tsx`.
- Use route groups such as `(marketing)/about.tsx` only for pathless
  organization; use a real URL segment such as `marketing/about.tsx` when the
  group name should appear in the URL.
- Model SPA nested layouts with route-directory layout modules. Use ordinary
  components imported by a page when the wrapper should not participate in the
  route tree.
- Use explicit `pages` config for catch-all, optional, case-sensitive, or other
  custom URL shapes.

| File or folder | Framework meaning | Use it for | Do not use it for |
| --- | --- | --- | --- |
| `src/pages/**/*.{tsx,jsx,ts,js}` | SPA/MPA page route discovery | Thin page components with optional literal rendering metadata | Shared helpers, tests, bracket routes, catch-all routes, or hand-written SPA router/bootstrap code |
| Same-basename `src/pages/**/*.html` beside a page route | MPA page HTML template | Page-specific document templates such as `about.html` beside `about.tsx` or `users/index.html` beside `users/index.tsx` | SPA layouts, route modules, or templates for unrelated routes |
| Route paths, dynamic URL shapes, and generated route IDs under `src/pages` | Route collision checks before graph/build-plan generation | One page module per URL path, one parameter naming choice per dynamic URL shape, and unique generated route IDs | Parallel `users.tsx`/`users/index.tsx`, `users/$id.tsx`/`users/$userId.tsx`, or `admin/panel.tsx`/`admin_panel.tsx` routes |
| `src/pages/(group)/**` | Pathless route group | Organizing page and layout modules without adding a URL segment | URL segments that should be visible in the browser path |
| `src/pages/_*` and `src/pages/**/_*` | Ignored private route modules | Colocated helper components, utilities, fixtures, and page-local implementation details | URL routes, SPA root layouts, or generated files |
| `src/pages/.*` and `src/pages/**/.*` | Ignored hidden route modules | Local scratch files or tool metadata that should stay invisible to route discovery | URL routes, generated route types, or source modules that should be imported by pages |
| `src/pages/**/*.d.ts`, `src/pages/**/*.{test,spec,story,stories}.*`, `src/pages/**/*.{client,server}.*` | Ignored route support modules | Type declarations, tests, Storybook stories, client-only modules, and server-only modules colocated with pages | Route pages or files that should become URLs |
| `<routing-dir-parent>/layout.{tsx,ts,jsx,js}` or `<routing-dir-parent>/layout/index.{tsx,ts,jsx,js}` | Optional external SPA root layout | One app shell around the discovered SPA route tree | MPA shared chrome, route-specific nested layouts, or multiple root layout candidates |
| `src/pages/**/layout.{tsx,ts,jsx,js}` or `src/pages/**/layout/index.{tsx,ts,jsx,js}` | SPA route layout | Pathless layout routes that wrap child routes at the same URL prefix | MPA shared chrome or non-layout helper folders named `layout` |
| `<routing-dir-parent>/route-types.d.ts` | Generated SPA navigation types | Editor and type-checker support | Manual edits, imports from app code, template/scaffold source, or MPA mode |
| `src/api/*.server.ts` | Recommended server-function boundary | Files that start with `"use server";` and export named callable server functions | Browser-only helpers, default exports, or runtime re-exports |
| `src/apis/**/*.{ts,tsx,js,jsx}` | Server file route discovery when `server.routing` is enabled | Request/Response route modules exporting uppercase HTTP methods | `route.ts` sentinels, `foo.get.ts` method suffix files, bracket/catch-all/optional routes, `middleware`/`middlewares`, default exports, or helper exports from route candidates |
| `src/middleware.{ts,tsx,js,jsx}` | Global server middleware convention when server conventions are enabled | Hono-compatible middleware that runs before server file routes, server functions, SSR, PPR, and RSC | Matcher config, route handlers, or helper exports |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | Route-scoped server file-route middleware | Hono-compatible middleware for descendant server file routes in that directory tree | Flat sibling routes such as `api.ts`, global server functions/SSR middleware, or matcher config |
| Server route paths and dynamic URL shapes under `src/apis` | Server route collision checks before graph/build-plan generation | One server route module per URL path and one parameter naming choice per dynamic URL shape | Parallel `users.ts`/`users/index.ts`, `users/$id.ts`/`users/$userId.ts`, or splitting methods for one path across files |
| `src/features`, `src/components`, `src/lib`, `src/hooks` | No direct framework convention | Domain code, reusable UI, browser-safe helpers, and React hooks | Files that depend on route discovery by filename |

Do not mix ownership models in one app unless you need the lower-level API:

- Use `src/pages` plus `routing` for normal SPA/MPA page routes.
- Use explicit `pages` config only when the output cannot be expressed by
  `src/pages`.
- Use top-level `entry`/`html` only for a manually bootstrapped single browser
  app.

## Matching Config

The matching `ev.config.ts` can stay small:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },

  server: {
    routing: true,
    rsc: true,
  },
});
```

Use `routing: { mode: "mpa" }` when every route should be emitted as its own
HTML document without SPA router setup or framework layouts. MPA routes can
use a same-basename colocated template, such as
`src/pages/product/index.html` for `src/pages/product/index.tsx`, instead of
the global `index.html` template. Use the lower-level `pages` config only for
page outputs that do not map cleanly to `src/pages`.

## Page Modules

Each discovered file under `src/pages` default-exports a React component.
Dynamic segments use `$param`, and `index.tsx` maps to the directory root.
Bracket route segments such as `[id].tsx` are rejected; catch-all and optional
segments such as `$...slug.tsx` or `$slug?.tsx` are not part of the convention
yet. Dynamic param names must be JavaScript identifiers after `$`, and static
route segments must use lowercase URL-safe letters, numbers, `.`, `_`, `-`, or
`~`. Reserved object-property names such as `$__proto__.tsx`,
`$constructor.tsx`, and `$prototype.tsx` are rejected as dynamic params.
`$_splat.tsx` is also reserved because wildcard routes expose `*` as `_splat`.
Dynamic siblings cannot differ only by parameter name, so choose one of `$id.tsx`
or `$userId.tsx` for the same URL shape. A single route path also cannot repeat
the same dynamic param name, so `teams/$teamId/users/$teamId.tsx` is rejected.
Flat route files and directory index route files cannot claim the same URL path,
so choose either `users.tsx` or `users/index.tsx` for `/users`.
Route group segments such as `(marketing)` are pathless organization, so
`src/pages/(marketing)/about.tsx` maps to `/about`. Malformed group segments
such as `(marketing` are rejected. Route discovery considers `.tsx`, `.jsx`,
`.ts`, and `.js` files, but ignores declarations, test/spec files, hidden dot
paths, Storybook `*.story.*` / `*.stories.*` files, `*.client.*` client-only
modules, `*.server.*` server-only modules, non-source files, and `_`-prefixed
private route segments. Put non-route helpers in `_`-prefixed files/folders or
outside `src/pages`. SPA and MPA share one
deterministic route order: `/` first, parent routes before children, and static
siblings before dynamic siblings. For example, `users/settings.tsx` ranks before
`users/$id.tsx`. Static siblings use locale-independent code-point ordering, so
`a-b.tsx`, `a.b.tsx`, `a0.tsx`, `a_c.tsx`, `aa.tsx`, and `a~d.tsx` keep that
same order on every machine. Route examples and config should use `/`
separators; filesystem `\` separators are normalized before route parsing so
paths and generated route IDs stay the same across operating systems. The
resolved route list used by graph and build-plan generation follows the same
rules, so duplicate paths, dynamic URL shapes, route IDs, empty dynamic params,
reserved dynamic params, duplicate dynamic params, explicit `:_splat` params,
whitespace, query strings, or hashes are rejected there too. Explicit wildcard
routes can contain at most one `*` segment because page hooks expose one
`_splat` value.
Generated route IDs also come from URL paths and normalize separators and
punctuation to underscores, so `admin/panel.tsx` and `admin_panel.tsx` both
produce `admin_panel` and cannot exist together.
Rendering metadata belongs with the page component. Syntax and default-export
errors are reported during route discovery before the bundler runs:

### Route Filename Examples

| File | Result | Notes |
| --- | --- | --- |
| `src/pages/index.tsx` | `/` | Directory root route. |
| `src/pages/docs/index.tsx` | `/docs` | Nested directory root route. |
| `src/pages/users/$userId.tsx` | `/users/$userId` | Dynamic segment; the param name must be a JavaScript identifier. |
| `src/pages/users/settings.tsx` | `/users/settings` | Static sibling; it ranks before `users/$userId.tsx`. |
| `src/pages/(marketing)/about.tsx` | `/about` | Pathless route group; `(marketing)` organizes files without adding a URL segment. |
| `src/pages/layout.tsx` | Layout route for `/` | SPA route layout that wraps root-level discovered routes. |
| `src/pages/_helpers/format.ts` | Ignored | `_`-prefixed files and folders are private to `src/pages`. |
| `src/pages/.draft.tsx` | Ignored | Dot-prefixed files and folders are hidden from route discovery. |
| `src/pages/profile.test.tsx` | Ignored | Test/spec files can be colocated with a page without becoming routes. |
| `src/pages/profile.stories.tsx` | Ignored | Storybook files are never route pages. |
| `src/pages/ClientCard.client.tsx` | Ignored | Client-only modules can be colocated for RSC/client references without becoming URL routes. |
| `src/pages/users.server.ts` | Ignored | Server-only modules are not page routes; imported server functions are still handled by the server-function transform. |
| `src/pages/users/[id].tsx` | Rejected | Bracket route syntax is not supported; use `$id.tsx`. |
| `src/pages/files/$...path.tsx` | Rejected | Catch-all segments are not part of the convention. |
| `src/pages/users/$__proto__.tsx` | Rejected | Reserved object-property names are not safe route param names. |
| `src/pages/docs/$_splat.tsx` | Rejected | `_splat` is reserved for wildcard route params. |
| `src/pages/teams/$teamId/users/$teamId.tsx` | Rejected | Dynamic param names must be unique within one route path. |
| `src/pages/users.tsx` beside `src/pages/users/index.tsx` | Rejected | Both map to `/users`; keep one page module per URL path. |
| `src/pages/admin_panel.tsx` beside `src/pages/admin/panel.tsx` | Rejected | Both generate the same route id `admin_panel`. |

```tsx
// src/pages/campaign.tsx
import { Suspense } from "react";
import { OfferRegion } from "./OfferRegion";
import { OfferSkeleton } from "./OfferSkeleton";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function Campaign() {
  return (
    <main>
      <Suspense fallback={<OfferSkeleton />}>
        <OfferRegion />
      </Suspense>
    </main>
  );
}
```

Page files should stay thin. Read params/search, export page-local loader or
rendering metadata, and compose components from `features/` or `components/`.
Business logic belongs in domain modules. Rendering metadata is literal-only:
`render` and `hydrate` are string literals, `prerender` is `true` or an object
literal with `partial`, `delivery`, or `revalidate`, `prerender.revalidate` is
`false` or a positive integer number of seconds, and `rsc` is a boolean literal
for RSC pages. Malformed page modules are reported during graph analysis with
the file path and parser message before the bundler runs; malformed PPR region
modules from the experimental compatibility path are reported the same way when
region metadata is read.

## Server Boundary

Put callable server functions under `src/api/` and file-based server routes
under `src/apis` by default.

```ts
// src/api/operators.server.ts
"use server";

export async function listOperators() {
  return [{ id: "ada", name: "Ada Lovelace" }];
}
```

```ts
// src/apis/api/health.ts
export const GET = async () => Response.json({ ok: true });
```

The file path under `src/apis` is the URL path, so the example above
maps to `/api/health`. A root route uses `src/apis/index.ts`; dynamic
segments use `$param` filenames and map to Hono params such as `:userId`.

Server middleware uses Hono's middleware signature and lives in dedicated
`middleware.ts` convention files:

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

```ts
// src/apis/api/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
};

export default middleware;
```

```ts
// src/apis/users/$userId.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## Naming Guidance

- `pages/` is the page route source folder and can include SSR/PPR/RSC components.
- `api/` contains callable server functions and custom route helpers.
- `apis/` is the server file route source folder when `server.routing`
  is enabled.
- `middleware.ts` is global server middleware; nested
  `apis/**/middleware.ts` files scope middleware to descendant file
  routes.
- `features/` owns business domains.
- `components/` owns generic UI.
- `lib/` contains browser-safe shared helpers.
- Keep server secrets and Node-only APIs in `api/`, `apis/`, or modules
  imported only by server-only code.
