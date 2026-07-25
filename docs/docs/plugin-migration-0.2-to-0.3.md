# Plugin Migration: Core 0.2 to 0.3

This guide describes the approved Core 0.3 plugin migration contract.
Namespaced Application, Page, Route, and Document extensions, plus canonical
Page-directory static config across SPA/MPA, are executable today. Graph
transforms, typed runtime hooks, generic semantic facet APIs, and generic build
entries remain target APIs and are labeled below. Current 0.2 behavior is
called out explicitly.

For the architecture behind these changes, read the
[Core 0.3 Design RFC](./core-0.3-rfc). For source-backed Bigfish and Smallfish
capability evidence and application migration sequencing, read
[Bigfish and Smallfish Migration](./framework-migration-to-0.3).

## Migration Outcome

A migrated plugin should:

- declare the config and capability namespaces it owns before extension values
  are resolved;
- read normalized Application, Page, Route, and Document views instead of
  reconstructing owners from entry names;
- keep generated code in `.ev` through opaque refs and import edges;
- attach supported behavior through `client.entry`, `page.wrapper`,
  `server.request.middleware`, `html.tag`, and resolution contributions;
- use explicit client installers for runtime side effects;
- use bundler, HTML AST, dev, and output lifecycle hooks only for behavior that
  has no current structured contribution;
- work against the same normalized graph in SPA and MPA, or fail with an
  explicit routing-mode requirement.

Migration does not mean emulating Umi/Bigfish/Smallfish hook names, arbitrary
tmp files, or a bundler-neutral webpack-chain API.

Immutable graph transforms, typed runtime hooks, generic extension entries,
and the broader semantic facet model remain planned APIs. They are design
targets later in this guide, not requirements for a plugin that migrates to
the current Core 0.3 implementation.

## Start by Classifying the 0.2 Plugin

| 0.2 behavior | Migration class | 0.3 destination |
| --- | --- | --- |
| `name`, dependencies, optional dependencies | Mechanical | plugin identity and dependency graph |
| `enforce` | Review | explicit dependency/order rule; dependencies win |
| simple config defaults and validation | Mechanical | the matching `describe()` Application/Page/Route/Document owner declaration |
| arbitrary raw `config()` mutation | Review | current `config()` hook for framework config; namespaced extensions for owned static config; ordered normalizers remain planned |
| `setup()` state | Usually mechanical | deterministic state after project config validation |
| `emit.module()` / `emit.data()` | Mechanical | generated artifacts with the same opaque-ref model |
| `emit.entryFacade()` | Review | wrap a named semantic facet or materialized entry |
| app-owned `client.entry` | Mechanical | current Application-targeted `client.entry`; planned `application.bootstrap` / `document.entry` facets |
| MPA page-owned `client.entry` | Review | Page component wrapping moves to `page.wrapper`; side-effect installers remain client-entry behavior |
| SPA page-owned `client.entry` | Semantic rewrite | use `page.wrapper` for Page composition; a SPA Page still does not own an entry |
| `client.entry` with `runtime: "server"` or `"all"` | Invalid; rewrite | a client-entry slot accepts only `client`; cross-runtime Page composition uses `page.wrapper` |
| former `client.runtime.plugin` | Semantic rewrite | Page component transforms use `page.wrapper`; side effects use an explicit `client.entry` installer |
| `html.tag` | Mechanical after owner review | current `html.tag` Document contribution |
| `server.request.middleware` | Mechanical | current server request middleware contribution |
| `resolve.alias` / `resolve.external` | Mechanical | retained resolution facets |
| `transformHtml()` | Mechanical after owner review | Document AST transform |
| `bundlerConfig()` | Retained escape hatch | adapter-specific callback |
| `buildOutput()` mutation | Review | current `buildOutput()` lifecycle; namespaced output projection remains planned |
| `buildStart/buildEnd/dispose` | Usually mechanical | corresponding lifecycle phase |
| render/RSC/PPR assumptions | Semantic rewrite | current Core Page fields from `page.config.ts`; plugins must not infer internal renderer entry kinds |

The current Core 0.2 implementation has no `client.route` slot. Older
documentation listed it by mistake, but `FrameworkSlotName` and the
implementation do not. Migrate route behavior from the plugin's actual code,
not from that documentation row.

## Current Executable Phase Mapping

The plugin API uses the same dependency order across all deterministic phases.
`describe()` runs once for each resolved plugin configuration; a dev config
reload starts a new resolution cycle. Application extensions resolve before
`setup()` and are exposed through `ctx.config.extensions`; Page, Route, and
Document extensions resolve later against normalized graph owners and are
available to `contributions()`.

