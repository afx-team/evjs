# Plugin Migration: Core 0.2 to 0.3

This guide describes the approved Core 0.3 plugin migration contract.
Namespaced Page extensions and canonical Page-directory raw-config claims
across SPA/MPA are executable today. Graph transforms, typed
runtime hooks, semantic
facets, and generic extension entries remain target APIs and are labeled below.
Current 0.2 behavior is called out explicitly.

For the architecture behind these changes, read the
[Core 0.3 Design RFC](./core-0.3-rfc).

## Migration Outcome

A migrated plugin should:

- declare the config and capability namespaces it owns before config is read;
- target semantic Application, Page, Route, or Document facets rather than
  guessing from entry names;
- express graph changes as ordered, immutable patches with provenance;
- keep generated code in `.ev` through opaque refs and import edges;
- register runtime behavior through typed hooks that are actually executed;
- use bundler, HTML AST, dev, and output escape hatches only for behavior that
  has no stable semantic facet;
- work against the same normalized graph in SPA and MPA, or fail with an
  explicit topology requirement.

Migration does not mean emulating Umi/Bigfish/Smallfish hook names, arbitrary
tmp files, or a bundler-neutral webpack-chain API.

## Start by Classifying the 0.2 Plugin

| 0.2 behavior | Migration class | 0.3 destination |
| --- | --- | --- |
| `name`, dependencies, optional dependencies | Mechanical | plugin identity and dependency graph |
| `enforce` | Review | explicit dependency/order rule; dependencies win |
| simple config defaults and validation | Mechanical | `describe()` extension schema/default |
| arbitrary raw `config()` mutation | Semantic rewrite | schema plus ordered config normalizer |
| `setup()` state | Usually mechanical | deterministic state after project config validation |
| `emit.module()` / `emit.data()` | Mechanical | generated artifacts with the same opaque-ref model |
| `emit.entryFacade()` | Review | wrap a named semantic facet or materialized entry |
| app-owned `client.entry` | Mechanical | `application.bootstrap` or `document.entry` |
| MPA page-owned `client.entry` | Review | usually `page.module` or `page.activation` |
| SPA page-owned `client.entry` | Semantic rewrite | `page.module`; a SPA Page does not own an entry |
| `client.entry` with `runtime: "server"` | Invalid; rewrite | a client-entry slot accepts only `client` or `all`; use a server request/entry facet for server code |
| former `client.runtime.plugin` | Semantic rewrite | explicit installer through `client.entry`, or a feature-specific typed hook |
| `html.tag` | Mechanical after owner review | `document.html` |
| `server.request.middleware` | Mechanical | server request facet |
| `resolve.alias` / `resolve.external` | Mechanical | retained resolution facets |
| `transformHtml()` | Mechanical after owner review | Document AST transform |
| `bundlerConfig()` | Retained escape hatch | adapter-specific callback |
| `buildOutput()` mutation | Review | namespaced output projection or output lifecycle |
| `buildStart/buildEnd/dispose` | Usually mechanical | corresponding lifecycle phase |
| render/RSC/PPR assumptions | Semantic rewrite | optional rendering extension; not Core fields |

The current Core 0.2 implementation has no `client.route` slot. Older
documentation listed it by mistake, but `FrameworkSlotName` and the
implementation do not. Migrate route behavior from the plugin's actual code,
not from that documentation row.

## Phase Mapping

The plugin API uses the same dependency order across all deterministic phases.
`describe()` runs once per command before `setup()`, and
resolved extensions are available to `contributions()`. The transform, runtime,
facet, and generic-entry phases in this full sequence remain target behavior.

