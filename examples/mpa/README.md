# mpa

Minimal multi-page application example using evjs page routing.

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
| `ev.config.ts` | Enables page MPA mode |
| `index.html` | Shared HTML template for all pages |
| `src/pages/home.tsx` | Home page component |
| `src/pages/about.tsx` | About page component |

## What It Demonstrates

- Multi-page build via `routing.mode: "mpa"`
- Independent router-free React page for each page file
- Shared HTML template reused by all pages
- Static links between pages
- No `@evjs/client`, `@evjs/server`, or generated `route-types.d.ts`
  dependency is needed for this router-free client output
