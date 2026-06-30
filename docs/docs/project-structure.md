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
├── tsconfig.json                # includes @/* -> ./src/* path alias
├── public/                      # copied static files
└── src/
    ├── styles.css               # global CSS / Tailwind entry
    ├── middleware.ts            # global server middleware
    ├── layout/
    │   └── index.tsx            # optional SPA root layout
    ├── pages/                   # page routes
    │   ├── error.tsx            # optional root SPA error boundary
    │   ├── not-found.tsx        # optional root SPA not-found boundary
    │   ├── index.tsx            # /
    │   ├── (marketing)/
    │   │   └── about.tsx        # /about
    │   ├── dashboard/
    │   │   ├── layout.tsx       # nested SPA route layout
    │   │   └── index.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
    ├── apis/                    # server file routes
    │   ├── middleware.ts        # API route middleware
    │   ├── users.server.ts      # colocated server functions
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

| Surface | Convention | Notes |
| --- | --- | --- |
| Config | `ev.config.ts` | Customize routing mode, server paths, plugins, or explicit page outputs only when defaults are not enough. |
| Import alias | `tsconfig.json` `paths["@/*"]` | `@/components/Button` resolves to `src/components/Button`; evjs configures the bundler alias automatically and templates configure TypeScript for editor/type-checker support. |
| Client routes | `src/pages` | Source of truth for SPA and MPA page routes. SPA mode maps it to one framework-owned app entry; MPA mode maps it to independent page entries. |
| SPA root shell | `<routing-dir-parent>/layout/index.tsx` | The default `src/pages` route directory uses `src/layout/index.tsx`; `routing.dir: "./src/app/pages"` uses `src/app/layout/index.tsx`. Use `routing.conventions.layout` only for an intentional custom shell path. |
| Nested SPA layouts | `src/pages/<segment>/layout.*` | Wrap descendants below a route segment. `src/pages/layout.tsx` and `src/pages/<segment>/layout/index.*` are rejected. MPA pages import shared components or share HTML templates instead. |
| SPA route boundaries | `src/pages/**/error.*`, `src/pages/**/not-found.*` | Scoped SPA error and not-found boundaries. MPA pages treat these filenames as ordinary routes. |
| Generated route types | `<routing-dir-parent>/route-types.d.ts` | SPA mode writes type-safe navigation declarations, such as `src/route-types.d.ts` or `src/app/route-types.d.ts`. Keep them ignored and do not import them from application code. |
| Page metadata | Named exports in page modules | Rendering metadata lives with the page component. |
| Server functions | `"use server";` in `*.server.*` modules | Server functions have no convention directory and can live beside pages, features, or server file routes. |
| Server file routes | `src/apis` | Request/Response route modules discovered by default. Files without route exports stay ordinary colocated helpers. |
| Server middleware | `src/middleware.ts`, `src/apis/**/middleware.ts` | Global server middleware wraps server runtime requests; API route middleware wraps descendant server file routes only. |
| Manual server code | Ordinary files such as `server.ts` | Standalone/manual `@evjs/server` code is not discovered as a file convention and is unrelated to server file-route discovery. |
| Domain code | `features/`, `components/`, `lib/`, `hooks/` | Keep business logic, reusable UI, browser-safe helpers, and React hooks out of route/page files. |

## Convention Matrix

Use this table as the source of truth when creating files. Only a few paths are
framework conventions; the rest are ordinary project organization.
For a dedicated filename and scope reference, see
[File Conventions](./file-conventions).

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
- SPA root layout auto-discovery accepts only `layout/index.tsx` beside the
  route directory. Nested SPA route layouts use `layout.*` below a route
  segment. Use `routing.conventions.layout` for a custom external root layout
  module. MPA routes do not consume framework layouts.