```text
config
  -> resolve project config
  -> describe
  -> resolve Application extensions
  -> setup
  -> buildStart
  -> discover Pages/Routes/Documents and evaluate page.config.ts
  -> resolve Page/Route/Document extensions and validate CoreGraph
  -> create BuildPlan
  -> contributions and target validation
  -> materialize .ev
  -> bundlerConfig
  -> adapter build
  -> buildOutput
  -> transformHtml
  -> buildEnd
  -> reverse-order dispose
```

## Target Phase Model (Planned)

The following fuller phase model is a design target. The `transform`, typed
runtime-hook, generic facet, and generic-entry rows do not describe callable
APIs in the current release.

```text
bootstrap
  -> resolve project/provider config
  -> describe
  -> resolve Application extensions
  -> allocate deterministic setup state
  -> discover identities and source scopes
  -> resolve colocated page config
  -> normalize the initial graph
  -> resolve Page/Route/Document extensions on the normalized graph
  -> apply declarative graph contributions
  -> final graph validation
  -> declare generated artifacts and semantic facet attachments
  -> validate contribution targets and cardinality
  -> materialize generated modules, entries, runtime hooks, and documents
  -> configure the selected adapter
  -> adapter/build/output lifecycle
  -> reverse-order dispose
```

| Phase | Allowed work | Must not happen here |
| --- | --- | --- |
| `bootstrap` | Resolve plugin package, instance id, options, dependencies. | Read project page config or mutate the graph. |
| `resolve project config` | Run config hooks, then merge and validate project/provider config needed for discovery. | Read colocated page config before Page roots exist. |
| `describe` | Register extension owners, defaults, merge/validation, source providers, capabilities, and runtime hooks. | Network calls, generated files, or config values that have not been validated. |
| `resolve Application extensions` | Resolve registered top-level values and deep-freeze the snapshot exposed to `setup()`. | Read Page-owned config or serialize declaration callbacks into graph data. |
| `setup` | Allocate deterministic in-memory state from validated config, resolved `ctx.config.extensions`, and declared local project inputs. | Read Page/Route/Document extensions before the normalized graph exists; perform network calls, external writes, platform mutation, or use undeclared facts that can change the graph. |
| `discover` | Providers declare Applications, Page identities/scopes, Routes, Documents, and watch inputs. | Mutate declarations owned by another provider. |
| `resolve page config` | Evaluate built-in Page fields and collect static namespaced values from colocated config. | Resolve values against an owner before Page identity exists, or mutate Page identity fields such as id/provider/scope. |
| `normalize` | Core converts provider declarations into the initial immutable graph. | Add provider-specific fields to the normalized protocol. |
| `resolve graph extensions` | Resolve registered defaults/config/merge/validation for every normalized Page, Route, and Document and record namespace ownership. | Serialize callbacks into the graph or change owner identity. |
| `transform` | Return structured graph patches and diagnostics with provenance. | Arbitrary in-place graph mutation. |
| `final validation` | Re-run identity, conflict, path-shape, target, and ownership validation after every patch. | Repair conflicts by silently dropping declarations. |
| `contribute` | Declare generated modules/data/types and their semantic facet attachments. | Write generated files, mutate already-validated identities, or perform external side effects. |
| `target validation` | Resolve every explicit target and enforce zero/multiple-match and replacement cardinality rules. | Guess an owner from an entry or output filename. |
| `materialize` | Core writes declared artifacts and materializes Documents, Page module/activation facets, runtime hooks, and generic build entries. | Put provider semantics in a bundler adapter or add undeclared contributions. |
| `configure adapter` | Project validated generic entries and resolution facets into the selected adapter. | Add graph semantics that are invisible to Core and `ev inspect`. |
| lifecycle | Run dev middleware, build/output/deployment work, and cleanup. | Hide graph semantics that should be inspectable. |

Any local project read that affects the graph must be a declared watch input.
Network calls, external writes, and platform mutations are lifecycle work; they
cannot provide hidden facts to an earlier deterministic phase.

## Runnable Namespaced Extension Owners

Canonical applications author Application-owned values in top-level
`ev.config.ts`:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
  extensions: {
    "@company/feature": {
      enabled: true,
    },
  },
});
```

Do not put these values under `application.extensions`. `application` remains
only the explicit Bigfish SPA route-tree migration input.

Page-owned values remain adjacent to their Page in `page.config.ts`:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  extensions: {
    "@company/feature": {
      enabled: true,
      channel: "checkout",
    },
  },
});
```

