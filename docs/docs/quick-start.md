# Quick Start

## Create A Project

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

The development server prints the selected browser and server URLs.

## Define The Application

Create `ev.config.ts` and choose the output mode:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

Create two Page routes:

```text
src/pages/
├── page.tsx                         # /
└── about/
    └── page.tsx                     # /about
```

```tsx
// src/pages/page.tsx
import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About</Link>
    </main>
  );
}
```

```tsx
// src/pages/about/page.tsx
export default function AboutPage() {
  return <h1>About</h1>;
}
```

`page.*` is the Page and Route anchor. Its relative directory determines the
URL, so there is no separate route declaration.

When a Page needs build-time capabilities, add `page.config.ts` beside it:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "About",
  meta: {
    description: "About this application",
    keywords: "evjs,about",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
});
```

`title` and `meta` are static core Page metadata. `meta` emits only
`<meta name="..." content="...">` entries. Plugin-owned values use registered
namespaced keys under `extensions`; those extension values are not
automatically sent to browser runtime.

## Page-Private Code

Keep components, hooks, models, services, tests, styles, and assets inside the
Page directory:

```text
src/pages/about/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── use-about.ts
└── components/
    └── Team.tsx
```

Only `page.*` creates a Page and Route. Every other file, including `index.*`,
is ordinary private source and needs no `_` prefix.

## Add A Dynamic Route

Use a `$param` directory:

```text
src/pages/
└── users/
    └── $userId/
        └── page.tsx                 # /users/:userId
```

```tsx
// src/pages/users/$userId/page.tsx
import { usePageParams } from "@evjs/ev/route";

export default function UserDetailPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

Static directories create static URL segments. A terminal `$...splat`
directory creates a catch-all, and `(group)` organizes routes without adding a
URL segment.

## Switch To MPA

The Page tree does not move. Change only the materialization mode:

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

SPA materializes the tree as browser Client Routes, normally under one shared
Document. MPA starts from the same semantic Pages and Routes and materializes
Page-owned Documents. A Page-local `index.html` can provide its MPA Document
template. MPA accepts only static Page paths: `$param`, terminal
`$...splat`, and router-only boundaries fail during inspect/build. Layouts
compose in both modes.

## Add A Server Function

Server functions can live beside the Page that calls them:

```ts
// src/pages/get-message.server.ts
"use server";

export async function getMessage() {
  return "Hello from the server";
}
```

```tsx
// src/pages/page.tsx
import { useQuery } from "@evjs/ev/query";
import { getMessage } from "./get-message.server";

export default function HomePage() {
  const { data } = useQuery(getMessage);
  return <h1>{data}</h1>;
}
```

## Add A Server Route

Server request Routes use a separate positive `api.*` anchor under `src/apis`:

```ts
// src/apis/api/health/api.ts
export function GET() {
  return Response.json({ ok: true });
}
```

The containing `api/health` directory creates `/api/health`. Client `page.*`
routes and server request Routes are separate systems with symmetric positive
anchors.

## Build

```bash
npm run build
```

By default:

- client output goes to `dist/client`;
- server output goes to `dist/server`;
- framework-generated IR lives under `.ev`.

Treat `.ev`, `dist`, `src/route-types.d.ts`, and other generated artifacts as
outputs. Do not edit them or copy them into templates.

## Core Packages

| Package | Purpose |
| --- | --- |
| `@evjs/cli` | `ev dev`, `ev build`, `ev inspect`, and related commands |
| `@evjs/ev` | Config, plugins, build graph, deployment helpers, and app-facing subpaths |
| `@evjs/ev/route` | Page params, search, and loader-data helpers |
| `@evjs/ev/navigation` | `Link`, navigation, redirects, and outlets |
| `@evjs/ev/query` | Server-function query and mutation helpers |
| `@evjs/ev/server-context` | Request-context helpers |
| `@evjs/ev/transport` | Custom client/server transport helpers |
| `@evjs/client` | Standalone browser runtime primitives |
| `@evjs/server` | Standalone server runtime primitives |

Framework-owned Page applications import from `@evjs/ev` and its curated
subpaths. Use `@evjs/client` and `@evjs/server` directly only for intentional
standalone/manual runtime composition.

## Choose One Route Input

For file-convention routing, put each published Page in the directory for its
URL, name the entry `page.*`, keep Page settings in adjacent
`page.config.ts`, and declare `routing.mode: "spa" | "mpa"`.

Explicit `application.routes` is a separate SPA-only configuration input. It
supports `page` or `component`, nested `routes`, layouts, wrappers, redirects,
and registered namespaced Route extensions. It cannot be combined with `routing` and never
selects MPA.

An unrelated `src/pages` directory alone does not publish client routes. Run
`ev inspect` to verify the normalized Page/Route structure.

Next, read [Project Structure](./project-structure),
[Client Routes](./client-routes), and [Configuration](./config).