- SPA `src/pages/error.tsx`, `src/pages/not-found.tsx`, and scoped files such
  as `src/pages/dashboard/error.tsx` are reserved in SPA mode. `error.*` and
  `not-found.*` inherit by route directory scope.
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
| Route paths, dynamic URL shapes, and generated route IDs under `src/pages` | Route collision checks before build output is generated | One page module per URL path, one parameter naming choice per dynamic URL shape, and unique generated route IDs | Parallel `users.tsx`/`users/index.tsx`, `users/$id.tsx`/`users/$userId.tsx`, or `admin/panel.tsx`/`admin_panel.tsx` routes |
| `src/pages/(group)/**` | Pathless route group | Organizing page and layout modules without adding a URL segment | URL segments that should be visible in the browser path |
| `src/pages/_*` and `src/pages/**/_*` | Ignored private route modules | Colocated helper components, utilities, fixtures, and page-local implementation details | URL routes, SPA root layouts, or generated files |
| `src/pages/.*` and `src/pages/**/.*` | Ignored hidden route modules | Local scratch files or tool metadata that should stay invisible to route discovery | URL routes, generated route types, or source modules that should be imported by pages |
| `src/pages/**/*.d.ts`, `src/pages/**/*.{test,spec,story,stories}.*`, `src/pages/**/*.{client,server}.*` | Ignored route support modules | Type declarations, tests, Storybook stories, client-only modules, and server-only modules colocated with pages | Route pages or files that should become URLs |
| `<routing-dir-parent>/layout/index.tsx` | Optional external SPA root layout | One app shell around the discovered SPA route tree | MPA shared chrome, route-specific nested layouts, root layout aliases such as `src/layout.tsx`, or route-directory root layouts such as `src/pages/layout.tsx` |
| `src/pages/<segment>/**/layout.{tsx,ts,jsx,js}` | Nested SPA route layout | Pathless layout routes that wrap child routes at the same URL prefix, such as `src/pages/posts/layout.tsx` | App-wide root shells, MPA shared chrome, `src/pages/layout.tsx`, `layout/index.*` aliases, or non-layout helper folders named `layout` |
| `src/pages/**/error.{ts,tsx,js,jsx}` | Scoped SPA error boundary | React component fallback for errors in that route directory scope and descendants | URL routes, MPA behavior, server errors, or helper modules |
| `src/pages/**/not-found.{ts,tsx,js,jsx}` | Scoped SPA not-found boundary | React component fallback for `notFound()` in that route directory scope and descendants | URL routes, MPA behavior, server 404 responses, or helper modules |
| `<routing-dir-parent>/route-types.d.ts` | Generated SPA navigation types | Editor and type-checker support | Manual edits, imports from app code, template/scaffold source, or MPA mode |
| `**/*.server.{ts,tsx,js,jsx}` with `"use server";` | Recommended server-function module naming | Reachable modules that export named callable server functions | Browser-only helpers, default exports, runtime re-exports, or relying on a directory name for discovery |
| `src/apis/**/*.{ts,tsx,js,jsx}` | Default server file route discovery | Request/Response route modules exporting uppercase HTTP methods | `route.ts` sentinels, `foo.get.ts` method suffix files, bracket/catch-all/optional routes, `middleware`/`middlewares`, default exports, or helper exports from route candidates |
| `src/middleware.{ts,tsx,js,jsx}` | Global server middleware | Hono-compatible middleware that runs before server runtime requests: server file routes, server functions, SSR, PPR, and RSC | API-route-only concerns, matcher config, route handlers, or helper exports |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | API route middleware | Hono-compatible middleware for descendant server file routes in that directory tree | Flat sibling routes such as `api.ts`, global server middleware for server functions/SSR, or matcher config |
| Server route paths and dynamic URL shapes under `src/apis` | Server route collision checks before build output is generated | One server route module per URL path and one parameter naming choice per dynamic URL shape | Parallel `users.ts`/`users/index.ts`, `users/$id.ts`/`users/$userId.ts`, or splitting methods for one path across files |
| `src/features`, `src/components`, `src/lib`, `src/hooks` | No direct framework convention | Domain code, reusable UI, browser-safe helpers, and React hooks | Files that depend on route discovery by filename |

Do not mix ownership models in one app unless you need the lower-level API:

