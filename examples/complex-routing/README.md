# complex-routing

Advanced routing patterns with TanStack Router.

## Run

```bash
npm run dev -w example-complex-routing
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Route tree assembly |
| `src/pages/__root.tsx` | Root layout with navigation |
| `src/pages/home.tsx` | Index route |
| `src/pages/posts/` | Nested routes with loader |

## What It Demonstrates

- Dynamic route params (`$postId`)
- Pathless layout routes
- Route loaders with `queryClient.ensureQueryData`
- Search params with `validateSearch`
- Catch-all 404 route
- Type-safe `route.useParams()`
