# with-tailwind

Tailwind CSS v4 through the evjs PostCSS pipeline and unified Core 0.3 Page
model.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode and output directories |
| `src/pages/page.tsx` | Root Page using Tailwind utilities |
| `src/pages/layout.tsx` | File-convention root layout importing global styles |
| `src/styles.css` | Tailwind CSS entry |
| `postcss.config.mjs` | PostCSS and Tailwind configuration |
