# Bigfish and Smallfish Migration to Core 0.3

This document records the source-backed migration contract for applications
and plugins moving from Bigfish or Smallfish to evjs Core 0.3. It is a
capability map, not a compatibility-mode specification.

## Audited source baseline

The conclusions below were checked against these source snapshots:

| Framework | Source revision | Package baseline |
| --- | --- | --- |
| Bigfish | `dcdd27c5dcd71cd0cd7ed9659dfce07f7923f7a7` | `@alipay/bigfish` `4.5.55`, Umi/Max `4.6.51` |
| Smallfish | `cda767b734c114c555691eaac568ed1a5c1e33d5` | Core/runtime/plugin packages `2.96.11` |

The audit separates framework behavior from nearby ecosystem packages. OneAPI,
Bakery, CAPR, HD, Tracert, Tern, UBOA, offline packaging, and deployment
platform integrations are migration consumers of Core mechanisms; they are
not new built-in routing models.

## Source facts that constrain the design

### Bigfish is SPA-only

Bigfish's supported Application model is one SPA route tree. Its `site`
application type enables static export for that SPA; it does not define a
Bigfish MPA model. Umi contains lower-level experimental MPA code, but Bigfish
does not expose, adapt, or validate it as a supported application type.

Bigfish therefore enters Core 0.3 in one of two ways:

- a temporary SPA-only `application.routes` migration input; or
- the canonical Page tree with `routing.mode: "spa"`.

There is no `Bigfish MPA` migration lane.

### Bigfish Route and Page identities are different

Bigfish's explicit route tree is the primary application structure. A Route
can be a Page target, redirect, pathless group, layout, or wrapper. The same
component can be referenced by more than one Route, and a componentless Route
can still carry plugin data.

Umi's route normalization preserves extra route properties. Existing plugins
consume route-owned values such as:

- access control: `access`;
- layout and menu data: `name`, `title`, `icon`, `flatMenu`;
- qiankun: `microApp`, `microAppProps`;
- BOP: `menuKey`, `menuAssetOptions`;
- tracing: `spmBPos`.

These values cannot be collapsed into Page config. Core 0.3 uses one
namespaced extension registry with Route ownership for plugin-defined route
data. Core route structure remains explicit and validated; registered
extensions do not become an untyped metadata bag.

### Smallfish is Page-entry MPA

Smallfish discovers direct children of its Pages directory, selects
`index.{tsx,ts,jsx,js}`, reads adjacent `config.json`, creates one Page
instance, one client entry, and one HTML output for each Page, and then lets
plugins contribute Page-scoped build behavior.

Smallfish Page directories already form a useful private-code scope. The
migration changes the positive anchor, not that ownership invariant:

```text
src/pages/checkout/
├── index.tsx       # preserved implementation and import target
├── page.tsx        # generated thin re-export of ./index
├── config.json     -> page.config.ts
├── model.ts
└── components/
```

Smallfish defaults to `<name>.html`. Its `router` field can select another
nested output such as `shop/checkout.html`, and can contain dynamic
`:param` segments that are rewritten by the Smallfish runtime. Those output
and request-rewrite semantics are not equivalent to evjs's canonical
directory-derived URL by renaming files alone. A migration must either
materialize a validated output mapping through a general Document capability
or report the URL as an explicit blocker. It must not silently change a
published URL.

### Neither source framework requires deferred hydration modes

Bigfish and Smallfish use normal CSR mounting or immediate hydration for
server-produced markup. Their source does not establish `visible` or `idle`
hydration as a migration requirement. Core Page config therefore keeps the
small contract `"none" | "load"`.

## One destination model

Both frameworks converge on these semantic owners:

| Owner | Stable meaning | Bigfish source mapping | Smallfish source mapping |
| --- | --- | --- | --- |
| Application | Logical browser/server application and shared configuration | SPA application | Logical owner across all MPA entries |
| Page | Component source, rendering policy, and private source scope | Route component after source normalization | Page instance/directory |
| Route | URL pattern, parentage, target, layout/wrapper facets, and route-owned plugin data | Explicit route node | Directory-derived semantic URL |
| Document | HTML template, mount, output, and bootstrap owner | SPA application shell or static export document | Per-Page HTML output |

Canonical application source uses one convention:

```text
src/pages/**/page.{ts,tsx,js,jsx}
```

The containing directory determines Page scope and URL. Adjacent
`page.config.ts` contains build-time Page title, named metadata, rendering
settings, and Page-owned plugin extensions. `routing.mode` only chooses SPA or
MPA materialization; it does not select another discovery dialect.

Core 0.3 intentionally has:

