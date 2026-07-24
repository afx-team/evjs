# plugin-authoring

Demonstrates one evjs plugin API combining Page extension declarations with
the lifecycle hooks used by ordinary build-time extensions.

- **`page.config.ts`** — author static, namespaced Page extension data
- **`definePlugin` / `describe`** — register defaults and validation for that namespace
- **`contributions`** — read resolved metadata from semantic Page views
- **`config`** — update framework config before defaults are resolved
- **`bundlerConfig`** — modify the underlying bundler config (type-safe via `utoopack()` helper)
- **`buildStart`** — run logic before compilation begins
- **`buildEnd`** — run logic after compilation completes
- **`transformHtml`** — modify the parsed HTML document after asset injection with current HTML context

For plugins that need to declare generated `.ev` artifacts and attach them to
framework slots, see the generated contributions documentation.

Existing lifecycle plugins remain supported by the same `Plugin` shape, so
capabilities can move into `describe()` and semantic contributions
incrementally. Typed runtime hooks and semantic facet attachment are not
implemented yet; see the
[plugin migration guide](../../docs/docs/plugin-migration-0.2-to-0.3.md)
before porting those behaviors.

The application itself uses the unified Core 0.3 model:
`src/pages/page.tsx` defines `/`, `src/pages/layout.tsx` supplies the SPA root
layout, `src/pages/page.config.ts` configures the Page extension at build time,
and `ev.config.ts` only selects `routing.mode`. The configured value is visible
to `contributions()`; it is not automatically serialized into browser runtime.

## Run

```bash
npm run dev
```

## What to look for

1. The `@example/page-metadata` value from `page.config.ts` in the
   `contributions` hook
2. Console output from `buildStart` and `buildEnd` hooks during build
3. The `<!-- Built with evjs | file.html | N asset(s) -->` comment in the output HTML (injected by `transformHtml`)
4. The type-safe `.txt` rule declaration in the `bundlerConfig` hook