The same file may target the Page's unique semantic Route or a Page-owned
Document. A Document value is valid only when that Page materializes its own
Document, such as canonical MPA or SPA SSG:

```ts
export default definePageConfig({
  route: {
    extensions: {
      "@company/access": { policy: "canReadCheckout" },
    },
  },
  document: {
    extensions: {
      "@company/html": { theme: "checkout" },
    },
  },
});
```

Explicit `application.routes` migration input configures a Route through its
own `extensions` field, including componentless layout/group/redirect Routes.
Its `application.document.extensions` field targets the Application-owned
Document. These inputs normalize into the same owner bags; they are not a
second extension mechanism.

The owning plugin registers the same namespace:

```ts
import { definePlugin } from "@evjs/ev/plugin";

type ApplicationFeatureValue = {
  enabled: boolean;
};

type PageFeatureValue = {
  enabled: boolean;
  channel: string;
};

export const featurePlugin = definePlugin({
  name: "feature",
  dependencies: ["another-plugin"],

  describe(api) {
    api.applicationExtension<
      ApplicationFeatureValue,
      Partial<ApplicationFeatureValue>
    >({
      namespace: "@company/feature",
      schemaVersion: "1",
      defaults: { enabled: false },
    });
    api.pageExtension<PageFeatureValue, Partial<PageFeatureValue>>({
      namespace: "@company/feature",
      schemaVersion: "1",
      defaults: { enabled: false, channel: "web" },
      merge(defaults, configured) {
        return { ...defaults, ...configured };
      },
      validate(value) {
        return value.channel.length > 0 || "channel must not be empty";
      },
    });
  },

  setup(ctx) {
    const feature = ctx.config.extensions["@company/feature"];
    // The Application value is resolved and deeply frozen before setup().
    console.log(feature);
  },

  contributions(ctx) {
    const applicationFeature =
      ctx.framework.applications[0]?.extensions["@company/feature"];
    const pages = ctx.framework.pages.map((page) => ({
      id: page.id,
      feature: page.extensions["@company/feature"],
    }));
    console.log(applicationFeature, pages);
  },
});
```

`definePlugin()` is a type helper for the single `Plugin` interface. Without a
custom `merge`, plain objects are shallow-merged as defaults < configured
value; other configured values replace defaults. An omitted namespace
materializes defaults directly without invoking custom `merge`, so its
`configured` argument always represents an explicitly authored value.
Defaults functions, `merge`, and `validate` are synchronous.

The namespace registry has one producer contract:

- one plugin may declare the same namespace once for each applicable owner with
  `applicationExtension()`, `pageExtension()`, `routeExtension()`, and
  `documentExtension()`;
- repeating the same owner is an error;
- registration by another plugin is a conflict, even when it asks for the
  other owner;
- every declaration for one namespace must use the same `schemaVersion` value,
  including all omitting it;
- configured namespaces without the matching owner declaration are errors.

Application values resolve after `describe()` and before `setup()`. They are
deeply frozen in `ctx.config.extensions`, then copied to the normalized
Application extension bag. Page, Route, and Document values resolve during
graph analysis, after their identities and static inputs are known.
Contribution views expose all four owners without requiring access to `.ev`
internals.

All authored values, static defaults, and materialized merge results must be
strict static JSON data. Functions, Promises, symbols, bigint, non-finite
numbers, class instances, accessors, sparse arrays, cycles, and unsafe keys are
rejected. The synchronous `defaults`, `merge`, and `validate` callbacks are
plugin declaration code, not extension values. Move executable build-time
options into the plugin factory and runtime behavior into an emitted/imported
module carried by an opaque module ref and explicit generated contribution.

Canonical `page.tsx` anchors supply Page owners in both modes; explicit
route-tree migration inputs must normalize into the same graph. Existing
lifecycle hooks, `describe()`, and all four extension declarations are members
of the same `Plugin` interface and use one implementation. Do not introduce a
historical compatibility layer or names such as `applicationExtensionV2()` or
`pageExtensionV3()`: `schemaVersion` versions namespace data, not the API.

Application, Page, Route, and Document extension values are not exposed
automatically at runtime; browser or server behavior still requires an
explicit generated runtime projection. Route and Document values are accepted
only through their registered owner APIs and strict static authoring inputs;
they do not authorize executable callbacks or implicit runtime injection.

