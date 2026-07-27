# Generated Contributions IR

`.ev` is the agent-readable framework IR for evjs builds. It records the
resolved Page-and-Route graph, generated framework entries, plugin additions,
and how generated pieces attach to framework slots.

## Concept

A contribution is a declarative unit in the framework IR. It can produce
generated artifacts, link those artifacts together, and attach them to
framework slots.

Keep `contributions(ctx)` deterministic and free of external side effects.
evjs may evaluate it again when contributed source aliases change the
framework graph.

That definition is intentionally narrower than an arbitrary temporary file
system. Plugins do not write random files into `.ev`; they declare artifacts and
relationships. evjs then materializes the final `.ev` tree and manifest.

```mermaid
flowchart TB
  Hook["contributions(ctx)"]

  subgraph Declare["Plugin declarations"]
    Emit["ctx.emit\nmodule / data / entryFacade"]
    Slot["ctx.slot(...).add\nstructured framework attachments"]
  end

  subgraph Link["Generated graph"]
    Ref["GeneratedModuleRef\nopaque handle"]
    Edge["helpers.importOf(ref)\nimport edge"]
  end

  subgraph Materialize["Materialized .ev output"]
    Files[".ev/plugins/<plugin>\ngenerated artifacts"]
    Manifest[".ev/manifest.json\nmodules + slots + importEdges"]
  end

  Hook --> Emit
  Hook --> Slot
  Emit --> Ref
  Ref --> Edge
  Ref --> Slot
  Edge --> Files
  Slot --> Manifest
  Files --> Manifest

  classDef hook fill:#eef6ff,stroke:#8fb5e8,color:#102a43;
  classDef declaration fill:#f3f0ff,stroke:#a78bfa,color:#2e1065;
  classDef output fill:#ecfdf5,stroke:#34d399,color:#064e3b;
  class Hook hook;
  class Emit,Slot,Ref,Edge declaration;
  class Files,Manifest output;
```

## Directory Shape

```txt
.ev/
├── framework/
│   ├── core-graph.json          # normalized Page/Route/Application/Document graph
│   └── build-plan.json
├── entries/
│   ├── main.ts
│   └── server.ts
├── plugins/
│   └── qiankun/
│       └── slave/
│           ├── entry-wrapper.ts
│           └── original-entry.ts
├── manifest.json
└── types.d.ts
```

The structure is stable and readable:

- `framework/` contains the normalized graph, provenance, diagnostics, and
  build-plan snapshots. `core-graph.json` is the single semantic source of
  truth consumed by planning and inspection.
- `entries/` contains framework-owned entry facades consumed by bundlers.
- `plugins/<plugin>/` contains plugin generated artifacts.
- Plugin names are normalized into path segments; a role suffix such as
  `@evjs/plugin-qiankun:slave` becomes `qiankun/slave`.
- `manifest.json` ties together generated artifacts, import edges, slot items,
  producer plugin names, scopes, and final entries.

Generated files may import generated-only `@evjs/ev/_internal/*` helpers when
they need framework runtime internals. Plugin source should not import those
subpaths; plugin authoring uses `@evjs/ev/plugin`. The `ctx.framework` object
is immutable so plugins can inspect the IR but cannot mutate framework state.

## Authoring API

Use `ctx.emit.module()` for generated code, `ctx.emit.data()` for generated JSON
data, and `ctx.emit.entryFacade()` when a wrapper plugin needs to preserve a
framework-generated entry that it is about to replace.

Use `ctx.emit.importOf(ref)` or `helpers.importOf(ref)` to link generated
artifacts together. The returned specifier is valid only inside generated
source. Application source should not import `.ev` paths or
`evjs:generated/*` specifiers.

Use `ctx.slot(name).add(...)` to attach generated artifacts to the framework.
The supported slots are:

| Slot | Covers |
|------|--------|
| `client.entry` | Entry imports and entry wrapper modules, including replacement wrappers |
| `page.wrapper` | Semantic Page component wrapping across client and server projections |
| `server.request.middleware` | Framework request middleware in the server pipeline |
| `html.tag` | Structured `meta`, `link`, `script`, and `style` tags |
| `resolve.alias` | Semantic module aliasing to user modules, packages, absolute paths, or generated artifacts |
| `resolve.external` | Externalized module resolution, usually paired with `html.tag` CDN resources |

Use `client.entry` to import a side-effect module or call an explicit
installer. The IR does not carry an inert runtime-plugin registry.

`client.entry.runtime` accepts only `"client"`. A client entry cannot
materialize server code, so `"server"` and the misleading `"all"` value are
rejected. Use `page.wrapper` for Page component behavior that genuinely
projects to both client and server runtimes.

`page.wrapper` accepts `runtime: "client" | "server" | "all"` and an optional
Application or Page target. Its module must default-export a component that
accepts `children`. It projects to SPA route composition, MPA Page client
entries, and SSR/SSG/PPR-shell/RSC server Page entries as those materialization
points exist. A filter with no matching projection fails. Later contributions
wrap earlier contributions; route layouts and wrappers remain outside plugin
Page wrappers.

An explicit Application/Page target must match a materialized client entry for
`client.entry`, or an HTML Document for `html.tag`.
A semantic SPA page normally shares both with its application, so page-targeted
entry or HTML contributions fail with a diagnostic instead of
becoming silent no-ops.

A canonical MPA exposes one logical `default` Application even though it
materializes one page-client entry and one Document per Page. An Application target
therefore expands `client.entry` to every Page entry and `html.tag` to every
Page Document. `page.wrapper` instead expands through semantic Page ownership,
so the same Application/Page target works in SPA and MPA. A Page target remains
exact. This expansion is recorded in the generated plan. Explicit config-route
input must normalize to the same
Application/Page/Document ownership before using these semantics.

## Boundaries

Generated contributions are the source of truth for file-convention entry
composition and plugin entry/runtime/html/resolution injection. Old virtual
entry loaders should not be reintroduced for those jobs.

The contribution layer does not replace plugin lifecycles:

- Use `config()` for framework config defaults or validation-sensitive config.
- Use `setup()` to allocate plugin state and return lifecycle hooks.
- Use `bundlerConfig()` for low-level bundler features not modeled as slots.
- Use `transformHtml()` for AST-level HTML rewrites.
- Use `buildOutput()` and `buildEnd()` for deployment metadata and final files.

This split keeps the IR readable without pretending every plugin capability is
an entry contribution.

## Agent Workflow

For code review or debugging, inspect `.ev/manifest.json` first:

1. Find the final entry under `entries`.
2. Inspect `generated.modules` for plugin artifacts and producer plugin names.
3. Inspect `generated.slots` to see where artifacts attach.
4. Inspect `generated.importEdges` to understand generated-to-generated imports.
5. Open the matching files under `.ev/entries` and `.ev/plugins`.

This gives agents and humans a complete view of framework-generated code that
would otherwise be hidden behind loaders or arbitrary temporary files.
