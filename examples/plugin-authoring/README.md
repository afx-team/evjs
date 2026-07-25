# plugin-authoring

Demonstrates one evjs plugin API combining Application, Page, Route, and
Document extension declarations with the lifecycle hooks used by ordinary
build-time extensions.

- **top-level `extensions`** — author static, namespaced Application data
- **`page.config.ts`** — author static, namespaced Page and unique-Route data
- **one extension registry** — register Application, Page, Route, and Document owners of one namespace
- **`setup`** — read the resolved Application value before graph analysis
- **`contributions`** — read all four resolved owner bags from semantic graph views
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
layout, `ev.config.ts` configures the Application extension, and
`src/pages/page.config.ts` configures the Page and its unique Route. The
Document declaration supplies a default for the SPA's Application-owned
Document; a CSR SPA Page does not own a separate Document. All four owners use
the same `@example/metadata` namespace and schema version. These build-time
values are not automatically serialized into browser runtime.

## Run

```bash
npm run dev
```

## What to look for

1. The resolved Application `@example/metadata` value in `setup`
2. The resolved Page, Route, and Document `@example/metadata` values in `contributions`
3. Console output from `buildStart` and `buildEnd` hooks during build
4. The `<!-- Built with evjs | file.html | N asset(s) -->` comment in the output HTML (injected by `transformHtml`)
5. The type-safe `.txt` rule declaration in the `bundlerConfig` hook
