# evjs Core 0.3 Design RFC

Status: accepted authoring direction; implementation and adapter coverage are
being delivered incrementally.

This RFC defines the Core 0.3 Page-and-Route model shared by SPA and MPA
applications. It also defines how Bigfish, Smallfish, and evjs 0.2 source
models move to canonical authoring.

## Decision

Core 0.3 has one canonical Page model:

```text
src/pages/
├── page.tsx
├── page.config.ts
├── about/
│   └── page.tsx
└── users/
    └── $userId/
        ├── page.tsx
        ├── page.config.ts
        └── components/
            └── Profile.tsx
```

- `page.tsx` is the positive Page and client-route anchor.
- Its containing directory is the Page ownership scope and determines the URL.
- Adjacent `page.config.ts` is optional build-time Page configuration.
- `routing.mode` chooses SPA or MPA materialization for the same semantic Page
  and Route tree.
- Colocated files, including `index.tsx`, remain ordinary Page-private source.
- Plugin-owned Page configuration lives under namespaced `extensions`.
- Core `title` and named `meta` are materialized by the framework. A plugin
  must explicitly project any extension data or behavior it needs at runtime.

The minimal application config is:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa", // or "mpa"
  },
});
```

There is no second canonical `application.routes` tree and no SPA/MPA-specific
Page filename.

## Goals

1. Let Bigfish SPA and Smallfish MPA applications migrate without first
   adopting a third Page ownership model.
2. Give Page identity, scope, route identity, and Page capability data the same
   meaning in both modes.
3. Separate build-time configuration from executable runtime code.
4. Give plugins stable, namespaced Page configuration and normalized graph
   owners.
5. Make source migration explicit without turning stored framework dialects
   into permanent runtime readers.

Core 0.3 does not promise one-to-one Bigfish or Smallfish API compatibility.
The target is equivalence in the central mental model: application mode,
Page/Route definition, Page-private code, Page-level capabilities, and plugin
migration boundaries.

## Source Research

The design follows behavior in the current Bigfish and Smallfish sources, not
only their public API names.

### Bigfish

Bigfish currently has multiple Page-config lanes:

- explicit SPA route configuration is available to build plugins and is
  serialized into runtime route objects;
- convention SPA `routeProps` is bundled and spread into route definitions at
  browser runtime, so build plugins do not receive the same concrete value.

This split makes migration ambiguous: the same-looking Page metadata may be
build-time data, runtime route data, or both. Core 0.3 replaces those canonical
lanes with one build-time `page.config.ts` input and requires explicit runtime
projection.

### Smallfish

Smallfish discovers direct-child Page directories with `index.*`, reads
`config.json`, merges Page defaults, and creates a Page instance before
entries and HTML are generated. Plugins extend the Page schema and decide how
individual fields affect HTML, generated entry code, or server/runtime data.

The useful invariant is not the JSON filename. It is that configuration belongs
to a stable Page owner and is resolved before plugins materialize output.
Core 0.3 keeps that invariant while moving canonical authoring to typed,
namespaced `page.config.ts`.

## Canonical Page and Route Convention

Each directory containing exactly one supported `page.*` module creates one
Page and one semantic client Route:

```text
<routing.dir>/**/page.{ts,tsx,js,jsx}
```

`routing.dir` defaults to `./src/pages`. Route segments come from directories:

| Directory | Semantic path |
| --- | --- |
| `src/pages/page.tsx` | `/` |
| `src/pages/users/page.tsx` | `/users` |
| `src/pages/users/$userId/page.tsx` | `/users/:userId` |
| `src/pages/files/$...splat/page.tsx` | `/files/*` |
| `src/pages/(account)/settings/page.tsx` | `/settings` |

Only `page.*` is an anchor. The complete containing directory is private to
that Page unless a descendant directory has another `page.*`:

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── request.server.ts
└── components/
    └── Summary.tsx
```

Private scope is a framework ownership/discovery boundary, not JavaScript
access control. No `_` prefix is required.

## `page.config.ts` Contract

The recommended form is:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Checkout",
  meta: {
    description: "Complete and review your order.",
    keywords: "checkout,orders",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/analytics": {
      channel: "checkout",
      enabled: true,
    },
  },
});
```

`page.config.js` is also accepted. A Page directory may contain only one of
the supported config variants.

### Evaluation

evjs evaluates the module while constructing the build graph:

- the module must default-export a plain object;
- evaluation is synchronous and build-only;
- TypeScript and project-local imports are allowed;
- project-local transitive dependencies are graph/watch inputs;
- the resolved value must contain static JSON data;
- unknown top-level fields are rejected.

The resolved object cannot contain functions, Promises, symbols, bigint,
non-finite numbers, class instances, accessors, sparse arrays, cycles, or unsafe
object keys. `definePageConfig()` is an identity helper for type inference; it
does not defer evaluation to runtime.

The module should therefore be deterministic and side-effect free. Secrets and
request-specific values do not belong in it.

### Core fields

Core owns these author-facing Page fields:

| Field | Meaning |
| --- | --- |
| `title` | Static Page document title. |
| `meta` | Static string record materialized as `<meta name="key" content="value">`. |
| `render` | `"csr"`, `"ssr"`, or `"ssg"`; defaults to `"csr"`. |
| `hydrate` | `"none"`, `"load"`, `"visible"`, or `"idle"`. |
| `prerender` | `true` or `{ partial?, delivery?, revalidate? }`. |
| `rsc` | `true` to select the RSC component model. |

`meta` covers named metadata such as `description`, `keywords`, `viewport`,
and `theme-color`. It deliberately does not model `property`, `charset`,
`link`, `script`, executable/dynamic metadata, or a general head DSL. Every
title, meta name, and meta content value is static build-time data.

Title/meta materialization follows Page ownership:

- an MPA or SSG Page materializes missing title/meta tags and overrides
  matching title and `meta[name]` values from its Document template; omitted
  values retain the template baseline;
- an SPA uses the deepest active Page without parent Page metadata
  inheritance; navigation restores template baseline values or removes values
  that the next Page does not declare;
- an MPA Page-specific `index.html` remains a template baseline rather than a
  second metadata model;
- plugin `transformHtml` hooks run after framework metadata materialization
  and may explicitly override generated HTML.

The build validates combinations:

- RSC requires `render: "ssr"` and `hydrate` omitted or `"none"`;
- partial prerendering requires `render: "ssr"`;
- RSC and partial prerendering cannot be combined on one Page;
- full prerendering requires an explicit `"ssr"` or `"ssg"` render mode.

These values normalize into the CoreGraph rendering extension and then into
the existing rendering BuildPlan. They do not change Page or Route identity.
Adapter/runtime coverage can still reject a combination that the selected
backend cannot materialize.

Static `render`, `hydrate`, `prerender`, and `rsc` exports from `page.tsx` are
not canonical configuration. Move those settings to `page.config.ts` before
running a migrated application on Core 0.3.

### Plugin extensions

Plugin-owned data must use a globally namespaced key:

```ts
export default definePageConfig({
  extensions: {
    "@company/tracert": {
      spm: "a1.b2",
    },
    "@company/access": {
      role: "operator",
    },
  },
});
```

Each namespace must be registered by one plugin `pageExtension()`
declaration. The plugin owns defaults, merge behavior, validation, schema
version:

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const accessPlugin = definePlugin({
  name: "@company/access-plugin",
  describe(api) {
    api.pageExtension({
      namespace: "@company/access",
      defaults: { role: "guest" },
      validate(value) {
        return typeof value.role === "string" || "role must be a string";
      },
    });
  },
  contributions(ctx) {
    for (const page of ctx.framework.pages) {
      const access = page.extensions["@company/access"];
      // Generate only the build/runtime artifact this capability requires.
      console.log(page.id, access);
    }
  },
});
```

An unregistered namespace is an error. Two plugins cannot own the same
namespace.

### Build-time and runtime phases

`page.config.ts` is not bundled as a browser module. Core extracts and
materializes the supported title/meta/rendering fields; the full config object
and plugin extensions are not automatically serialized into HTML, route
objects, or a global runtime manifest.

```text
page.config.ts
  -> build-time static evaluation
  -> validate core fields and registered extension namespaces
  -> normalized CoreGraph Page fields and extensions
  -> core title/meta/rendering materialization
  -> optional explicit plugin runtime projection
```

A build-only plugin can stop at graph or HTML generation. A runtime capability
must explicitly emit the minimal data/module it needs and attach it through a
supported generated contribution. This keeps secrets and build-only fields out
of browser bundles and makes the runtime cost inspectable.

The current generated-contribution API has topology-specific entry/Document
targets. A plugin must not assume every SPA Page owns an independent entry or
every SPA Page owns an HTML Document. Topology-neutral `page.module` and
`page.activation` facets remain a later plugin migration step.

## Normalized Core Model

Canonical discovery and the explicit route-tree normalizer produce the same
owners:

```text
CoreGraph
├── Application
├── Page
├── Route
├── Document
└── extension registry
```

A Page records its component module, optional config source, directory scope,
owning Application, extensions, and provenance. A Route targets a Page,
redirect, group, or Document without becoming the Page itself. A Document owns
template/output/bootstrap concerns separately from Page identity.

The distinction matters across modes:

| Semantic owner | SPA materialization | MPA materialization |
| --- | --- | --- |
| Application | One browser application and route tree | One logical owner across Page entries |
| Page | Target of one Client Route | Owner of an independent Page entry |
| Route | Client Route | Static Document Route where supported |
| Document | Normally Application-owned | Normally one Page-owned Document per Page |
| Page config | Same normalized Page title/meta/rendering/extensions | Same normalized Page title/meta/rendering/extensions |

Switching `routing.mode` can change entries and Documents. It cannot rename a
Page, change its source scope, or select another configuration dialect.

## SPA and MPA Page-Level Configuration

Both modes discover the same adjacent config module:

```text
src/pages/report/
├── page.tsx
└── page.config.ts
```

In SPA, title/meta, rendering fields, and extensions attach to the Page
targeted by the browser route tree. The deepest active Page owns title/meta;
there is no parent Page metadata inheritance. In MPA, the same Page owns an
independent entry and Document, and its title/meta materialize missing tags
and override matching template baseline values. A plugin sees the same Page id
and extension value in either mode; only its output attachment may differ.

Page config deliberately does not own the URL, Page component path, or Page
identity. Those come from the `page.tsx` anchor and directory. It also does not
replace the shared HTML template or an MPA Page's adjacent `index.html`; those
templates supply baseline document markup.

## Migration Inputs

Migration support reduces conversion cost but does not create more canonical
models.

| Existing source | Required migration | Canonical destination |
| --- | --- | --- |
| Bigfish explicit SPA route config | The existing explicit route tree may normalize `component`, `children`, wrappers, layouts, and redirects temporarily; it implies SPA, cannot be combined with `routing`, and rejects MPA topology. Plugin-owned route metadata is not copied implicitly. | Move each Page to its URL directory as `page.tsx`; move Page capabilities to `page.config.ts`; move plugin-owned static values to registered extensions; after removing `application`, enable the canonical tree with only `routing.mode: "spa"` |
| Bigfish convention `routeProps` | Move static capability data into registered `extensions`; let the plugin explicitly project runtime data | Use the canonical Page tree and namespaced `page.config.ts` extensions |
| Smallfish directory Pages | Rename or move each direct-child `index.*` entry to the directory for its public URL as `page.tsx`; map `config.json` title and supported named meta to core `title`/`meta`, move remaining plugin-owned values to extensions, and delete `config.json` | Use the canonical Page tree with `routing.mode: "mpa"` |
| evjs 0.2 recursive routes | Move each published filename route to its URL directory as `page.tsx`; move component rendering exports and Page settings to `page.config.ts` | Use the canonical Page tree and configure only `routing.mode` |
| `application.routes`, removed `app`, `pages`, and top-level `routes` | Keep only `application.routes` temporarily for a Bigfish SPA tree; removed declarations produce migration errors | Prefer the canonical Page tree; standalone runtimes own their entry outside Framework config |

New canonical Pages must not create `config.json`. Map static document title
and supported named meta to core `title`/`meta`; move other owned capability
values to namespaced `page.config.ts` extensions in the same source migration.

The explicit route-tree normalizer preserves source provenance before Page
extensions run. Smallfish and evjs 0.2 source conversion must be
complete before canonical discovery; an arbitrary `src/pages` file never
selects another runtime reader.

## Migration Sequence

For an existing application:

1. Inventory the current public URLs, Page entries, and Page-owned settings.
2. Establish one stable Page directory for each published Page.
3. Move or rename the Page component entry to `page.tsx`.
4. Move ordinary Page-private code beside it; remove `_` prefixes when
   convenient.
5. Create `page.config.ts`; move static title/named meta and rendering settings
   into core fields, and plugin-owned values into namespaced extensions.
6. Make runtime projection explicit in the owning plugin.
7. Smallfish and evjs 0.2 migrations configure only `routing.mode`; do not add
   a source-reader switch. A Bigfish explicit SPA tree remains under
   `application.routes` without `routing` until its source conversion is done.
8. Run `ev inspect` and compare the Page/Route/Document graph, generated
   contributions, HTML, and runtime behavior. After a Bigfish file tree is
   canonical, remove `application` and enable it with
   `routing.mode: "spa"`.

## Rejected Alternatives

### Keeping three parallel canonical routing models

Keeping Bigfish config routes, Smallfish directory Pages, and evjs filename
routes as equal public models would preserve the migration problem inside the
new core. Bigfish explicit routes may enter one normalizer temporarily;
Smallfish and evjs source trees are converted before canonical discovery.

### `index.tsx` as the universal anchor

It would make ordinary barrels/components ambiguous again and would not solve
recursive Page-private discovery. A positive `page.tsx` marker makes ownership
explicit.

### Canonical `config.json`

JSON is insufficient for typed extension inference and does not identify which
plugin owns an arbitrary capability key. Map title and supported named meta to
core `page.config.ts` fields, migrate remaining plugin-owned values to
namespaced extensions, and delete it.

### Importing `page.config.ts` in the browser

This would collapse build-time and runtime phases, risk leaking build-only
values, and force every Page config into client bundles. The framework
projects only supported core title/meta behavior; plugin runtime projection
must stay explicit.

### Executable functions in Page config

Functions cannot be validated or serialized as stable graph data. Executable
behavior belongs in Page modules or plugin-generated runtime modules referenced
through explicit contribution contracts.

## Next Stage: Plugin Migration

After the Page/config contract is stable, the next stage is to map existing
Bigfish and Smallfish plugin behavior by semantic owner and phase:

- config schema/default/validation -> `describe().pageExtension()`;
- static Page title/named meta -> core Page metadata;
- plugin-owned Page build metadata -> normalized Page extensions;
- route definition behavior -> Route facets;
- entry/runtime injection -> Application/Page/Document runtime facets;
- head/script/style/template behavior -> Document facets;
- server middleware/endpoints -> server request facets;
- platform deployment output -> deployment/output extensions.

The migration target is not a hook-name emulator. It is enough semantic
coverage that existing plugins can move capability by capability without
rebuilding their Page ownership model.
