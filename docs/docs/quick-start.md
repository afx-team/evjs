# Quick Start

Create a small application with two pages, a server function, and an API route.

## Create the project

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

Open the browser URL printed by the development server.

## Choose SPA or MPA

Create `ev.config.ts`:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

Use `"spa"` for client-side navigation, nested routes, and dynamic paths. Use
`"mpa"` when every page has a static path and should load as an independent
HTML document.

## Add pages

Create this tree:

```text
src/pages/
├── page.tsx                         # /
└── about/
    └── page.tsx                     # /about
```

```tsx title="src/pages/page.tsx"
import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About this app</Link>
    </main>
  );
}
```

```tsx title="src/pages/about/page.tsx"
export default function AboutPage() {
  return <h1>About</h1>;
}
```

`page.*` creates the page and route. Its directory determines the URL, so there
is no separate route table to update.

## Configure one page

Add static metadata or choose a rendering mode in an adjacent
`page.config.ts`:

```ts title="src/pages/about/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "About",
  meta: {
    description: "About this application",
  },
  render: "csr",
});
```

The file is optional. CSR is the default. See [Rendering](./rendering) before
selecting SSR, SSG, PPR, or RSC.

## Colocate page code

Files beside a page remain ordinary source unless they match another framework
file convention:

```text
src/pages/about/
├── page.tsx
├── page.config.ts
├── model.ts
├── about.css
└── components/
    └── Team.tsx
```

Components, hooks, models, tests, styles, and assets do not need an `_` prefix.

## Add a dynamic route

SPA projects can use a `$param` directory:

```text
src/pages/users/$userId/page.tsx     # /users/:userId
```

```tsx title="src/pages/users/$userId/page.tsx"
import { usePageParams } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

Use a terminal `$...splat` for a catch-all and `(group)` to organize routes
without adding a URL segment. MPA projects accept static page paths only.

## Call server code

Create a module that begins with `"use server";`, export a named function, and
import it from the application:

```ts title="src/pages/get-message.server.ts"
"use server";

export async function getMessage() {
  return "Hello from the server";
}
```

Call it from a page with the query helpers:

```tsx title="src/pages/page.tsx"
import { useQuery } from "@evjs/ev/query";
import { getMessage } from "./get-message.server";

export default function HomePage() {
  const { data } = useQuery(getMessage);
  return <h1>{data}</h1>;
}
```

## Add an HTTP endpoint

Create an `api.*` file under `src/apis` and export uppercase HTTP methods:

```ts title="src/apis/health/api.ts"
export function GET() {
  return Response.json({ ok: true });
}
```

The endpoint is available at `/health`. API routes use standard Web
`Request` and `Response` values. Read
[API Routes and Middleware](./server-routes) for parameters and middleware.

## Inspect and build

Before a production build, inspect the routes and rendering choices:

```bash
npx ev inspect
npm run build
```

Browser output is written to `dist/client` by default. Applications using
server functions, API routes, or request-time rendering also produce
`dist/server`.

Treat `.ev`, `dist`, `src/route-types.d.ts`, and `src/plugin-types.d.ts` as
generated output. Do not edit or copy them into application templates.

## Next steps

- [Project Structure](./project-structure) for directory responsibilities and
  every recognized file.
- [Pages and Routing](./client-routes) for layouts, nested routes, and
  navigation.
- [Local Development](./dev) for ports, proxies, and HTTPS.
- [Deployment](./deploy) for choosing a production target.