- no `compatibility.source`;
- no version-suffixed graph or plugin API;
- no `index.*` fallback reader;
- no per-subsystem convention-disable switches;
- no runtime reader for `config.json`;
- no Bigfish/Smallfish hook-name emulator.

## Application migration matrix

| Source capability | Core 0.3 destination | Migration treatment |
| --- | --- | --- |
| Bigfish explicit nested routes | `application.routes` SPA migration input, then canonical Page tree | Normalize `routes`, `component`, redirects, layout, and wrappers into the same CoreGraph; remove the migration input after source conversion |
| Bigfish extra route props | Registered Route extensions | Move each plugin's fields into its own namespace; never copy arbitrary unknown keys |
| Bigfish Page/group private folders | Canonical Page directory scope | Move each published component to its URL directory and use `page.tsx`; colocated source stays private without `_` |
| Bigfish global layout/runtime providers | Application layout, `page.wrapper`, and `client.entry` contributions | Preserve semantic composition and explicit runtime installers |
| Bigfish site/static export | SPA Pages with explicit prerender/rendering settings | Do not translate it to MPA |
| Smallfish direct-child Pages | Canonical recursive Page tree in MPA mode | One-time source migration from `index.*` to `page.*` |
| Smallfish `config.json` title/meta | Core `page.config.ts` `title`/`meta` | Generate static typed config and remove the JSON reader |
| Smallfish plugin-owned Page config | Registered Page extensions | The owning plugin defines defaults, merge, validation, and runtime/build projection |
| Smallfish `<name>.html`/custom `router` | Document output mapping plus request/deployment projection | Preserve a static mapping when representable; diagnose dynamic rewrites until the selected adapter owns them |
| evjs 0.2 `_private` convention | Canonical Page directory scope | `_` may remain as an ordinary filename, but is no longer required for discovery |

## Plugin capability matrix

The source frameworks expose many hook names, but their behavior falls into a
smaller set of semantic phases:

| Source behavior | Core 0.3 mechanism | Boundary |
| --- | --- | --- |
| Config schema, defaults, and validation | `describe()` plus registered Application/Page/Route/Document extensions | Extension values are strict static JSON; executable options stay in the plugin factory |
| Config normalization that affects discovery | Ordered `config()` hook | The result must pass the single framework config resolver |
| Generated/tmp modules and data | `.ev` generated modules/data, opaque refs, and import edges | Plugins declare artifacts; they do not write arbitrary framework tmp files |
| Entry imports and runtime plugins | `client.entry` with explicit installer modules | No inert runtime-plugin registry or export-name probing |
| Page providers/component transforms | `page.wrapper` | Targets semantic Pages across supported client/server projections |
| Route/menu/access/tracing data | Registered Route extensions plus generated runtime projection | Route data stays Route-owned, including componentless Routes |
| Head scripts, styles, links, and HTML mutation | Structured `html.tag` and ordered `transformHtml()` | Target Documents/owners, never inferred filenames |
| Request middleware | `server.request.middleware` | Product endpoints and platform protocols remain explicit plugin/server capabilities |
| Alias/external rules | `resolve.alias` and `resolve.external` | Adapter projection is validated against runtime capability |
| Bundler-specific transforms | Typed adapter `bundlerConfig()` escape hatch | Used only when the BuildPlan/structured contribution cannot express the behavior |
| Build/deployment output | `buildOutput()` and `buildEnd()` with canonical deployment metadata | Platform packages consume build facts instead of rebuilding route ownership |
| Watches and cleanup | `addWatchFile()` and reverse-order `dispose()` | A rebuild creates a new deterministic resolution session |

Bigfish's tracked built-in and repository plugin sources most frequently use
checks, config transforms, generated files, build completion, HTML, runtime
plugin injection, and bundler changes. Smallfish's first-party ecosystem most
frequently uses config/Page schema hooks, generated Application files,
Page-entry imports, HTML hooks, Page resolution callbacks, aliases/globals, and
bundler changes. This is why generated artifacts, all four graph owners,
Document targeting, deterministic lifecycle, and adapter escape hatches are
Core mechanisms rather than framework-specific compatibility APIs.

The mechanical source counts behind that priority are conservative lower
bounds. Bigfish's tracked `src/**` and repository `plugins/**` contain 160
matching hook call sites; the largest groups are:

| Bigfish hook | Call sites |
| --- | ---: |
| `onCheckCode` / `onCheckPkgJSON` | 18 / 15 |
| `modifyDefaultConfig` / `modifyConfig` | 14 / 10 |
| `onGenerateFiles` | 12 |
| `onCheckConfig` / `onCheck` | 10 / 8 |
| `onBuildComplete` | 9 |
| `addHTMLHeadScripts` / `modifyHTML` | 7 / 6 |
| `onDevCompileDone` / `onStart` | 6 / 5 |
| `addRuntimePlugin` | 5 |
| `chainWebpack` | 4 |