```text
bootstrap
  -> describe
  -> resolve project/provider config
  -> allocate deterministic setup state
  -> discover identities and source scopes
  -> resolve colocated page config
  -> normalize the initial graph
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
| `describe` | Register extension schemas, defaults, source providers, capabilities, runtime hooks. | Network calls, generated files, or config values that have not been validated. |
| `resolve project config` | Merge and validate project/provider config needed for discovery. | Read colocated page config before Page roots exist. |
| `setup` | Allocate deterministic in-memory state from validated config and declared local project inputs. | Network calls, external writes, platform mutation, or undeclared facts that can change the graph. |
| `discover` | Providers declare Applications, Page identities/scopes, Routes, Documents, and watch inputs. | Mutate declarations owned by another provider. |
| `resolve page config` | Merge built-in/plugin defaults, declaration data, colocated config, and ordered normalizers. | Mutate Page identity fields such as id/provider/scope. |
| `normalize` | Core converts provider declarations into the initial immutable graph. | Add provider-specific fields to the normalized protocol. |
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

## Runnable Page Extension Shape

Canonical applications author the value in `page.config.ts`:

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

The owning plugin registers the same namespace:

```ts
import { definePlugin } from "@evjs/ev/plugin";

type FeatureValue = {
  enabled: boolean;
  channel: string;
};

