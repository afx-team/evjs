# ev SSG Example

This example demonstrates true static generation pages:

- `src/pages/report.tsx`, `src/pages/forecast.tsx`, and
  `src/pages/regions/apac.tsx` export `render = "ssg"`;
- the pages are discovered through the default SPA file router, not MPA mode;
- `ev build` renders each page during the build;
- the generated `dist/client/*.html` files contain the page HTML;
- `/report`, `/forecast`, and `/regions/apac` are represented as static
  documents in `client/manifest.json` and `build-output.json`, not as evjs
  server routes.

It uses the webpack adapter because SSG needs the framework server page renderer
during the production build.

## Run

```bash
npm run build
```

Serve `dist/client` as static files and map each document path to the recorded
HTML file.