### Current MPA targeting

Canonical MPA exposes one logical `default` Application.
With the existing generated-contribution slots, an Application target expands
`client.entry` across all of that Application's page-client entries and
expands `html.tag` across all of its Documents. `page.wrapper` follows semantic
Page ownership and projects to available client/server Page materializations,
so the same Application or Page target works across SPA and MPA. A Page target
still selects exactly one semantic Page. This is the landed behavior; the
semantic facets in the next section remain target API. An explicit
route-tree input must normalize to the same ownership before using these
semantics.

## Target Graph, Runtime, and Facet Shape

The following responsibilities remain design targets, not implemented API:

```ts
// Target shape only; these members do not compile yet.
definePlugin({
  name: "future-example",
  transformGraph(ctx) {
    return ctx.patch.addRoute(/* structured declaration */);
  },
  contribute(ctx) {
    ctx.facet("page.module", "home").add(/* ModuleRef */);
  },
  describe(api) {
    api.runtime.defineHook(/* typed runtime hook */);
  },
});
```

Executable behavior will remain a `ModuleRef`, never a function serialized into
the graph.

## Facet Mapping

| Facet | Cardinality and purpose |
| --- | --- |
| `application.bootstrap` | Runs in every browser entry that bootstraps the logical Application: once in a typical SPA, once per page Document in MPA. |
| `page.module` | Wraps or augments the Page module exactly once per Page definition, independent of SPA/MPA entry materialization. |
| `page.activation` | Optional enter/leave lifecycle for a Page; does not imply model isolation or lazy state. |
| `route.definition` | Adds/replaces/wraps normalized Route declarations with conflict validation and provenance. |
| `document.entry` | Affects the entry that bootstraps one specific Document. |
| `document.html` | Adds structured tags or transforms exactly one Document. |
| `build.entry` | Declares an extension-owned client/server/build entry with owner, environment, phase, and capability. Core does not interpret the capability name. |
| `server.request` | Adds request middleware/endpoints owned by a server capability. |
| `resolve.alias` / `resolve.external` | Retained semantic resolution contributions. |

Zero matches are errors for explicit targets. Multiple replacement
contributions are errors unless a facet defines composition. Application
expansion to several MPA entries/Documents is deterministic and visible in
`.ev` and `ev inspect`.

## Common Migration Patterns

### Move config ownership into `describe()`

0.2 plugins often mutate the raw config:

```ts
config(config) {
  return { ...config, feature: { enabled: true, ...config.feature } };
}
```

In the current plugin API, register the applicable Application, Page, Route,
and/or Document owners, defaults, and merge/validation callbacks in synchronous
`describe()`. Top-level Application values resolve before `setup()`; the
canonical resolver or explicit route-tree normalizer then discovers normalized
owners, and the registry resolves their namespaced static inputs during graph
analysis without changing identity fields such as internal id, source
provenance, or scope. General schema generation and ordered cross-field
normalizers remain future work.

The explicit Bigfish migration normalizer retains its finite, source-backed
access/menu field set in the built-in `@evjs/bigfish-route` Route namespace.
Other Bigfish plugin values and Smallfish fields such as
CAPR/Tracert/launch parameters belong to separately registered namespaces.
Do not add them as identity fields on Core Page or Route nodes.

### Keep generated artifacts, change their attachment point

`emit.module`, `emit.data`, opaque refs, and generated import edges survive.
Most generated source can move unchanged. Use the current supported
contributions first:

```text
global side-effect installer -> Application-targeted client.entry
Page wrapper/provider        -> page.wrapper
request middleware           -> server.request.middleware
meta/link/script/style        -> html.tag
module resolution            -> resolve.alias / resolve.external
```

A Smallfish-style page plugin can already iterate resolved Pages and read
`page.extensions` in `contributions()`. `page.wrapper` composes a Page across
the selected client/server projections without assuming that every Page owns
an independent client entry. Page activation hooks, generic `page.module`,
and per-Document bootstrap facets remain planned.

### Rewrite runtime plugins deliberately

The former 0.2 `client.runtime.plugin` slot imported module namespaces and
recorded an array that Core never invoked. Core 0.3 does not expose that inert
slot. Migration choices:

- side-effect installer: import and call it explicitly through `client.entry`;
- root/provider or Page composition: use `page.wrapper` when component
  wrapping expresses the behavior;
- navigation notification or option transformation: keep the behavior behind
  an explicit installer or existing public runtime API until a typed hook is
  available.

