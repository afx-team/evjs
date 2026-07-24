# basic

The standard starting point for an evjs application. It demonstrates the
unified Core 0.3 Page-and-Route file convention alongside server functions.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode |
| `src/pages/layout.tsx` | File-convention root layout |
| `src/pages/page.tsx` | Root Page mapped to `/` |
| `src/pages/page.config.ts` | Static root Page title/meta and CSR rendering config |
| `src/pages/about/page.config.ts` | Route-specific title/meta for `/about` |
| `src/pages/components/index.tsx` | Page-scoped component; its `index.tsx` never creates a route |
| `src/pages/about/components/RouteCard.tsx` | Ordinary page-scoped component without a private prefix |
| `src/apis/users.server.ts` | `"use server"` CRUD functions |

## What It Demonstrates

- One `page.tsx` anchor convention for static, dynamic, and search-param routes
- Static `title` and named `meta` in the same build-time `page.config.ts`
  contract as rendering and plugin capabilities
- SPA navigation applies the deepest active Page metadata without inheriting
  metadata from parent Pages
- `/about` intentionally omits `keywords` and `viewport`: navigation removes
  the root Page keyword and restores the HTML template viewport baseline
- URL paths derived from Page directories, including `users/$userId/page.tsx`
- Colocated Page code without `_` prefixes; only `page.tsx` creates a Page
- `"use server"` directive for auto-discovered server functions
- `useQuery(getUsers)` for type-safe data fetching
- `useMutation({ mutationFn: createUser })` for server-side mutations
- `getFnQueryKey(getUsers)` for cache invalidation
