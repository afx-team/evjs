# complex-routing

Advanced SPA routing through the same Page-and-Route file convention
used by the basic example.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode |
| `src/pages/layout.tsx` | File-convention root layout with navigation |
| `src/pages/page.tsx` | Root Page for `/` |
| `src/pages/posts/page.tsx` | Page for `/posts` |
| `src/pages/posts/$postId/page.tsx` | Dynamic Page for `/posts/:postId` |

## What It Demonstrates

- Canonical `page.tsx` anchors with directory-derived URLs
- Nested routes and dynamic `$postId` directory segments
- File-convention root layout
- Server-function queries from route components
- Search params with `validateSearch`
- Redirects through the `/old-blog` Page lifecycle
- Page hooks such as `usePageParams()` and `usePageSearch()`

This example uses SPA mode because MPA rejects its dynamic route and
router-only React facets. Canonical SPA and MPA apps share the same `page.tsx`
Page-anchor convention; `routing.mode` selects how supported Pages are
materialized.
