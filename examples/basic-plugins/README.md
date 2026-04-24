# basic-plugins

Demonstrates the evjs plugin system with all available hooks:

- **`bundler`** — modify the underlying bundler config (type-safe via `utoopack()` helper)
- **`buildStart`** — run logic before compilation begins
- **`buildEnd`** — run logic after compilation completes
- **`transformHtml`** — modify the parsed HTML document after asset injection

## Run

```bash
npm run dev
```

## What to look for

1. Console output from `buildStart` and `buildEnd` hooks during build
2. The `<!-- Built with evjs | N asset(s) -->` comment in the output HTML (injected by `transformHtml`)
3. `.txt` file support added via the `bundler` hook (utoopack raw rule)