- Use `src/pages` plus `routing` for normal SPA/MPA page routes.
- Use explicit `pages` config only when the output cannot be expressed by
  `src/pages`.
- Use `app.entry` only for a manually bootstrapped single browser app.

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
Keep the rules in four buckets:

1. **Component contract**: route files default-export the page component.
   Rendering metadata lives beside that component. Syntax errors and missing
   default exports are reported during route discovery before the bundler runs.
2. **Filename syntax**: `index.tsx` maps to the directory root. Dynamic segments
   use `$param`; bracket segments such as `[id].tsx`, catch-all segments such as
   `$...slug.tsx`, and optional segments such as `$slug?.tsx` are rejected.
3. **URL segment safety**: dynamic names must be JavaScript identifiers after
   `$`. Static segments must be lowercase URL-safe letters, numbers, `.`, `_`,
   `-`, or `~`. Reserved names such as `$__proto__.tsx`, `$constructor.tsx`,
   `$prototype.tsx`, and `$_splat.tsx` are rejected.
4. **Organization only**: route groups such as `(marketing)` are pathless, so
   `src/pages/(marketing)/about.tsx` maps to `/about`. Malformed group segments
   such as `(marketing` are rejected.

Route discovery only considers `.tsx`, `.jsx`, `.ts`, and `.js` source files.
These colocated files are ignored:

- declarations;
- test/spec files;
- Storybook `*.story.*` and `*.stories.*` files;
- hidden dot paths;
- `*.client.*` client-only modules;
- `*.server.*` server-only modules;
- non-source files;
- `_`-prefixed private route segments.

Put non-route helpers in `_`-prefixed files/folders or outside `src/pages`.

Collision and ordering rules are also deterministic:

- Dynamic siblings cannot differ only by parameter name. Choose one of
  `$id.tsx` or `$userId.tsx` for the same URL shape.
- A route path cannot repeat the same dynamic param name, so
  `teams/$teamId/users/$teamId.tsx` is rejected.
- Flat route files and directory index route files cannot claim the same URL
  path. Choose either `users.tsx` or `users/index.tsx` for `/users`.
- SPA and MPA both order `/` first, parent routes before children, and static
  siblings before dynamic siblings. For example, `users/settings.tsx` ranks
  before `users/$id.tsx`.
- Static siblings use locale-independent code-point ordering: `a-b.tsx`,
  `a.b.tsx`, `a0.tsx`, `a_c.tsx`, `aa.tsx`, and `a~d.tsx` keep that order on
  every machine.
