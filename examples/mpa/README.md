# mpa

Minimal multi-page application example using evjs `pages` config.

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Enables file-route MPA mode |
| `index.html` | Shared HTML template for all pages |
| `src/pages/home.tsx` | Home page component |
| `src/pages/about.tsx` | About page component |

## What It Demonstrates

- Multi-page build via `fileRoutes.mode: "mpa"`
- Independent router-free React page for each file route
- Shared HTML template reused by all pages
- Static links between pages