Do not copy export-name probing such as `patchRoutes`, `rootContainer`, or
`render`. Typed `compose`, `event`, and `modify` hooks are planned contracts,
not current APIs.

### Retarget HTML to Documents

0.2 HTML ownership is inferred from its `app`/`page` build output. In Core 0.3,
structured tags and AST transforms target a Document id or selector.

- MPA Page -> usually one matching Document;
- static SPA SSG Page -> one matching Page-owned Document;
- CSR SPA Page -> no Page-owned Document; use an Application Document target
  for static tags, or a route/runtime head capability for page-varying
  metadata;
- Application -> may expand to several MPA Documents; expansion is explicit.

Never infer the target from an HTML filename.

### Planned: replace route mutation with graph patches

The target API will express Route changes as normalized Page/Route
declarations and immutable patch operations such as add, replace target, wrap,
or patch one extension namespace. Each patch records plugin, instance, phase,
and dependency order. It passes the same id, parent, path-shape, and ownership
validation as source providers.

There is no public graph-patch API yet. Until it lands, do not introduce
another route dialect inside generated code. Bigfish `:id`, evjs `$id`, and
file paths remain provider inputs.

### Keep rendering on the current Core Page contract

Core 0.3 currently owns `render`, `hydrate`, `prerender`, and `rsc` in adjacent
`page.config.ts`, and exposes normalized rendering values on Page views.
Migrated plugins may read those public Page fields, but must not infer behavior
from internal renderer entry kinds or adapter-specific filenames.

A future generic rendering extension may own generic entries, request facets,
Document production, caching, streaming, and deployment projections. That is
a planned Core simplification, not the current authoring contract.

## No Runtime Compatibility Adapter

Core 0.3 does not host 0.2 plugin objects through a compatibility adapter.
Migrate each plugin source to the single `Plugin` contract. Mechanical
conversion tooling may generate source changes or diagnostics, but it must not
install a second plugin runtime or reinterpret old hooks while the application
runs. Extension APIs also stay unversioned: migrate the namespace data contract
and its producer together instead of adding a parallel version-suffixed
implementation.

## Recommended Migration Procedure

1. Inventory every hook, generated file, target, runtime export, route change,
   and bundler mutation in the 0.2 plugin.
2. Assign static config to its registered Application, Page, Route, or Document
   owner and define defaults/merge/validation for each owner. Use canonical
   `page.config.ts` for Page, unique Route, and Page-owned Document values;
   explicit migration inputs may configure their declared Route and
   Application-owned Document. Do not put values on an owner the normalized
   graph does not contain.
3. Select a current structured contribution or lifecycle hook for each
   generated artifact. Flag any target that relies on an entry name or HTML
   filename, and record gaps that require a planned facet instead of inventing
   a current API.
4. Split raw config, current generated contribution declarations,
   materialization, and side-effect lifecycle work into their corresponding
   phases. Plugin graph transforms remain planned.
5. Replace runtime side effects/export probing with explicit installers and
   current structured contributions; use typed hooks only after those APIs
   land.
6. Remove assumptions about Page URL, Document, entry, or render mode.
7. Test the plugin against one SPA and one MPA graph, even if the plugin
   intentionally rejects one routing mode.
8. Inspect `.ev` to verify producer, target expansion, generated imports, and
   conflict order.

## Required Tests for a Migrated Plugin

- schema defaults and invalid config diagnostics;
- Application extension resolution before `setup()` and Page/Route/Document
  extension resolution on the normalized graph;
- duplicate-owner, cross-plugin namespace, and cross-owner `schemaVersion`
  conflict diagnostics;
- deterministic ordering with required and optional dependencies;
- SPA and MPA `page.wrapper` behavior occurs once per selected Page projection;
- Application contribution expands once in SPA and to all intended MPA
  entries/Documents;
- Document HTML contribution neither leaks nor duplicates;
- zero-match target and multiple replacement diagnostics;
- generated module import edges and watch inputs;
- explicit installer behavior and reverse-order lifecycle cleanup;
- Webpack and Utoopack consume the same semantic BuildPlan;
- `ev inspect` shows the plugin, resolved owners, contributions, and
  materialized entry/Document;
- rendering-sensitive behavior reads public normalized Page fields instead of
  internal renderer entry kinds.

When graph transforms, typed runtime hooks, and generic semantic facets land,
their patch provenance, hook ordering, and facet cardinality will need a
separate test matrix. Those future tests are not current migration gates.