- Examples and config should use `/` separators. Filesystem `\` separators are
  normalized before route parsing so paths and generated route IDs stay the same
  across operating systems.

Before build output is generated, evjs applies the same route checks to
configured paths. It rejects duplicate paths, dynamic URL shapes, route IDs,
empty dynamic params, reserved dynamic params, duplicate dynamic params,
whitespace, query strings, and hashes.

Generated route IDs come from URL paths and normalize separators and
punctuation to underscores. That means `admin/panel.tsx` and
`admin_panel.tsx` both produce `admin_panel` and cannot exist together.

### Route Filename Examples

| File | Result | Notes |
| --- | --- | --- |
| `src/pages/index.tsx` | `/` | Directory root route. |
| `src/pages/docs/index.tsx` | `/docs` | Nested directory root route. |
| `src/pages/users/$userId.tsx` | `/users/$userId` | Dynamic segment; the param name must be a JavaScript identifier. |
| `src/pages/users/settings.tsx` | `/users/settings` | Static sibling; it ranks before `users/$userId.tsx`. |
| `src/pages/(marketing)/about.tsx` | `/about` | Pathless route group; `(marketing)` organizes files without adding a URL segment. |
| `src/pages/posts/layout.tsx` | Layout route for `/posts` | SPA route layout that wraps descendants below `/posts`. |
| `src/pages/_helpers/format.ts` | Ignored | `_`-prefixed files and folders are private to `src/pages`. |
| `src/pages/.draft.tsx` | Ignored | Dot-prefixed files and folders are hidden from route discovery. |
| `src/pages/profile.test.tsx` | Ignored | Test/spec files can be colocated with a page without becoming routes. |
| `src/pages/profile.stories.tsx` | Ignored | Storybook files are never route pages. |
| `src/pages/ClientCard.client.tsx` | Ignored | Client-only modules can be colocated without becoming URL routes. |
| `src/pages/users.server.ts` | Ignored | Server-only modules are not page routes; imported server functions are still handled by the server-function transform. |
| `src/pages/users/[id].tsx` | Rejected | Bracket route syntax is not supported; use `$id.tsx`. |
| `src/pages/files/$...path.tsx` | Rejected | Catch-all segments are not part of the convention. |
| `src/pages/users/$__proto__.tsx` | Rejected | Reserved object-property names are not safe route param names. |
| `src/pages/docs/$_splat.tsx` | Rejected | `_splat` is reserved for wildcard route params. |
| `src/pages/layout.tsx` | Rejected | Use `src/layout/index.tsx` for the SPA root layout. Route layouts must be nested below a route segment. |
| `src/pages/posts/layout/index.tsx` | Rejected | Route layout directory aliases are not part of the convention; use `src/pages/posts/layout.tsx`. |
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

Page files should stay thin:

- read params/search;
- export page-local loaders or rendering metadata;
- compose components from `features/` or `components/`;
- keep business logic in domain modules.

Rendering metadata is literal-only:

- `render` and `hydrate` are string literals;
- `prerender` is `true` or an object literal with `partial`, `delivery`, or
  `revalidate`;
- `prerender.revalidate` is `false` or a positive integer number of seconds;
- `rsc` is a boolean literal for RSC pages.

Malformed page modules are reported with the file path and parser message before
the bundler runs.

## Server Boundary

Server functions have no convention directory. Put callable server functions in
reachable modules that start with `"use server";`, and prefer `*.server.*`
filenames so route discovery ignores colocated server-only files.

```ts
// src/apis/users.server.ts
"use server";

export async function listUsers() {
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
Route groups are pathless, and the same segment safety rules used by page
routes apply here: bracket, catch-all, optional, uppercase static segments,
duplicate path, and duplicate dynamic-shape routes are rejected.

A file under `src/apis` becomes a server route only after it exports an
uppercase HTTP method such as `GET` or `POST`. Files with no route exports are
ignored, so `schema.ts`, `db.ts`, and `types.ts` can be colocated with route
modules. Once a file is a route candidate, it may export only uppercase HTTP
methods; move helpers to plain non-route files, `_`-prefixed private files, or
modules outside the route tree. `route.ts` sentinels, method suffix files such
as `users.get.ts`, lowercase method exports, `middleware`/`middlewares`
exports, default exports, and other helper exports from route candidates are
reported before bundling.

Server file routes live under `src/apis` by default. Server middleware has two
separate scopes and both use Hono's `MiddlewareHandler` signature.

Global server middleware lives at `src/middleware.ts`. It runs before server
runtime requests, including server file routes, server
functions, SSR, PPR, and RSC:

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

API route middleware lives inside the server file-route tree. `src/apis/middleware.ts`
applies to every server file route under `src/apis`, and nested
`src/apis/**/middleware.ts` files apply only to descendant routes. For example,
`src/apis/api/middleware.ts` covers `src/apis/api/users.ts` and nested files
under `src/apis/api/**`, but not the flat sibling route `src/apis/api.ts`:

```ts
// src/apis/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

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
- `apis/` is the default server file route source folder. Use
  `server.routing.dir` when the route tree intentionally lives in another
  folder. `*.server.*` modules can be colocated there when server functions are
  imported by reachable app code.
- `middleware.ts` at `src/` is global server middleware. Nested
  `apis/**/middleware.ts` files are API route middleware for descendant server
  file routes.
- `features/` owns business domains.
- `components/` owns generic UI.
- `lib/` contains browser-safe shared helpers.
- Keep server secrets and Node-only APIs in `*.server.*`, `apis/`, or modules
  imported only by server-only code.
