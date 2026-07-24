# ev SSG Example

This Core 0.3 example demonstrates true static generation with the canonical
Page-and-Route convention:

- `src/pages/report/page.tsx`, `src/pages/forecast/page.tsx`, and
  `src/pages/regions/apac/page.tsx` are the Page anchors;
- each adjacent `page.config.ts` declares `render: "ssg"`;
- the report and nested APAC Page configs also declare static `title` and named
  `meta`, which are materialized into their generated HTML documents;
- the forecast intentionally omits Page metadata, so its generated document
  retains the shared HTML template baseline;
- the containing directories derive `/report`, `/forecast`, and
  `/regions/apac` without an additional route map;
- `routing.mode: "spa"` selects SPA materialization without changing the Page
  tree;
- `ev build` renders each page during the build;
- the generated `dist/client/*.html` files contain the page HTML and
  Page-owned metadata;
- `/report`, `/forecast`, and `/regions/apac` are represented as `static-page`
  routes referencing emitted documents in `deployment-metadata.json`, not as
  server routes.

It uses the webpack adapter because SSG needs the framework server page renderer
during the production build.

## Run

```bash
npm run build
```

Serve `dist/client` as static files and map each document path to the recorded
HTML file.
