# plugin-authoring

Demonstrates the evjs plugin system with all available hooks:

- **`bundlerConfig`** — modify the underlying bundler config (type-safe via `utoopack()` helper)
- **`buildStart`** — run logic before compilation begins
- **`buildEnd`** — run logic after compilation completes
- **`transformHtml`** — modify the parsed HTML document after asset injection with current HTML context

## Run

```bash
npm run dev
```

## What to look for

1. Console output from `buildStart` and `buildEnd` hooks during build
2. The `<!-- Built with evjs | file.html | N asset(s) -->` comment in the output HTML (injected by `transformHtml`)
3. `.txt` file support added via the `bundlerConfig` hook (utoopack raw rule)
