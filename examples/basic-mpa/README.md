# basic-mpa

Minimal multi-page application example using evjs `pages` config.

## Run

```bash
npm run dev -w example-basic-mpa
```

## Build

```bash
npm run build -w example-basic-mpa
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Enables MPA mode and defines page entries |
| `index.html` | Shared HTML template for all pages |
| `src/home/main.tsx` | Home page React entry |
| `src/about/main.tsx` | About page React entry |

## What It Demonstrates

- Multi-page build via `pages`
- Independent React entry for each page
- Shared HTML template reused by all pages
- Static links between pages
