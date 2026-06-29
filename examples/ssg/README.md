# ev SSG Example

This example demonstrates a true static generation page:

- `src/pages/report.tsx` exports `render = "ssg"`;
- the page is discovered through the default SPA file router, not MPA mode;
- `ev build` renders the page during the build;
- the generated `dist/client/report.html` contains the page HTML;
- `/report` is represented as a `static-page` route in `build-output.json`.

It uses the webpack adapter because SSG needs the framework server page renderer
during the production build.

## Run

```bash
npm run build
```

Serve `dist/client` as static files and map `/report` to `report.html`.