Smallfish first-party production sources contain these representative call
site counts:

| Smallfish behavior | Call sites |
| --- | ---: |
| `describeConfig` / `describePageConfig` | 43 / 8 |
| Application `addTmpFile` | 19 |
| `addEntryImportsAhead` / `addEntryImports` | 11 / 4 |
| `addHTMLHeadScripts` / `addHTMLScripts` / `addHTMLMetas` | 9 / 5 / 3 |
| `onPagesResolved` | 7 |
| `defineModuleAlias` / `addGlobalVariable` | 6 / 6 |
| `chainWebpack` | 5 |

The counts exclude transitive packages and externally published plugins, so
they establish ordering rather than an exhaustive compatibility percentage.

## Extension ownership and executable behavior

One plugin namespace may declare the owners it actually supports:

```ts
definePlugin({
  name: "@company/access",
  describe(api) {
    api.applicationExtension({
      namespace: "@company/access",
      defaults: { enabled: true },
    });
    api.pageExtension({
      namespace: "@company/access",
      defaults: { role: "guest" },
    });
    api.routeExtension({
      namespace: "@company/access",
      defaults: { permission: null },
    });
  },
});
```

Every owner declaration belongs to the same namespace producer and schema
version. Values are cloned, validated, and frozen before contribution code
consumes them. A Route extension can distinguish two Routes that target the
same Page and can exist on redirects/groups without inventing a fake Page.

Functions, components, installers, middleware, and platform clients are not
extension values. They remain module references attached through a structured
contribution or lifecycle hook. This separation lets old plugins migrate one
capability at a time without serializing executable code into CoreGraph.

## Bigfish application sequence

1. Record the current route tree, route-only properties, wrappers, redirects,
   public paths, and every plugin that reads or mutates routes.
2. Keep the explicit tree temporarily under SPA-only `application.routes`.
3. Register each plugin-owned route namespace and move its fields under
   `route.extensions`; keep only Core structural fields at the route top level.
4. Move each Page component into the directory that represents its canonical
   URL and rename the positive entry to `page.*`.
5. Move document title/metadata to `page.config.ts`. Keep menu labels,
   permissions, tracing, and micro-frontend selection on Route extensions.
6. Replace generated tmp files/runtime-plugin registration with `.ev`
   artifacts, explicit installers, wrappers, and HTML/resolve contributions.
7. Compare normalized Routes, runtime behavior, HTML, static outputs, and
   deployment metadata with `ev inspect` and integration tests.
8. Remove `application` and enable the canonical tree with
   `routing.mode: "spa"`.

If one component is intentionally published at several URLs, create thin
canonical Page modules that re-export the shared component. This preserves one
Page owner per canonical URL without duplicating business implementation.

## Smallfish application sequence

1. Inventory every Page directory, explicit `pages` item, custom entry/root,
   `config.json`, `router`, HTML layout, mount, output filename, and
   Page-scoped plugin field.
2. Run the one-time migration in check mode and review every proposed anchor
   and config conversion.

   ```bash
   # Dry-run by default.
   ev migrate smallfish

   # Machine-readable dry-run for CI or scripted review.
   ev migrate smallfish --json

   # Pass the already-resolved location when appBaseDir/pagesDir is custom.
   ev migrate smallfish --pages-dir app/screens

   # Apply only after the global preflight succeeds.
   ev migrate smallfish --write
   ```

   The JSON and text results report the exact `routingDir`. When `--pages-dir`
   is not `src/pages`, configure the same directory explicitly:

   ```ts
   export default defineConfig({
     routing: { mode: "mpa", dir: "app/screens" },
   });
   ```

   The command preflights every Page before writing anything. Generated thin
   anchors and Page configs carry a migration marker, so rerunning a completed
   migration is a no-op, including Pages with a custom static `router` alias.
   Every selected `index.*` remains the implementation and import target behind
   a generated `page.*` re-export. The root form re-exports
   `src/pages/index/index.*` from `src/pages/page.*`, avoiding an accidental
   `/index` publication.

   Existing recursive `page.*`, `layout.*`, `error.*`, `not-found.*`, and Page
   `index.html` files are blockers because Core 0.3 would activate them as
   Pages, route facets, or Document templates. Candidate entries and configs
   must be direct regular files; symlinks are never overwritten. Project config
   is never executed or imported: only a direct object-literal export can be
   verified automatically. Shorthand, spread, computed properties, function
   config, imported or otherwise indirect config, `plugins`, `presets`, and a
   visible `SMALLFISH_CUSTOM_CONFIG` override are blockers. Deprecated
   `baseDir`, `appBaseDir`, and `pagesDir` require an audited resolved directory
   passed through `--pages-dir`. `layout`, `layoutsDir`, `mountElementId`, and
   `globalStylesDir` are also blockers until the final layout and mount have
   been frozen into a regular root `index.html` containing `#app`, and automatic
   global styles have become explicit imports. The same fail-closed check covers
   Smallfish's default implicit entries: `global.{ts,tsx,js,jsx}` and recursive
   `styles/**/*.{css,less}` beside the resolved Pages directory. The command
   verifies both those inputs and the shared template before allowing writes.