export const featurePlugin = definePlugin({
  name: "feature",
  dependencies: ["another-plugin"],

  describe(api) {
    api.pageExtension<FeatureValue, Partial<FeatureValue>>({
      namespace: "@company/feature",
      defaults: { enabled: false, channel: "web" },
      merge(defaults, configured) {
        return { ...defaults, ...configured };
      },
      validate(value) {
        return value.channel.length > 0 || "channel must not be empty";
      },
    });
  },

  contributions(ctx) {
    const pages = ctx.framework.pages.map((page) => ({
      id: page.id,
      feature: page.extensions["@company/feature"],
    }));
    console.log(pages);
  },
});
```

`definePlugin()` is a type helper for the single `Plugin` interface. Without a
custom `merge`, plain objects are shallow-merged as defaults < configured
value; other configured values replace defaults. An omitted namespace
materializes defaults directly without invoking custom `merge`, so its
`configured` argument always represents an explicitly authored value.
Defaults functions, `merge`, and `validate` are synchronous. Values are
strictly JSON-serializable.

Page extensions work with normalized CoreGraph Pages. Canonical `page.tsx`
anchors supply them in both modes; explicit route-tree migration inputs must
normalize into the same graph. Existing lifecycle hooks and `describe()` are
members of the same `Plugin` interface and use the same execution path.

Contribution views expose registered Page extensions. Application, Route, and
Document extension values are rejected until their owner APIs exist. This
allows migrated generated-contribution code to consume Page values without
reaching into `.ev` internals. It does not automatically expose the config at
runtime: browser behavior still requires an explicit generated runtime
projection.

### Current MPA targeting

Canonical MPA exposes one logical `default` Application.
With the existing generated-contribution slots, an Application target expands
`client.entry` across all of that Application's page-client entries and
expands `html.tag` across all of its Documents. A Page target still selects
exactly one materialized Page entry or Document. This is the landed behavior;
the semantic facets in the next section remain target API. An explicit
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
| `page.module` | Wraps or augments the Page module exactly once per Page definition, independent of SPA/MPA entry topology. |
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

In the current plugin API, register a Page namespace, defaults, and
merge/validation callbacks in synchronous `describe()`.
The canonical resolver or explicit route-tree normalizer discovers Page
identities/scopes, then the registry resolves namespaced `page.config.ts`
extensions without changing identity fields such as internal id, source
provenance, or scope. General schema generation and ordered cross-field
normalizers remain future work.

Bigfish route fields such as access/menu metadata and Smallfish page fields
such as CAPR/Tracert/launch parameters become separate namespaces. Do not add
them to Core Page or Route types.

### Keep generated artifacts, change their attachment point

`emit.module`, `emit.data`, opaque refs, and generated import edges survive.
Most generated source can move unchanged. Replace the old entry-name target
with a semantic facet:

```text
global installer          -> application.bootstrap
page wrapper/provider     -> page.module
page enter/leave behavior -> page.activation
per-document bootstrap    -> document.entry
meta/link/script/style    -> document.html
```

A Smallfish-style page plugin can already iterate resolved Pages and read
`page.extensions` in `contributions()`. Attaching one generated module to the
future `page.module` facet remains target behavior; meanwhile use supported
contribution slots and do not assume every Page has an independent client
entry.

### Rewrite runtime plugins deliberately

The former 0.2 `client.runtime.plugin` slot imported module namespaces and
recorded an array that Core never invoked. Core 0.3 does not expose that inert
slot. Migration choices:

- side-effect installer: import and call it explicitly through `client.entry`;
- root/provider composition: use a typed `compose` runtime hook;
- navigation notification: use a typed `event` hook;
- option transformation: use a typed `modify` hook;
- page-specific behavior: use `page.module` or `page.activation`.

Do not copy export-name probing such as `patchRoutes`, `rootContainer`, or
`render`. Register and consume one typed hook contract.

### Retarget HTML to Documents

0.2 HTML ownership is inferred from its `app`/`page` build output. In Core 0.3,
structured tags and AST transforms target a Document id or selector.

- MPA Page -> usually one matching Document;
- SPA Page -> no page-owned Document; use an Application Document target for
  static tags, or a route/runtime head capability for page-varying metadata;
- Application -> may expand to several MPA Documents; expansion is explicit.

Never infer the target from an HTML filename.

### Replace route mutation with graph patches

Route changes use normalized Page/Route declarations and immutable patch
operations such as add, replace target, wrap, or patch one extension namespace.
Each patch records plugin, instance, phase, and dependency order. It passes the
same id, parent, path-shape, and ownership validation as source providers.

Do not introduce another route dialect inside generated code. Bigfish `:id`,
evjs `$id`, and file paths are parsed by providers before graph patches run.

### Move rendering out of Core assumptions

Plugins that read `render`, `componentModel`, `prerender`, `ppr`, or built-in
renderer entry kinds need a rendering extension. That extension owns:

- its page capability schema;
- generic server/build entries;
- request endpoints and middleware;
- Document production/transforms;
- cache, streaming, and deployment metadata in its namespace.

Bundler adapters see generic entries and build facts, not SSR/PPR/RSC branches.

## No Runtime Compatibility Adapter

Core 0.3 does not host 0.2 plugin objects through a compatibility adapter.
Migrate each plugin source to the single `Plugin` contract. Mechanical
conversion tooling may generate source changes or diagnostics, but it must not
install a second plugin runtime or reinterpret old hooks while the application
runs.

## Recommended Migration Procedure

1. Inventory every hook, generated file, target, runtime export, route change,
   and bundler mutation in the 0.2 plugin.
2. Assign Page-owned static config to a registered Page extension and define
   its schema/default/merge behavior. Do not write unowned Application, Route,
   or Document extension data; wait for an explicit owner API or use an
   existing generated/lifecycle facet.
3. Select the semantic facet for each generated artifact. Flag any target that
   relies on an entry name or HTML filename.
4. Split raw config, discovery, graph transforms, generated contribution
   declarations, materialization, and side-effect lifecycle work into their
   corresponding phases.
5. Replace runtime side effects/export probing with explicit installers or
   typed hooks.
6. Remove assumptions about Page URL, Document, entry, or render mode.
7. Test the plugin against one SPA and one MPA graph, even if the plugin
   intentionally rejects one topology.
8. Inspect `.ev` to verify producer, target expansion, generated imports, and
   conflict order.
## Required Tests for a Migrated Plugin

- schema defaults and invalid config diagnostics;
- deterministic ordering with required and optional dependencies;
- SPA `page.module` and MPA `page.module` behavior occurs once per Page;
- Application contribution expands once in SPA and to all intended MPA
  entries/Documents;
- Document HTML contribution neither leaks nor duplicates;
- zero-match target and multiple replacement diagnostics;
- generated module import edges and watch inputs;
- runtime hook invocation order and reverse-order cleanup;
- Webpack and Utoopack consume the same semantic BuildPlan;
- `ev inspect` shows the plugin instance, graph patch, facet, and materialized
  entry/Document;
- no Core SSR/PPR/RSC field is required by the plugin.
