# Generated Contributions: Bigfish/Smallfish Parity Report

## Conclusion

The current evjs Generated Contributions IR covers the majority of
Bigfish/Smallfish-style customization that is built from:

- generated temporary modules or data;
- generated modules importing other generated modules;
- entry import/code injection;
- runtime plugin registration;
- structured HTML tag injection;
- semantic alias and external resolution;
- app/page-scoped generated code.

It should not try to replace the full Bigfish/Smallfish plugin ecosystem.
Command registration, dev-server middleware, deployment integration, arbitrary
webpack-chain mutations, custom loader/plugin installation, and deeply
framework-specific runtime internals should remain on existing evjs lifecycle
or bundler hooks.

## Source Evidence

Bigfish uses tmp files as generated modules, then consumes them through entry,
runtime, alias, HTML, or bundler hooks:

- `bigfish-next/src/ctoken/ctoken.ts:20-30` writes `index.ts` and `utils.ts`;
  `:152-166` writes `interceptor.ts`; `:169-183` injects entry imports/code.
- `bigfish-next/src/tern/theme.ts:16-23` writes theme tmp modules; `:27-33`
  registers runtime plugin keys and aliases; `:37-72` injects entry code.
- `bigfish-next/src/basement/autoExternal.ts:187-238` rewrites HTML;
  `:240-297` mutates webpack/mako/utoopack externals; `:299-325` injects
  external scripts and links.

Smallfish exposes the same pattern as core app/page primitives:

- `smallfish-core/src/kernel/instance/app.ts:189-203` models entry code slots;
  `:213-222` adds/updates tmp files; `:399-418` adds HTML tags and AST HTML
  modification.
- `smallfish-core/src/kernel/plugin/context/activate.ts:95-106` exposes
  polyfill, entry, and HTML injection APIs; `:159-166` maps them to entry/HTML
  slots.
- `smallfish-plugin-app/src/dynamic-assets.ts:181-186` injects page-scoped HTML;
  `:226-315` emits app and page tmp files.
- `smallfish-plugin-capr/src/index.ts:384-415` emits page tmp files, injects
  page meta, adds entry imports, and registers runtime plugins.
- `smallfish-plugin-app/src/external-lib.ts:140-180` mutates externals through
  webpack-chain; `:183-190` injects matching external scripts.

## Mapping

| Bigfish/Smallfish capability | evjs IR mapping | Coverage |
|------------------------------|-----------------|----------|
| `writeTmpFile`, `addTmpFile`, `updateTmpFile`, `mediateModules` | `ctx.emit.module()` / `ctx.emit.data()` | Covered for generated code/data with constrained IDs and scopes. |
| Tmp module imports another tmp module | `helpers.importOf(ref)` / `ctx.emit.importOf(ref)` | Covered, with manifest import edges. |
| `addPolyfillImports`, `addEntryImportsAhead`, `addEntryImports` | `slot("client.entry")` with `position` | Covered. |
| `addEntryCodeAhead`, `addEntryCode` | `emit.module()` plus `slot("client.entry")` | Covered without raw inline code. |
| Entry wrapper that still needs original generated entry | `ctx.emit.entryFacade()` plus `client.entry` replace mode | Covered, used by qiankun slave. |
| `addRuntimePlugin`, runtime plugin hooks, runtime plugin keys | `slot("client.runtime.plugin")` plus `exportKeys` | Covered for client runtime plugin registration. |
| Page/app scoped generated code | `scope` and slot `target` | Covered for app/page targets. |
| `addHTMLMetas`, `addHTMLLinks`, `addHTMLScripts`, `addHTMLHeadScripts`, `addHTMLStyles` | `slot("html.tag")` | Covered for structured tags. |
| AST HTML rewrite, `modifyHTML`, `modifyHTMLViaAST` | existing `transformHtml()` lifecycle | Covered outside IR. |
| `alias`, `defineModuleAlias` | `slot("resolve.alias")` | Covered for semantic specifier redirects. |
| `externals`, `externalLib`, `autoExternal` plus CDN resources | `slot("resolve.external")` plus `slot("html.tag")` | Covered for normal externalized resolution; complex array/function externals remain bundler hooks. |
| Dev server middleware, custom commands, deployment files | existing lifecycle/tooling hooks | Not an IR responsibility. |
| Arbitrary bundler plugins/loaders or webpack-chain behavior | existing `bundlerConfig()` hook | Not an IR responsibility. |
| Custom framework server routes or server entry replacement | not in v1 | Intentionally not covered; v1 only exposes `server.request.middleware`. |

## Design Implications

The IR should stay constrained. Bigfish/Smallfish tmp-file systems are powerful
because they are loose, but that looseness makes generated application code
opaque to agents. evjs should prefer:

1. Stable contribution IDs over arbitrary tmp paths.
2. Opaque refs over plugin-owned `.ev` paths.
3. Structured slots over raw entry string concatenation.
4. `entryFacade()` over plugins reconstructing framework internals.
5. Existing lifecycle hooks for non-IR capabilities.

This gives plugin authors most of the tmp-module power while preserving a
manifest that humans and agents can inspect.

## Gaps To Watch

- External resolution may need richer semantic options if internal plugins rely
  on webpack external array/function forms that cannot be represented by a
  simple source/runtime pair.
- Runtime plugin semantics may need server/RSC-specific slots later if evjs
  intentionally exposes those framework surfaces.
- Page-scoped HTML and entry slots are covered, but future nested layout or
  route-group-specific injections should be added as explicit targets instead
  of arbitrary tmp paths.
- Dev-server and deployment ecosystem plugins should remain lifecycle-driven
  unless they need to add generated code visible in `.ev`.