3. Keep the selected `index.*` entry in place and let the command add a thin
   `page.*` re-export; leave all other non-convention colocated files in place.
4. Let the command generate `page.config.ts` only for supported title/named
   metadata. Move plugin-owned static fields into registered namespaces
   manually; the command blocks unknown fields instead of guessing their
   ownership or mapping.
5. Preserve every published static HTML filename through the Document/output
   mechanism. The migration writes static `<name>.html` or safe
   `router` values with an exact `.html` or `.htm` extension to
   `document.aliases`; an alias is another output of the same transformed
   Document, not another Route or Page. Treat dynamic `:param` rewrites,
   alias/output collisions, explicit `pages` declarations, custom Nunjucks
   logic, non-HTML output extensions, and unsupported executable config as
   blockers requiring an explicit adapter or source rewrite.
6. Migrate Application/Page generated files, entry imports, HTML hooks, and
   deployment logic to structured plugin contributions.
7. Configure `routing.mode: "mpa"` and, for a custom Page root, the reported
   `routing.dir`. Run `ev inspect --json` after writing and verify that every
   generated anchor resolves to the expected Page, Route, Document output, and
   alias before building. Validate every original request URL and emitted
   output. Do not add a Smallfish source switch.

Explicit Smallfish `pages` declarations can expose the same root/entry as
multiple public Pages. Canonical source represents that case with thin Page
anchors that import shared implementation, not a second Page-config reader.

## Verification contract

An application migration is complete only when all relevant rows have
evidence:

- every published URL maps to the intended normalized Route;
- every Page has one positive `page.*` anchor and the expected private scope;
- title, named metadata, mount, template, and output filenames match;
- Bigfish redirects/groups and Smallfish per-Page Documents remain distinct
  owners;
- each plugin namespace is registered for the owner that authors it;
- generated modules and import edges are visible under `.ev`;
- runtime installers, Page wrappers, middleware, and HTML transforms execute
  once in deterministic order;
- SPA and MPA tests cover the plugin whenever it supports both modes;
- `ev inspect`, build output, and deployment metadata agree;
- unsupported source behavior fails with a migration diagnostic rather than
  being ignored.

## Source evidence index

Representative source locations used by the audit:

| Framework | Source area | Evidence |
| --- | --- | --- |
| Bigfish | `src/appType/appType.ts`, `src/appType/site.ts` | Supported application types; `site` enables static export |
| Bigfish | `src/constraint/rules/ROUTE_NO_CONVENTIONAL.ts` | Explicit route config is the supported Bigfish structure |
| Bigfish/Umi | `@umijs/core/dist/route/routesConfig.js` | Route normalization, nesting, path behavior, and preservation of route props |
| Bigfish | `plugins/preset-bop/src/subapp/subapp.ts` | Route mutation plus `menuKey`/`menuAssetOptions`, generated files, runtime plugin use |
| Bigfish | `src/ctoken`, `src/tern`, `src/deployMode` | Generated files, runtime plugins, HTML/build/deployment hooks |
| Smallfish | `packages/smallfish-core/src/kernel/main.ts` (`resolvePages`) | Direct-child/explicit Page discovery and Page instance creation |
| Smallfish | `packages/smallfish-core/src/kernel/instance/page.ts` | Default `<name>.html`, custom `router`, entry and Page output ownership |
| Smallfish | `packages/smallfish-types/src/core/config/page.ts` | Page config contract including `router` and `htmlFileExtension` |
| Smallfish | `packages/smallfish-core/src/kernel/plugin/context/activate.ts` | Page entry, HTML, Page resolution, and plugin activation hooks |
| Smallfish | `packages/smallfish-plugin-app/src` | Application tmp files, Page entry imports, HTML, runtime, and deployment consumers |
| Smallfish | `packages/smallfish-runtime/src/utils.ts` | Dynamic `router` parameter restoration |

The source revisions at the top of this document are part of the evidence.
Re-audit changed upstream versions before expanding the compatibility claim.
