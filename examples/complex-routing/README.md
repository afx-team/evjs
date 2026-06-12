# complex-routing

Advanced routing patterns with TanStack Router.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/layout.tsx` | SPA root layout with navigation |
| `src/pages/index.tsx` | Index route |
| `src/pages/posts/` | Nested routes with loader |

## What It Demonstrates

- Dynamic route params (`$postId`)
- SPA root layout
- Route loaders with `queryClient.ensureQueryData`
- Search params with `validateSearch`
- Catch-all 404 route
- Page hooks such as `usePageParams()` and `usePageSearch()`
