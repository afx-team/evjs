# basic-csr

Minimal client-side rendering example — no server functions, just routing.

## Run

```bash
npm run dev -w example-basic-csr
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | App bootstrap with `createApp` |
| `src/pages/` | Route components (Home, Posts) |

## What It Demonstrates

- `createApp` + `createRoute` from `@evjs/runtime`
- Client-side routing with TanStack Router
- Dynamic route params (`$postId`)
- No server functions — pure CSR
