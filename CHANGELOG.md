# Changelog

All notable changes to evjs are documented here. Releases follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### 🐛 Bug Fixes

- **Aligned plugin planning lifecycle** — Development, inspect, prepare, and
  production builds now finish deterministic `emitIR()` / `emitPageIR()`
  planning before plugin `setup()`. Development and production publish a
  selected generated revision before setup, failed planning no longer allocates
  imperative plugin state, and accepted Sessions retain reverse-order cleanup.

---

## [0.3.13] — 2026-08-17

### ⚠️ Breaking Changes

- **Explicit global middleware composition** — The global server middleware
  anchor moves from `src/middleware.*` to
  `src/middlewares/middleware.*`. It may default-export one middleware or an
  ordered non-empty list. TypeScript authors use `MiddlewareHandler` for one
  handler and `MiddlewareChain` for a directly exported list; no wrapper helper
  is required. Sibling modules are ordinary source imported by the composition
  anchor and are never auto-ordered by filename; route-scoped
  `src/apis/**/middleware.*` still exports one handler. Because EVJS remains
  pre-1.0, this convention change is intentionally eligible for a `0.3.x`
  release and does not require moving the release line to `0.4`.

### ✨ Features

- **Page server entry imports** — Plugins can import generated or authored
  modules at ordered positions around an exact Page-owned `page-server` entry.
  Import contributions compose with the existing replacement mode without
  changing other server renderer kinds.

### ✨ Improvements

- **Faster framework development startup** — Development dependency collection
  collapses ordered source-resolution probes into directory topology watches,
  reuses prepared watcher plans, and shares Page-config loading sessions while
  preserving higher-priority candidate invalidation and package-scoped module
  resolution.

### 🐛 Bug Fixes

- **Complete Session watch coverage during startup** — Plugin and bundler watch
  files become observable as soon as they are registered, preventing edits
  during adapter startup from leaving the active immutable Session on stale
  input. Replacement Sessions also reconcile final watcher ownership.

---

## [0.3.12] — 2026-08-14

### ✨ Features

- **Low-end browser compatibility** — Applications can opt into Android 5 and
  iOS 8 or newer production targets with ES5 syntax by configuring numeric
  Android/iOS versions, which bundle `core-js/stable` by default. An absolute
  `polyfill.coreJs` UMD URL overrides the bundled source. Development and server
  targets are unchanged.

### ✨ Improvements

- **Faster configuration loading** — Installed packages imported by EVJS
  configuration are loaded natively, reducing startup overhead while
  project-local TypeScript configuration and helper modules remain fresh for
  development reloads.

---

## [0.3.11] — 2026-08-12

### ✨ Features

- **MPA SSR client fallback Documents** — Hydratable MPA SSR Pages now emit an
  empty, independently bootable CSR fallback HTML Document with their client
  assets and HTML transforms. Request-time server shells derive from that same
  transformed Document while preserving server-rendered deployment routes.

---

## [0.3.10] — 2026-08-12

### ✨ Features

- **Server-specific build configuration** — Applications can declare
  `server.resolve.alias` and `server.externals` without changing client
  resolution. Webpack and Utoopack keep both settings isolated in mixed builds.
- **Lower camel case plugin ids** — Plugin ids can use lower camel case as well
  as lowercase kebab-case. Mixed camel/kebab ids and case-folded collisions
  remain invalid so generated paths and settings stay portable across
  case-sensitive and case-insensitive filesystems.

### 🐛 Bug Fixes

- **Utoopack server alias isolation** — Mixed client/server builds now map
  `server.resolve.alias` to Utoopack's server-scoped resolver, allowing matching
  client and server aliases to resolve to different targets while preserving
  project-relative alias replacements for Utoopack 1.5.4.

---

## [0.3.9] — 2026-08-11

### ✨ Features

- **Dev server ready plugin hook** — Plugins can consume the actual client
  origin through `devServerReady()` once per immutable development Session,
  without wrapping or replacing the selected bundler adapter.

---

## [0.3.8] — 2026-08-11

### 🐛 Bug Fixes

- **Direct MPA Document development rendering** — MPA `.html` Document requests
  now enter React framework rendering without the internal development proxy
  header. SPA requests keep the existing header guard, and extensionless MPA
  semantic routes remain unavailable.

---

## [0.3.7] — 2026-08-10

### ⚠️ Breaking Changes

- **Immutable bundler development sessions** — Internal bundler adapters now
  return a controller with `origin`, `done`, and idempotent `close()` instead of
  implementing in-place framework plan transitions. Development callbacks are
  scoped to one fixed config, plugin, graph, and plan snapshot.

### ✨ Features

- **Utoopack multi-entry server builds** — Utoopack now forwards named
  `server-runtime` and `page-server` BuildPlan entries, maps each entry back to
  its emitted server assets, and preserves shared chunks. Regular server builds
  are supported while the legacy scalar runtime entry remains compatible.
- **Plugin-driven development shortcuts** — Interactive `ev dev` terminals can
  expose plugin-contributed keyboard shortcuts with descriptions, asynchronous
  actions, and shutdown support. Bindings update safely across configuration
  replacement and can be disabled with `dev.cliShortcuts` or
  `ev dev --no-shortcuts`.
- **Canonical MPA Document URLs** — MPA Pages now materialize as `index.html`,
  `about.html`, and nested `foo/bar.html` Documents while retaining their
  semantic routes. Development SSR and PPR requests use the same public URLs
  and resolve back to their canonical Pages.

### 🐛 Bug Fixes

- **Stable framework update recovery** — `ev dev` now keeps filesystem watching,
  ports, and scheduling in a long-lived supervisor. Authored changes are
  prepared without filesystem output and replace the active bundler session
  only when their semantic fingerprint changes. Invalid or transient inputs
  keep the last valid session and are retried only after another real input
  change, preventing repeated manifest generation and restart-required loops.
- **Disposable generated development IR** — Framework IR is rendered and
  validated in memory, then rebuilt directly under canonical `.ev` after the
  previous session closes. Whole-tree candidate, previous, restore, and system
  temporary snapshots are no longer created.
- **Graceful Utoopack session replacement** — Utoopack now keeps its native
  process-wide loader scheduler in the long-lived host while each Session owns
  an isolated project, server, and persistent-cache lock. Replacement waits
  for project cleanup; a stuck or failed shutdown stops instead of overlapping
  two dev Sessions on the same cache and ports.

---

## [0.3.6] — 2026-08-06

### ✨ Improvements

- **Public SPA Router replacement** — Generated Pages apps defer initial Router
  construction until runtime base and history projection, then load replacement
  Routers through TanStack's public APIs for later base, history, or runtime
  Route-overlay updates. Replacement preserves the shared Query client and
  commits only after the candidate Router is ready.

### 🐛 Bug Fixes

- **Race-safe Router remounting** — Runtime replacement and rollback now use the
  latest mount state after asynchronous Router loading, so an intervening
  `unmount()` stays unmounted and an intervening `render()` moves onto the
  replacement Router instead of leaving the application blank.
- **Committed qiankun projection rollback** — Qiankun slave lifecycles roll back
  runtime projection only after it succeeds, avoiding duplicate rollback and
  history restoration when projection itself fails.

---

## [0.3.5] — 2026-08-06

### ✨ Features

- **Page server entry replacement** — Plugins can replace an exact Page-owned
  `page-server` entry through the replacement-only `server.entry` contribution
  slot while preserving framework entry, renderer, manifest, and import-edge
  identity. Invalid Page targets and duplicate replacements are rejected.

### 🐛 Bug Fixes

- **Stable Utoopack HMR transitions** — Utoopack now watches generated `.ev`
  inputs independently while EVJS relinks topology-preserving updates from the
  last published build facts, removing timestamp invalidation and the
  `stats.json` transition barrier that made HMR unreliable.
- **Resilient development watching** — EVJS canonicalizes dependency ordering,
  recovers from atomic symlink replacement races, and falls back to polling
  with per-target backoff when native watchers exhaust resources or close.

---

## [0.3.4] — 2026-08-04

### ✨ Improvements

- **Qiankun slave post lifecycles** — Optional slave runtimes can use
  `afterMount()` after projection and entry rendering succeed, and
  `afterUpdate()` after mounted updates settle. Post lifecycles participate in
  the serialized slave queue without requiring integrations to wrap generated
  entry methods.

### 🐛 Bug Fixes

- **Stable Webpack development entry assets** — HMR assets are identified from
  Webpack stats metadata and excluded from canonical client entry assets while
  remaining in the emitted-file inventory, preventing replacement compilations
  from failing single-entry validation.

---

## [0.3.3] — 2026-08-03

### 🐛 Bug Fixes

- **Qiankun sub-app browser history synchronization** — Qiankun masters now
  forward same-base host location changes to mounted slaves, and slave Routers
  reconcile native browser back/forward navigation without requiring an
  application-level `popstate` workaround. Browser and hash history adapters
  are scoped per app and retain the active wrapper during rollback, preventing
  stale shared `window.history` restoration.

---

## [0.3.2] — 2026-08-03

### ⚠️ Breaking Changes

- **Single plugin configuration model** — Applications install typed plugin
  factories in `config.plugins`; Pages use one generated `plugins` map keyed by
  canonical plugin ids. The previous owner-scoped extension registries and
  separate Route or Document configuration surfaces are removed.
- **Canonical plugin identity** — Plugins now declare one lowercase `id`, used
  unchanged for installation, Page settings, dependency ordering, CoreGraph
  catalog entries, diagnostics, and `.ev/plugins/<id>` output. The previous
  `name`, `key`, `settingsKey`, and generated `pluginName` fields are removed;
  package-like ids, unsafe object-property ids, and Windows device basenames
  are rejected when plugins are defined and when graph snapshots are validated,
  before generated-IR processing.
- **Application-level qiankun route overlay** — The qiankun master no longer
  exposes a Page contract or derives micro-app bindings from `page.config.ts`.
  Its async Application resolver returns the authoritative `apps/routes`
  snapshot and installs prepend, match, redirect, and micro-app route
  components before the first render. Resolver routes no longer require fixed
  containers, `activeRule`, or physical Pages at the mounted master paths.
  Public apps use only canonical `name`/`entry` identity; alternate identity
  fields and per-app credential rewriting are removed. Unknown master, app,
  and route fields now fail instead of being ignored. Platform integrations
  must normalize external records and provide request policy explicitly.
- **Transactional bundler dev contract** — Persistent custom bundler adapters
  must reserve each framework update with `beginUpdate()`, activate the supplied
  generation at their serialized plan boundary, and resume either accepted or
  restored input. Transition finalization is now two-phase:
  `prepareFinalize()` performs fallible work while keeping the boundary
  reserved, and synchronous `finalize()` releases it only after Core commits
  canonical output. `onBuildFacts()` now returns `"published"` or `"discarded"`;
  adapters may acknowledge compiler facts and signal server readiness only
  after publication.
- **Static deployment metadata** — Plugin-owned `BuildOutput.deployment` values
  must be plain, losslessly JSON-serializable objects. Functions, accessors,
  non-finite numbers, negative zero, unsafe keys, sparse arrays, and cycles are
  rejected before output publication; each deployment projection is now an
  isolated snapshot.
- **Plugin authoring API reset** — `definePlugin()` now uses `pluginOptions()`,
  `configure()`, `setup()`, `emitIR()`, and `emitPageIR()`. Hooks
  returned by `setup()` use `configureBundler()`, `beforeBuild()`,
  `transformOutput()`, `transformHtml()`, `afterBuild()`, and `dispose()`.
  Public context types follow those stage names, and contribution code reads
  the normalized `FrameworkView`. The previous authoring names and internal
  `DefinedPlugin*` inference types are no longer exported.
- **Single build environment signal** — Plugin contexts and the programmatic
  prepare/inspect build APIs expose only `mode: "development" | "production"`.
  The redundant `command: "dev" | "build"` field and option are removed.
- **Application-owned plugin installation** — Plugin `configure()` hooks now
  receive and return only framework configuration. They cannot add, remove,
  reorder, or replace `config.plugins`; the Application's original plugin
  installation remains authoritative across the complete lifecycle. Resolved
  plugin contexts receive one isolated, frozen framework-config view.
- **Output-cycle build hooks** — `beforeBuild()` now runs after fresh bundler
  facts arrive and before evjs links or emits canonical output. Successful
  initial and rebuild cycles pair it with `afterBuild()` using the same
  `isRebuild`; failures before publication and the `prepare`/`inspect` staging
  paths do not call the pair.
- **Application-owned Server Functions** — `createServerFunctionRegistry()`
  now owns registration and dispatch for one `createApp()` instance. Generated
  server entries explicitly register discovered exports in that registry;
  server transforms no longer mutate a process-global registry. Utoopack's
  required server transform module records weak action-ID metadata so generated
  entries can bind bundler IDs to the application-owned registry. The global
  `registerServerReference()` and `dispatch()` exports and their internal
  registration subpaths are removed.

- **Canonical server entry assets** — Redundant `serverEntry`, `serverAssets`,
  and `serverModules` build facts are removed. Adapters must report every
  server entry through `serverEntryAssets`, keyed by its exact BuildPlan name,
  with one self-contained JavaScript asset per entry. Complete server asset
  inventories reject missing entry assets and unowned JavaScript chunks.
  Server Functions and API Routes receive isolated snapshots of the canonical
  server runtime assets.
- **Webpack hook configuration set** — `@evjs/bundler-webpack` now exports the
  plural `WebpackConfigs` type. Its adapter and typed `webpack()` helper always
  expose the complete `Configuration[]` set; the ambiguous singular-or-array
  `WebpackConfig` type is removed.
- **Bundler-neutral Core types** — `@evjs/ev/config` no longer exports
  `DefaultBundlerConfig` or depends on `@utoo/pack` for its type. Core generic
  defaults are opaque; bundler-specific plugins must use the selected adapter's
  typed helper or an explicit generic. `@evjs/cli` still exposes its concrete
  Utoopack default.
- **Canonical manifest projection** — The unused split
  `PublicManifestOutput` / `ServerManifestOutput` protocols and their
  `createPublicManifest()` / `createServerManifest()` helpers are removed.
  Framework output remains one `BuildOutput`, with `DeploymentMetadata` as its
  deployment-safe projection.
- **Runtime API cleanup** — Custom `TransportAdapter` implementations must
  provide `send()` at initialization. `RouteHandler` now derives `Allow` from
  its immutable method map. The unused `ShellOptions.onWarning`,
  `ShellWarningContext`, client RSC debug JSON helpers, and
  `ReactRscDebugPayload` are removed. The RSC Flight adapter also no longer
  accepts `createProps`; RSC integrations render Flight responses directly.
- **Explicit qiankun slave containers** — Slave entry code mounts through the
  container supplied by qiankun. The plugin no longer rewrites global
  `document.querySelector()` or `document.getElementById()` during lifecycle
  calls.

### ✨ Improvements

- **Stable Page plugin types** — `prepare`, `dev`, and `build` generate
  `src/plugin-types.d.ts` as a static bridge to `ev.config.ts`, so ids and Page
  values for definitely installed plugins retain editor types without Page
  imports. JavaScript config stays isolated from `any` rather than claiming
  exact Page plugin ids.
- **Predictable plugin activation** — Plugin factories distinguish normal
  installation from Page-only opt-in with `forPages()` on defaultable Page
  contracts. Falsy entries in `config.plugins` conditionally omit a plugin; on
  an omitted Page, a normal installation uses declared Page defaults when
  available, while `forPages()` always requires `true` or an options object.
- **Composable plugin defaults** — Application and Page contracts remain
  independent, while authored fields deep-merge over defaults within each
  contract before validation.
- **Direct plugin pipeline state** — Defined-plugin metadata now travels as a
  non-enumerable instance field shared by config-loaded module copies. The
  versioned `globalThis` registry and its parallel WeakMap bookkeeping are
  removed, while plugin contexts continue to hide build-only options.
- **Qiankun runtime base projection** — A mounted slave now projects the
  master-provided base and history into its generated Pages app before the first
  render. Master runtime overlays remain outside the canonical CoreGraph,
  BuildPlan, deployment routes, and generated `RoutePath` types, while platform
  plugins can reuse the public qiankun contribution and lifecycle-hook helpers.

### 🐛 Bug Fixes

- **Preserve generated runtime record keys** — Dev, Node, and Edge bootstraps
  now deserialize framework runtime JSON instead of emitting an object literal,
  preserving own prototype-shaped identifiers such as `__proto__`.
- **Complete server runtime outputs** — Linked manifests and deployment
  projections now reject routed SSG without a static Document and require one
  canonical self-contained runtime entry for request-time SSR, PPR, RSC,
  server Functions, API Routes, runtime renderers, and runtime assets. Pure CSR
  and fully materialized SSG output remain runtime-free.
- **Fail-closed plugin validation** — Application and Page plugin validators
  now accept only documented synchronous results. Promise-like and unsupported
  return values fail with explicit contract diagnostics instead of silently
  enabling invalid configuration.
- **Preserve BuildPlan entry ownership** — Utoopack and webpack now validate
  framework entry sets and exact imports after every `configureBundler()` hook.
  Hooks can no longer replace canonical entry source or publish an unplanned
  entry through a framework-owned client or server config. Independent webpack
  configs require an explicit output path that cannot overlap framework output
  under portable, case-insensitive path identity.
- **PPR cache origin isolation** — Request-time PPR region cache keys now
  include the source URL origin, preventing one hostname from reusing another
  hostname's cached region response when a server instance hosts multiple
  origins.
- **Resilient dev dependency watching** — Framework dependencies in the same
  directory share one native watcher, and project-local config imports remain
  part of the reload closure. When the operating system exhausts native watcher
  resources, the affected watcher set falls back to explicit dependency polling
  and later watcher sets stay in polling mode; permission and unknown watcher
  failures terminate the session after running cleanup instead of leaving dev
  running with incomplete coverage. Repeated native notifications for the same
  dependency snapshot are coalesced without dropping later file revisions or a
  stronger config-reload requirement.
- **Transactional dev updates** — Framework plan changes now reserve an adapter
  generation before writing candidate `.ev` input and publish fresh build facts
  only after the selected state is stable. Failed updates restore generated IR,
  generated types, plugin state, and canonical framework output before the
  previous generation resumes; shutdown also cancels outstanding compiler-stat
  polling. When Webpack invalidates an in-flight watch compilation before its
  terminal hooks run, evjs discards its stale build facts so the replacement
  compilation can publish the selected generation.
- **Strict static config reload closure** — Config and Page-config loading now
  observes missing candidates, `require.resolve()` targets, package maps, and
  transitive project-local imports before evaluation. Unreadable sources,
  escaped file URLs or symlinks, and invalid package-map semantics fail closed
  instead of falling through to a lower-priority or unobserved module.

---

## [0.3.1] — 2026-07-29

### ⚠️ Breaking Changes

- **Fixed server request-route root** — Framework request Routes are always
  discovered from `src/apis/**/api.*` while file conventions are enabled. The
  public `server.routing` object and its `dir` override are removed; use
  top-level `conventions: false` to disable the complete framework filesystem
  convention set.
- **Narrower internal runtime surface** — The unused
  `@evjs/client/internal/route-types` export is removed, and
  `registerServerReference()` now accepts only the function and function id.

### 🐛 Bug Fixes

- **Convention-root containment** — Graph inspection and middleware discovery
  tolerate missing or non-directory convention roots and do not traverse
  source or API-root symlinks that resolve outside the project.
- **Utoopack HTTPS validation** — Utoopack development rejects unsupported
  custom `dev.https` certificates instead of silently treating them as
  `true`; Webpack remains the explicit-certificate path.

---

## [0.3.0] — 2026-07-28

### ⚠️ Breaking Changes

- **Canonical Page-and-Route model** — `src/pages/**/page.*` is the only
  file-convention Page and client Route anchor. Its containing directory defines
  Page identity, scope, and URL. The same semantic tree serves SPA and MPA;
  `routing.mode` selects only its materialization. Client `routing.dir` is no
  longer configurable.
- **Page configuration contract** — Static Page `title`, named `meta`, rendering
  settings, and namespaced extensions now come from adjacent build-time
  `page.config.ts` modules rather than Page component exports or alternate
  config readers.
- **Explicit SPA route trees** — `application.routes` remains a SPA-only input,
  accepts `routes` rather than `children` for nesting, and uses
  `application.pageRoot` as the source boundary for both `page` and `component`
  references. It cannot be combined with canonical `routing.mode` discovery.
- **CSR hydration boundary** — Pages default to CSR and CSR must omit
  `hydrate`. Explicit SSR and SSG Pages may select `"load"` or `"none"`; RSC and
  partial prerendering remain unhydrated at Page level.
- **Current-only authoring surface** — evjs exposes only the canonical `page.*`
  plus `page.config.ts` conventions and the explicit SPA route-tree input.
  Route capability data is no longer a built-in field; plugins own it through
  registered, namespaced `route.extensions`.
- **Server request-route anchors** — Server request routes now require
  `<server.routing.dir>/**/api.*` anchors, defaulting to `src/apis`. Each
  anchor's containing directory defines its URL and middleware scope, while
  every other basename remains private source.
- **Owned output directories** — `output.client` and `output.server` must now
  use portable `/`-separated project-relative paths without empty, `.`, `..`,
  platform-reserved, or cross-platform aliasing segments, and resolve as
  separate, non-nested, symlink-free strict descendants of the BuildPlan
  `distDir`. Build entry names, HTML paths, generated files, and deployment
  artifact names follow the same portable identity rules. The BuildPlan is
  authoritative for framework output; `bundlerConfig()` hooks can no longer
  override client or server paths.
- **Concrete runtime endpoints** — Server runtime paths now accept only
  concrete ASCII URL-safe segments without empty, `.`, or `..` segments. Active
  server-function and RSC exact endpoints must be distinct and stay outside the
  active PPR subtree; Page, redirect, and server request Route patterns cannot
  claim reserved runtime paths.
- **Disjoint request Routes** — URL-owning Page and redirect patterns must be
  disjoint from server request Route patterns. Conflict checks cover static,
  dynamic, and terminal splat intersections and compare static percent aliases
  after exactly one URL decode.
- **Explicit dev route ownership** — `DevBuildPlan.serverRoutePaths` is replaced
  by `serverRequestRoutePaths` and `serverRenderedPagePaths`, so bundler adapters
  can distinguish request Routes from Pages that require server rendering.
- **Framework-owned BuildOutput semantics** — `buildOutput()` hooks may now
  change only contents of existing `AssetGroup` values and add `deployment`
  metadata. Build ids, paths, runtime settings, server identities, graph
  semantics, record keys, and array order remain owned by the finalized graph
  and BuildPlan.

### ✨ Improvements

- **Unified framework graph** — Applications, Pages, Routes, and Documents now
  normalize through one CoreGraph and BuildPlan into generated `.ev` framework
  IR, giving convention discovery, plugins, bundlers, manifests, and deployment
  one semantic source of truth.
- **Owner-scoped plugin extensions** — Plugins can register strict JSON
  extension namespaces for Application, Page, Route, and Document owners.
  Application values resolve before `setup()`, while graph analysis resolves
  Page, Route, and Document values without adding framework-specific fields.
- **Deterministic route semantics** — Page and server route discovery now share
  segment-wise specificity ordering, with static segments taking precedence at
  the first differing position. CoreGraph uniqueness and runtime matching use
  the same one-decode identity for raw, percent-encoded, and Unicode static
  aliases without collapsing encoded path separators or double encodings;
  explicit segments that decode to `.` or `..` are rejected, and request
  matching no longer erases internal empty segments or repeated trailing `/`.
- **Server handler diagnostics** — `api.*` discovery rejects statically known
  non-callable and generator handlers early while preserving imported,
  re-exported, factory-produced, and mutable callable composition forms.
- **Plan-driven dev routing** — Dev proxies now come only from the active
  BuildPlan: server-function and RSC endpoints match exactly, PPR owns only its
  active subtree, and `/api` has no implicit server or SPA-fallback meaning.
- **Project operation coordination** — `prepare`, `build`, and `dev` now use one
  secure per-project cross-process operation lock, so concurrent commands
  cannot race while materializing `.ev`, route types, manifests, or deployment
  output. Dev session and port locks use the same atomic, owner-verified lock
  lifecycle.
- **Explicit dev update semantics** — BuildPlan updates distinguish server
  compilation inputs, request-time Documents, and development routing.
  Metadata and Document-only changes can refresh framework output without
  claiming that persistent compiler inputs changed; unsupported structural
  changes still fail closed and request a dev restart.

### 🐛 Bug Fixes

- **Adapter output consistency** — Webpack and Utoopack now use BuildPlan output
  and runtime data consistently for bundling, cleanup, stats, manifests, and
  dev server-bundle discovery, including custom `output.server` layouts.
- **Adapter lifecycle safety** — Utoopack development runs its process-owned
  server in a stoppable worker, propagates unexpected exits, preserves
  function-valued proxy rewrites, and monitors server stats across atomic file
  replacement. Webpack cleans up failed startup, keeps compiler-owned chunks
  disjoint, and serves plans without client entries through its static host.
  Dev API replacement terminates failed candidates and restores the last ready
  runtime when a framework plan refresh rolls back.
- **Build-only browser resources** — Webpack publishes build-phase CSS and only
  the emitted resources that its parsed URLs actually reference. Copying is
  portable-path aware and transactional across rebuilds, so private server
  artifacts, client-owned aliases, or a failed refresh cannot corrupt the
  active public output.
- **Development SSG output** — Clientless fully static Pages are prerendered on
  initial development output and rebuilds, keeping their HTML useful without a
  browser entry while preserving production-equivalent Page semantics. Their
  canonical routes stay on the static dev host rather than entering the
  request-time server proxy.
- **Server artifact containment** — Server-relative bundle artifacts are
  validated before linking, after each output hook, before prerendering, and
  again at deployment load boundaries. The server entry must be declared by
  its JavaScript asset group, and generated Node/Edge loaders accept only the
  declared server JavaScript allowlist.
- **Collision-free deployment output** — HTML and deployment artifact
  reservations now reject case, Unicode, exact-path, and file-versus-directory
  overlaps before framework or adapter writes begin. Webpack and Utoopack
  expose complete emitted-file inventories when their stats support it, so
  unlinked async chunks are included in the same preflight; an absent inventory
  remains explicitly unknown rather than pretending the output is empty.
- **Deployment route parity** — Generated Node and Edge matchers now use the
  same one-decode segment identity as client and dev routing, preserve planned
  static document filenames, and do not collapse internal repeated slashes.
  Server-function and RSC endpoints match exactly, only PPR owns a subtree,
  and `server.basePath` is no longer treated as a catch-all namespace.
- **Rendering failure safety** — Framework rendering reports detailed errors
  server-side while production responses stay generic, and successful RSC
  Flight responses preserve their original bytes and content length.
- **Shell disposal** — Client shell disposal now attempts every driver cleanup
  and Page unmount, always clears active state and caches, and reports one or
  multiple cleanup failures without leaving the shell half-disposed.
- **Convention watcher recovery** — Development watches safe project ancestors
  when a Page or server Route root is missing or temporarily invalid, ignores
  sources reached through escaping symlinks, and resumes discovery when a valid
  local root is restored.

### 🧹 Code Quality

- **Focused build modules** — Extracted shared route conventions and ordering,
  runtime-server planning, output ownership/safety, dev watching, and CLI
  program orchestration into focused modules with boundary-level tests.
- **Physical output ownership** — Removed the obsolete physical
  `client/manifest.json` reservation. Deployment collision checks now describe
  only files actually emitted by the framework, linked output, or the bundler
  inventory.
- **Independent output owners** — Linked Applications, Pages, server
  functions, and server Routes receive distinct mutable asset groups, so a
  permitted `buildOutput()` content change cannot leak into another owner or a
  later rebuild.
- **Shared validation contracts** — Centralized route specificity,
  one-decode static segment semantics, and concrete runtime path validation
  across graph planning, manifests, browser bootstrap, and server runtime.

---

## [0.2.16] — 2026-07-21

### ⚠️ Breaking Changes

- **Raw page search params** — evjs-managed SPA, MPA, SSR, and RSC page search params now use `Record<string, string>` without implicit number, boolean, or JSON coercion. Repeated query keys keep the last value; applications should convert values explicitly in `validateSearch`.

### ✨ Improvements

- **Concurrent dev sessions** — Added per-project dev session locking and cross-process client/server port coordination so duplicate starts fail clearly while different apps select predictable available port pairs.
- **Dev server addresses** — Made both `localhost` and `127.0.0.1` available for client and API development servers and standardized startup output with `Local` and `Network` labels.

### 🐛 Bug Fixes

- **SPA fallback port isolation** — Keeps the Utoopack SPA history fallback synchronized with the actual listener reported at startup, including last-second port changes, so routes cannot be served by another app on the originally configured port.

---

## [0.2.15] — 2026-07-21

### ✨ Improvements

- **Plugin CLI flags** — Exposed extra `ev dev`, `ev build`, and `ev prepare` command-line flags through plugin contexts, with support for boolean, string, dashed, and repeated flag values.

---

## [0.2.14] — 2026-07-20

### 🐛 Bug Fixes

- **Qiankun Utoopack slave builds** — Stopped configuring Utoopack client entries as UMD libraries, exposed qiankun lifecycle methods through the application global, and injected a lifecycle proxy before the HTML entry so server assets are emitted correctly.

---

## [0.2.13] — 2026-07-20

### 🐛 Bug Fixes

- **Framework build lifecycle** — Hardened framework build and rendering lifecycle handling across generated client and server runtimes.
- **Utoopack Less support** — Pinned `less` and `less-loader` in `@evjs/bundler-utoopack` and wired the bundled implementation into the generated loader config so Less styles build consistently.

---

## [0.2.12] — 2026-07-09

### 🐛 Bug Fixes

- **Build tools config loader** — Narrowed the public `@evjs/ev/build-tools` subpath to `loadConfigFile` and deferred the React framework server import used for SSG prerendering, keeping config loading usable without loading React runtimes at module import time.

---

## [0.2.11] — 2026-07-09

### 🐛 Bug Fixes

- **Build tools subpath** — Restored the public `@evjs/ev/build-tools` subpath so downstream tooling can continue importing helpers such as `loadConfigFile` without using `_internal` paths.

---

## [0.2.10] — 2026-07-09

### ✨ Improvements

- **Generated contributions IR** — Added the `.ev` generated contributions layer for convention results, framework entry facades, plugin generated artifacts, slot attachments, import edges, and final manifest materialization.
- **Plugin authoring API** — Exposed immutable framework IR views and contribution emitters from `@evjs/ev/plugin`, including `ctx.emit.entryFacade()` for entry-wrapper plugins.
- **Prepare command** — Added `ev prepare` so projects can materialize `.ev` framework IR for inspection without running a full bundle.

### 🐛 Bug Fixes

- **MPA dev server output** — `ev dev` in MPA mode now prints one consolidated readiness block with every generated page URL and suppresses the duplicate Utoopack server banner.

### 📝 Documentation

- **Generated IR docs** — Added English and Chinese generated contributions docs, refreshed architecture/plugin/overview guidance, refined the docs homepage, and updated the plugin-authoring example.

---

## [0.2.9] — 2026-07-07

### 🐛 Bug Fixes

- **SPA catch-all routes** — Generated catch-all page routes now emit TanStack-compatible `$` route paths, keeping direct URL matches, generated route types, and navigation helpers aligned.

---

## [0.2.8] — 2026-07-04

### ✨ Improvements

- **SPA file routes** — SPA page discovery now preserves URL-safe casing for static route segments and supports terminal `$...splat` catch-all file routes that emit `*` route paths.
- **Wildcard route typing** — Generated route helper types expose wildcard params as `_splat`, matching runtime params and browser-facing manifest output.

### 📝 Documentation

- **Route conventions** — Updated English and Chinese docs for case-preserving static segments, terminal catch-all syntax, and the stricter MPA/server route boundaries.

---

## [0.2.7] — 2026-07-02

### ⚠️ Behavior Changes

- **Framework runtime endpoints** — Framework runtime `fn`, `ppr`, and `rsc` endpoints are now stored as relative values such as `__evjs/fn`, `__evjs/ppr`, and `__evjs/rsc`. Server mounting, dev proxying, and deployment route generation convert them back to URL pathnames at their use sites.
- **Runtime endpoint validation** — Client, server, and manifest runtime validation now reject framework runtime endpoints that start with `/`, keeping transport prefixes owned by runtime transport configuration.

### 🐛 Bug Fixes

- **Transport URL resolution** — Server function and RSC Flight requests now resolve relative framework endpoints under the configured transport `baseUrl`, preserving gateway path prefixes for hosted runtimes.

---

## [0.2.6] — 2026-07-02

### ✨ Highlights

- **Qiankun bridge plugin** — Added `@evjs/plugin-qiankun` with master and slave plugin APIs, runtime helpers, entry loader integration, examples, docs, and E2E coverage.
- **Runtime transport globals** — Added runtime transport global support and centralized runtime transport lookup so server functions and RSC can resolve runtime endpoints without a fixed transport endpoint.

### 🐛 Bug Fixes

- **Utoopack runtime** — Required the Utoopack runtime from the adapter so generated bundles include the runtime module they depend on.

### 📝 Documentation

- **Qiankun integration** — Added English and Chinese qiankun guides plus master and slave example apps.

---

## [0.2.5] — 2026-06-30

### ⚠️ Behavior Changes

- **Server file routes** — `src/apis` is now discovered by default. Apps no longer need `server: { routing: true }` for conventional server routes.
- **Convention opt-out** — Apps with existing files under `src/apis` that should not become server routes can use the advanced convention controls documented in Reference.

### ✨ Improvements

- **Default server routing** — Resolved omitted `server.routing` to the default `src/apis` route directory and kept server middleware conventions enabled with default server route discovery.
- **Examples** — Removed redundant `server.routing: true` config from examples now covered by defaults.

### 📝 Documentation

- **Default docs** — Removed convention-disabling switches from default guides so the common path stays file-convention first.
- **Advanced convention control** — Added English and Chinese Reference docs for disabling default conventions and using programmatic `@evjs/client` / `@evjs/server` apps.

---

## [0.2.4] — 2026-06-30

### ⚠️ Breaking Changes

- **Framework module surface** — Slimmed the `@evjs/ev` root entry to the minimal config/plugin authoring API: `defineConfig`, `Config`, `EvConfig`, `Plugin`, and `EvPlugin`.
- **Semantic authoring subpaths** — Moved file-convention application APIs to curated `@evjs/ev/route`, `@evjs/ev/navigation`, `@evjs/ev/query`, `@evjs/ev/server-context`, and `@evjs/ev/transport` subpaths.
- **Internal entry cleanup** — Removed the old `@evjs/ev/page`, `@evjs/ev/request`, `@evjs/ev/build-tools`, and `@evjs/ev/internal/*` public entry points without compatibility aliases. CLI, bundler adapters, manifest helpers, and generated runtime bridges now use `@evjs/ev/_internal/*`.

### ✨ Improvements

- **Config and plugin boundaries** — Split advanced config helpers into `@evjs/ev/config`, plugin authoring details into `@evjs/ev/plugin`, and deployment adapters into `@evjs/ev/deployment`.
- **Runtime source organization** — Reorganized `@evjs/client` source by standalone, framework page/shell, server-function, RSC, and shared domains; reorganized `@evjs/server` source by app, request context, server functions, routes, framework rendering, runtimes, and shared domains.
- **Generated route typing** — Updated generated route declarations to augment `@evjs/ev/route`, keeping file-convention route types aligned with the new authoring surface.

### 📝 Documentation

- **Import ownership principle** — Documented that file-convention apps import curated `@evjs/ev/*` authoring APIs, generated/adapter code uses `_internal`, and `@evjs/client`/`@evjs/server` remain lower-level standalone/manual runtime packages.
- **Migration examples** — Updated examples, templates, English and Chinese docs, and agent guides to use the new package boundaries.

---

## [0.2.3] — 2026-06-30

### ⚠️ Breaking Changes

- **Generated metadata contracts** — Reworked `dist/build-output.json`, `dist/client/manifest.json`, and `dist/server/manifest.json` into lightweight deployment metadata. Runtime-only RSC references, render coordination data, module records, chunk records, and duplicate asset groups are no longer exposed through deployment manifests.
- **Runtime artifact cleanup** — Stopped emitting default `client/runtime.json`, `server/runtime.json`, and `server/framework-runtime.json` files. Framework runtime data is now embedded into generated HTML or server bootstrap code when it is required at runtime.
- **Framework import surface** — Converged framework-facing imports on `@evjs/ev` and aligned server function runtime subpaths. Applications should depend on the top-level evjs package surface instead of importing framework internals from runtime packages.
- **Server route conventions** — Moved discovered server file routes to the `src/apis` convention with middleware support and reflected them as lightweight `api-route` entries in deployment/server metadata.

### ✨ Improvements

- **Canonical deployment metadata** — Made `build-output.json` the compact deployment view with documents, static assets, server entry, server pages, server functions, PPR/RSC endpoints, and API routes grouped by deployment semantics.
- **Lightweight manifests** — Kept `client/manifest.json` focused on public assets plus SPA/MPA routing, and kept `server/manifest.json` focused on `entry` plus server route capabilities.
- **SSG support** — Added build-time static page generation for `render = "ssg"` pages, including nested routes and a dedicated multi-page SSG example.
- **SPA route boundaries** — Added explicit SPA route boundary support and source alias resolution across client/server framework output.
- **Server routes and middleware** — Added file-based server routes, route middleware discovery, const route path helpers, and examples covering API routes, render modes, and deployment adapters.
- **Trusted publishing** — Updated the release workflow for npm trusted publishing through GitHub Releases.

### 🐛 Bug Fixes

- **Source alias server functions** — Fixed server function discovery and references when projects use source aliases.
- **Static generation output** — Prevented SSG builds from leaking intermediate page entry files into the final client output.
- **NPM provenance metadata** — Updated package repository metadata so trusted publishing provenance matches the `afx-team/evjs` GitHub repository, wired the release workflow to the configured npm token, and made workspace publishing skip already-published versions during release recovery.

### 📝 Documentation

- **Artifact and routing docs** — Refreshed build, deploy, config, plugin, architecture, client routes, server routes, file conventions, and project structure docs in English and Chinese for the tightened metadata and routing contracts.

---

## [0.2.2] — 2026-06-24

### ✨ Improvements

- **Build output manifests** — Aligned framework output around the root `BuildOutput` manifest while keeping client and server runtime manifests in their respective output directories.
- **Runtime public path** — Defaulted build plans to `publicPath: "auto"` and passed that through Utoopack and webpack so dynamically loaded chunks can resolve relative to the current script.

### 🐛 Bug Fixes

- **Release dependency versions** — Added release-time internal dependency syncing so published `@evjs/*` workspace packages depend on the concrete release version instead of source-only `"*"` ranges.
- **Stale manifest cleanup** — Removed stale split manifest files before builds so switching output layouts does not leave obsolete manifest artifacts behind.
- **Utoopack CSS filenames** — Fixed content-hash CSS output naming for Utoopack builds.

### 🧹 Code Quality

- **Build cache inputs** — Tightened Turbo task inputs so generated artifacts and runtime outputs are excluded from cache keys.

### 📝 Documentation

- **Generated artifact guidance** — Refreshed architecture, build, deploy, config, plugin, and project-structure docs in English and Chinese for the current manifest and generated route type outputs.

---

## [0.2.1] — 2026-06-23

### 🐛 Bug Fixes

- **Plugin API tolerance** — Kept `EvPlugin*`, `EvConfig`, and `ResolvedEvConfig` type names, defaulted plugin bundler config types to Utoopack, preserved no-argument lifecycle hook signatures, and ignored extra plugin metadata fields instead of treating them as fatal configuration errors. Projects can still switch to webpack through `webpackAdapter` and the typed `webpack()` helper.

### 🧹 Code Quality

- **Remote component cleanup** — Removed remaining shared-scope and remote component runtime leftovers so the client shell no longer exposes unused shared dependency registration APIs.

---

## [0.2.0] — 2026-06-23

### ⚠️ Breaking Changes

- **Graph-driven framework contracts** — Reworked framework build and development around the `AppGraph -> BuildPlan -> BuildOutput` pipeline, with framework semantics owned by `@evjs/ev` build tools and manifest contracts owned by `@evjs/shared/manifest`.
- **Package surface cleanup** — Removed the legacy public `@evjs/build-tools` and `@evjs/manifest` packages, and kept `@evjs/ev` focused on config, build, plugin, and deployment APIs while runtime APIs live in `@evjs/client` and `@evjs/server`.
- **Plugin and endpoint contracts** — Removed the old `commandStart` plugin hook and derived server function, PPR, and RSC paths from `server.basePath` instead of exposing a separate public server function endpoint config.
- **Rendering contracts** — Standardized non-CSR page rendering around generated build manifests; PPR uses `render = "ssr"` plus `prerender = { partial: true }`, and PPR plus RSC on the same page remains unsupported.

### ✨ Highlights

- **Graph-driven build pipeline** — Added build graph analysis, build planning, linked framework output, dev-time plan updates, and `ev inspect` for preflight diagnostics.
- **Framework page routes and render modes** — Added strict `src/pages` discovery, pathless route groups, layout source modules, generated route types, SSR, SSG, experimental PPR, and RSC integration.
- **Deployment output** — Added `nodeDeploymentAdapter()` and deployment metadata for production Node servers that mount framework endpoints, SSR/PPR/RSC document routes, server functions, server routes, and static assets.
- **Webpack validation adapter** — Added `@evjs/bundler-webpack` as the validation/fallback adapter for dynamic entries, server output, SSR, PPR, RSC, and framework build contracts that still need lower-level Utoopack parity.
- **Cross-origin asset loading** — Added `output.crossOriginLoading` to apply `crossorigin` attributes to emitted HTML assets and dynamic chunk loading in Utoopack and webpack builds.
- **PPR authoring model** — Aligned experimental PPR with React `Suspense`, switched PPR region IDs to opaque internal identifiers, and added diagnostics for unsupported Suspense boundaries until runtime postponed/resume support lands.

### 🧪 Testing

- **Architecture coverage** — Added broad graph, plan, manifest, page-route, server-rendering, RSC, shell runtime, deployment, and bundler adapter tests, plus render-mode and deployment-adapter E2E coverage.

### 📝 Documentation

- **0.2 architecture refresh** — Updated English and Chinese docs, examples, agent guidance, and contributor docs for the graph-driven architecture, page-route conventions, render modes, deployment model, plugin lifecycle, and package boundaries.

---

## [0.1.11] — 2026-05-26

### ✨ Improvements

- **Enable publicPath: auto by default** — Upgrade `@utoo/pack` to 1.4.9, enable `public: "auto"` in utoopack bundler adapter.

---

## [0.1.10] — 2026-05-19

### ✨ Improvements

- **MPA page config shorthand** — Added support for string-valued `pages` entries so apps can define page entries without repeating the default HTML template path.

### ♻️ Refactoring

- **Client transport options** — Simplified `@evjs/client` transport option handling and updated the custom transport docs and example to match the public runtime API.

### 🧪 Testing

- **Scaffold E2E isolation** — Isolated scaffold E2E environment setup to avoid cross-test environment leakage in CI.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.10` release line.

---

## [0.1.9] — 2026-05-14

### ⚠️ Breaking Changes

- **Plugin dependency API** — Replaced plugin `dependsOn` with Egg-style `dependencies` and `optionalDependencies`, separating required plugin dependencies from optional ordering dependencies.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.9` release line.

---

## [0.1.8] — 2026-05-13

### ✨ Improvements

- **Plugin dependency ordering** — Added `dependsOn` for evjs plugins so plugin packages can declare internal ordering constraints while app users only enable the plugins they need.

### 📝 Documentation

- **Plugin ordering guide** — Documented dependency-resolved plugin order and the validation for missing, duplicate, or circular plugin dependencies.
- **Release line updates** — Updated user-facing dependency examples to the `0.1.8` release line.

---

## [0.1.7] — 2026-05-13

### ✨ Improvements

- **Async bundler config hooks** — Allowed plugin `bundlerConfig` hooks and the typed `utoopack()` helper to return promises, ensuring async Utoopack config mutations finish before build/dev config is used.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.7` release line.

---

## [0.1.6] — 2026-05-13

### 🐛 Bug Fixes

- **Utoopack dev HTML emission** — Fixed `ev dev` so Utoopack emits development HTML and manifests for both full-stack apps (`dist/client/index.html`) and CSR-only apps (`dist/index.html`).
- **Relative server function dev proxy** — Fixed the default relative server function endpoint so `POST /api/fn` is proxied to the API dev server instead of returning a client dev-server 405 response.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.6` release line.

---

## [0.1.5] — 2026-05-11

### ✨ Improvements

- **evjs client router type registration** — Added `@evjs/client` as the public module augmentation target for TanStack Router registration, keeping route type setup inside the evjs client API surface.

### 🐛 Bug Fixes

- **Relative server function endpoint default** — Restored the default server function endpoint to a relative path so generated apps work behind their current origin.
- **WebSocket transport E2E dispatch** — Fixed the custom WebSocket transport E2E bootstrap to dispatch RPC calls to the server function API endpoint instead of a malformed URL.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.5` release line.

---

## [0.1.4] — 2026-05-09

### ♻️ Refactoring

- **Server function endpoint config** — Moved the ev config endpoint option to `server.functions.endpoint`, matching the rest of the server function settings and resolved config shape.

### ✨ Runtime

- **Router global catch boundary opt-out** — Added a `createApp()` runtime option that passes through TanStack Router's native `disableGlobalCatchBoundary`.
- **Broader TanStack Router passthrough** — Re-exported additional TanStack Router components, hooks, history helpers, search middleware utilities, URL rewrite helpers, and router event types from `@evjs/client`.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.4` release line.

---

## [0.1.3] — 2026-05-09

### ✨ Improvements

- **General type-safe config merging** — Moved `merge()` into `@evjs/ev` so plugins can apply typed nested patches to evjs framework config and utoopack config through the same helper.
- **Utoopack helper simplification** — Kept `@evjs/bundler-utoopack` exporting `merge()` for concise plugin authoring while sharing the generic implementation from `@evjs/ev`.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.3` release line.
- **Project structure cleanup** — Removed stale generated-folder notes from the project structure guide.

---

## [0.1.2] — 2026-05-09

### ✨ Highlights

- **Type-safe utoopack config merging** — Added the `merge()` helper to `@evjs/bundler-utoopack` so plugins can apply typed nested utoopack config patches without manual `cfg.module ??= {}` style boilerplate.
- **Cleaner plugin authoring examples** — Simplified utoopack hook examples to use `bundlerConfig: utoopack((cfg) => ...)` directly instead of manually forwarding `(config, ctx)`.
- **Project structure guide refresh** — Reworked the project structure docs around minimal apps, full-stack layouts, server functions, route handlers, custom server entries, MPA builds, and generated folders.

### 📝 Documentation

- **Plugin lifecycle clarity** — Clarified plugin hook execution order and the difference between generic `bundlerConfig` hooks and typed bundler helpers.
- **User package version guidance** — Moved `@evjs/*` lockstep version guidance into the user-facing Quick Start docs and updated examples for the `0.1.2` release line.
- **Roadmap and stale docs cleanup** — Marked completed MPA and server context work, refreshed stale framework guides, and kept English and Simplified Chinese docs aligned.

---

## [0.1.1] — 2026-05-09

### ✨ Highlights

- **Build orchestration in `@evjs/ev`** — Moved dev/build orchestration out of the CLI package so `@evjs/cli` stays a thin command wrapper around the framework runtime.
- **Manifest output refinements** — Refactored server manifest asset metadata and wired server function endpoint configuration through build-time defines.
- **Dev server readiness improvements** — Tightened dev server startup coordination, API process recovery behavior, and server bundle callback recovery so watch-mode failures are easier to recover from.

### 🐛 Bug Fixes

- **tRPC example forwarding** — Updated the tRPC example server function bridge to call arbitrary procedures with the original path, operation type, and input instead of hard-coding one procedure.
- **CI install stability** — Kept CI on `npm install` so platform-specific optional dependencies do not corrupt lockfile state across macOS and Linux installs.

### 🧪 Testing

- **Broader E2E coverage** — Improved end-to-end assertions across API routes, basic routing, complex routing, MPA, scaffolding, SQLite, Tailwind, and tRPC examples.
- **Bundler config coverage** — Added utoopack adapter coverage for default configuration behavior and manifest generation edge cases.

---

## [0.1.0] — 2026-05-07

### ✨ Highlights

- **Initial public milestone** — Promoted evjs to `0.1.0` as the first tagged milestone intended for GitHub-driven releases and npm publication.
- **Full-stack React framework core** — Ships TanStack Router based client routing, Hono-powered server routes and server functions, plugin hooks, and the `utoopack` bundler integration as the supported framework baseline.
- **Scaffolding and examples** — Includes `create-app` templates plus runnable examples for API routes, complex routing, MPA, custom websocket transport, Tailwind, tRPC, SQLite, and plugin authoring.

### ⚠️ Important Notes

- **Asset prefix removal** — The top-level `assetPrefix` config and related runtime injection were removed in `0.0.32`; production asset URLs are now emitted as root-relative paths.
- **Server entry export shape** — Server entries now export an object like `export default { fetch: app.fetch };` instead of exporting `fetch` directly.

---

## [0.0.33] — 2026-05-07

### 🐛 Bug Fixes

- **Default utoopack plugin context** — `ev build` and `ev dev` now inject the active default bundler into plugin setup context before collecting hooks, so `bundlerConfig` helpers like `utoopack()` work even when users rely on the implicit default bundler instead of explicitly setting `bundler: utoopackAdapter`.

---

## [0.0.32] — 2026-05-07

### ⚠️ Breaking Changes

- **Removed `assetPrefix`** — Deleted the top-level `assetPrefix` config, removed `window.assetPrefix` runtime injection, and dropped `assetPrefix` from emitted client manifests. Client asset URLs now build as root-relative paths.
- **Standardized Server Entry Exports** — The server entry point now exports an object `{ fetch }` instead of a bare `fetch` function. `createApp().fetch` should now be exported as `export default { fetch: app.fetch };`.

### ♻️ Refactoring

- **Server Runtimes Integration** — The `node` and `fetch` runtimes are now integrated internally into `@evjs/server/runtimes`, eliminating external loading discrepancies in E2E testing scenarios.
- **Simplified HTML and bundler asset paths** — `generateHtml()` and the utoopack adapter no longer thread a CDN/public-path prefix through HTML generation, manifest emission, or bundler runtime setup.

### 🐛 Bug Fixes

- **Template Metadata** — Fixed template metadata for the `create-app` scaffolding CLI to ensure correct package naming and metadata on new projects.

### 📝 Documentation

- **Removed stale CDN-prefix guidance** — Updated config and deployment docs to stop advertising `assetPrefix`, and documented that custom asset-base behavior now requires a proxy layer or custom bundler/HTML extension.

---

## [0.0.30] — 2026-05-06

### ✨ Features

- **Basic routing example expansion** — Expanded `examples/basic` with static (`/about`), dynamic (`/users/$userId`), and search-param (`/search?tab=`) routes to demonstrate more routing patterns in one example.
- **Custom router history support** — Added optional `history` support to `createApp()` and re-exported hash and memory history helpers from `@evjs/client`, allowing examples and apps to switch between browser, hash, and memory routing.

### 🐛 Bug Fixes

- **Default dev server entry fallback** — Projects without an explicit `server.entry` now get a generated default server entry, restoring server function support in dev for minimal examples like `examples/basic`.
- **Browser-history deep-link fallback in dev** — Utoopack dev serving now falls back to the SPA shell for route URLs like `/about` and `/users/1`, preventing `405` responses on direct navigation.

### 🧹 Code Quality

- **Monorepo lint and type cleanup** — Resolved repository lint issues and tightened plugin hook test typing so push-time validation passes cleanly.

---

## [0.0.29] — 2026-04-29

### ✨ Features

- **Cookie API Enhancements** — Split `cookies()` into `getCookie`, `setCookie`, and `deleteCookie` for better clarity. Added support for signed cookies via `getSignedCookie`, `setSignedCookie`, `generateCookie`, and `generateSignedCookie`, aligning signatures with Hono.
- **Server Options Refactoring** — Redesigned `CreateAppOptions` and optimized `RouteHandler` to streamline server creation.
- **Core Architecture** — Core architecture and stability improvements.

### 📝 Documentation & Examples

- **Server Context Examples** — Demonstrated server context hooks in the `basic-server-fns` example.
- **Runtime Identifiers Cleanup** — Updated stale `__fn_call` and `registerServerFn` references across all documentation and comments to accurately reflect the `createServerReference` and `registerServerReference` implementations.
- **README Updates** — Added the official Hono URL to the root README.

---

## [0.0.28] — 2026-04-28

### ✨ Features

- **Server Context API** — Refactored server context API to align with Hono's `context-storage`, providing global hooks like `request()`, `headers()`, `cookies()`, and `waitUntil()`.
- **Performance** — Optimized `waitUntil` execution to prevent unnecessary closure creation.

---

## [0.0.27] — 2026-04-24

### ✨ Features

- **Removed webpack backend support** — Removed webpack-specific bundler support and aligned the framework around `@evjs/bundler-utoopack`.
- **MPA support** — Added Multi-Page Application support via `pages` config entries in `ev.config.ts`.

### 🧪 Testing

- **MPA end-to-end coverage** — Added Playwright e2e coverage for the new `basic-mpa` example.

### 🧰 Scaffolding

- **`create-app` template updates** — Added `basic-mpa` template support and updated template link mappings.

### 📝 Documentation

- **Bundler terminology cleanup** — Updated docs and package READMEs to reflect utoopack-oriented terminology.

---

## [0.0.26] — 2026-04-24

### ✨ Features

- **Added `cwd`** — Added `cwd` to the plugin helper.

### 🐛 Bug Fixes

- **Type strictness in plugin helpers** — Fixed `EvBundlerCtx<Configuration>` type mappings in `@evjs/bundler-utoopack` to securely expose the full typed bundler configuration to plugins.

### 📝 Documentation

- **Plugin examples** — Updated bundler configuration examples for plugin developers.

---

## [0.0.25] — 2026-04-21

### ✨ Features

- **Micro-frontend support** — Added `unmount` method to `createApp` for micro-frontend support.

### ♻️ Refactoring

- **Simplified QueryClient** — Simplified `QueryClient` default assignment.

---

## [0.0.24] — 2026-04-21

### ✨ Features

- **Route basepath and QueryClient IoC** — Added `basepath` routing feature and refactored TanStack `QueryClient` as an injected dependency, dropping the `queryClientConfig` parameter.

---

## [0.0.23] — 2026-04-21

### ✨ Features

- **Added `@evjs/bundler-utoopack`** — Integrated the Turbopack-based `utoopack` bundler via a new adapter package. Leverages native `"use server"` support for lightning-fast server function compilation and HMR.

### ♻️ Refactoring

- **Renamed `route()` to `createRoute()`** — Aligned the server-side route factory naming with the existing client-side API for better consistency across the framework.

### 🐛 Bug Fixes

- **Resolved E2E timeouts** — Increased dev server timeout in e2e tests.

---

## [0.0.22] — 2026-04-10

### ♻️ Refactoring

- **Reorganized plugin architecture** — Split the monolithic `bundler-webpack/src/index.ts` (381 lines) into focused modules under `plugin/`:
  - `plugin/index.ts` — `EvBundlerPlugin` orchestrator
  - `plugin/server-compiler.ts` — "use server" module scanning and child compiler
- **Moved `ManifestCollector` to `@evjs/manifest`** — Manifest building logic (`ManifestCollector`, `resolveRoutes`, `ExtractedRoute`) now lives in the zero-dependency manifest package alongside the types it produces
- **Moved `buildHtml()` to `@evjs/ev`** — Framework-level HTML transforms (assetPrefix injection, plugin `transformHtml` hooks) extracted to the core package; accepts a pre-parsed doc to avoid heavy build-tool dependencies
- **`@evjs/ev` stays lightweight** — Removed `@evjs/build-tools` dependency; `@evjs/ev` now only depends on `@evjs/manifest` and `@evjs/shared`

---

## [0.0.21] — 2026-04-10

### ✨ Features

- **Runtime `publicPath` via `window.assetPrefix`** — Webpack's chunk loader now reads `window.assetPrefix` at runtime, so dynamically loaded chunks resolve against the deploy-time CDN URL without requiring a rebuild. The prefix can be injected into `index.html` at deploy time by rewriting the `<script>window.assetPrefix="..."</script>` tag.

### 📝 Documentation

- Updated `assetPrefix` docs in `deploy.md` (EN + zh-Hans) to reflect runtime publicPath behavior
- Updated `config.ts` docstring to mention runtime chunk loading and deploy-time rewriting

---

## [0.0.20] — 2026-04-08

### ✨ Features

- **`assetPrefix` config option** — New top-level config field for deploying static assets to a CDN. Set `assetPrefix: "https://cdn.example.com/"` in `ev.config.ts` to prefix all JS/CSS asset URLs in the production build output
- **Runtime `window.assetPrefix`** — The configured prefix is injected as a `<script>window.assetPrefix="..."</script>` tag in the `<head>` of `index.html`, enabling deployment-time rewriting and dynamic asset URL construction in React components
- **`assetPrefix` ignored in dev** — During `ev dev`, the prefix is always forced to `"/"` to preserve local HMR and dev server stability

### 📝 Documentation

- Added CDN deployment section to `deploy.md` (EN + zh-Hans)
- Added `assetPrefix` reference to `config.md` (EN + zh-Hans) with defaults table, client options description, and full reference example
- Updated `evjs-dev` AI skill with CDN deployment gotcha

### 🧹 Code Quality

- Renamed internal `publicPath` to `assetPrefix` across `@evjs/build-tools`, `@evjs/bundler-utoopack`, `@evjs/manifest`, and `@evjs/ev` for naming consistency with Next.js conventions
- Added `Window.assetPrefix` global type augmentation in `@evjs/client` for type-safe access

---

## [0.0.19] — 2026-04-07

### 🐛 Bug Fixes

- **Resolved manifest route paths** — Route extraction now parses `getParentRoute` hierarchy and produces fully resolved URL paths (e.g. `/posts/$postId` instead of bare `$postId`), eliminating duplicate `"/"` entries in `manifest.json`
- **Removed duplicate index routes** — Index routes under non-root parents are excluded from the manifest since they resolve to the same URL as their parent
- **Fixed ANSI escape codes in build output** — Webpack stats no longer emit raw `\x1B[...` sequences in the logger

### ✨ Features

- **`extractRoutes()` / `resolveRoutes()`** — New build-tools APIs for extracting route metadata from `createRoute()` calls and resolving full URL paths from the parent-child hierarchy

### 📦 Dependencies

- Upgraded `domparser-rs` from `^0.0.7` to `^0.1.0` — migrated from `NodeRepr` to standard DOM type hierarchy (`Document`, `Element`, `Node`)

### 🧪 Testing

- Added 21 unit tests for route extraction and resolution in `@evjs/build-tools`
- Updated `ManifestCollector` tests for resolved route output

---

## [0.0.18] — 2026-04-06

### ✨ Features

- **`transformHtml` plugin hook** — New lifecycle hook receives a parsed DOM document (`EvDocument`) instead of a raw HTML string, enabling robust, structured HTML manipulation via standard DOM methods
- **`EvDocument` interface** — Bundler-agnostic DOM subset in `@evjs/ev` covering querying, attributes, tree mutation, content insertion, traversal, and document-level accessors
- **Custom HTML generation** — New `generateHtml()` utility in `@evjs/build-tools` using `domparser-rs` for template parsing and asset injection (replaces `HtmlWebpackPlugin` for asset injection)
- **`basic-plugins` example** — New example demonstrating all four plugin hooks (`buildStart`, `bundler`, `transformHtml`, `buildEnd`)

### 🧪 Testing

- Added Playwright e2e tests for `basic-plugins` (4 browser tests)
- Added `transformHtml` DOM manipulation e2e scenarios to `plugin-hooks.test.ts` (3 tests: meta injection, comment injection, multi-plugin composition)
- Added 13 unit tests for `generateHtml` in `@evjs/build-tools`

### 📝 Documentation

- New dedicated **Plugins** guide (`docs/docs/plugins.md`) with lifecycle diagram, `EvDocument` API reference, type-safe bundler helpers, and practical recipes (CSP nonce, analytics, deploy manifest)
- Chinese (zh-Hans) translation of the Plugins guide
- Added Plugins page to sidebar under Core Concepts
- Updated architecture diagrams and roadmap to include `transformHtml` in the hook lifecycle

---

## [0.0.17] — 2026-04-05

### ✨ Features

- **Plugin lifecycle API** — Refactored `EvPlugin` from top-level config/bundler hooks to a `name` + `setup(ctx)` pattern returning lifecycle hooks (`buildStart`, `bundler`, `buildEnd`)
- New `EvPluginContext`, `EvPluginHooks`, and `EvBuildResult` types for full type-safe plugin authoring
- Added typed `utoopack()` helper in `@evjs/bundler-utoopack` for type-safe bundler config manipulation inside plugins
- Removed legacy `EvConfigCtx` and `bundler.config` escape hatch
- CLI now orchestrates full `setup → buildStart → bundler → buildEnd` lifecycle

### 🔒 Security & Hardening

- **Production HTTPS enforcement** — TLS cert failures now throw instead of silently falling back to unencrypted HTTP
- **Server function input validation** — `Array.isArray(args)` guard in `dispatch()` prevents malformed payloads from spreading incorrectly
- **Request body validation** — Early `fnId` type check returns a structured 400 error for malformed RPC requests
- **Structured error propagation** — Client transport now parses JSON error bodies on non-2xx responses, preserving `ServerError.data` end-to-end

### 🧹 Code Quality

- Added missing `@evjs/manifest` dependency to `@evjs/shared`
- Removed unused `glob` and `picocolors` from `@evjs/cli`
- Removed dead `import "node:module"` side-effect import in utoopack adapter
- Removed redundant `HotModuleReplacementPlugin` (already provided by webpack-dev-server)
- Added `toHttpMethod()` normalizer for safe, case-insensitive HTTP method handling
- Resolved all Biome lint warnings across the monorepo

### 📝 Documentation

- Fixed 6 phantom API references documenting non-existent functions (`handleServerFunctions`, `setContext`/`getContext`, `createNodeServer`, `WebSocketTransport`, `resolveProjectRoot`/`loadManifest`)
- Corrected API names: `createNodeServer` → `serve`, `createServer` → `createFetchHandler`
- Fixed `ServerError` constructor signature in docs (2 args, not 3)
- Fixed stale package paths (`packages/webpack-plugin` → `packages/bundler-webpack`)
- Fixed stale dependency graph (`@evjs/shared` now depends on `@evjs/manifest`)
- Fixed wrong server function endpoint config path in docs
- Synced all fixes to Chinese (zh-Hans) documentation

---

## [0.0.16] — 2026-04-03

### ✨ Features

- **CSR-only mode** — `server: false` in `ev.config.ts` produces a flat `dist/` output with no server bundle; `"use server"` modules cause a build error

### 🧹 Code Quality

- Codebase review fixes across 15 files (19 issues)
- Fixed outdated `createHandler()` references → `createFetchHandler()`

### 🐛 Bug Fixes

- Improved E2E test isolation with dynamic ports and unique temp dirs
- Fixed E2E tests to use correct manifest path `dist/client/manifest.json`

---

## [0.0.15] — 2026-04-03

### ✨ Changes

- **Split build manifest** into separate `dist/client/manifest.json` and `dist/server/manifest.json` for improved build modularity
- Updated `@evjs/manifest` types: `ServerManifest` + `ClientManifest` replace the unified `Manifest`
- Fixed project structure docs to use code-based routing and `global.ts`

---

## [0.0.14] — 2026-04-02

### ⚠️ Breaking Changes

- **`server.backend` renamed to `server.runtime`** — The config field that specifies the JS runtime command (`node`, `bun`, `deno`) has been renamed for clarity. Update your `ev.config.ts` if you were using this field.

---

## [0.0.13] — 2026-04-02

### 🐛 Bug Fixes

- **CSR-only dev server fix** — `ManifestCollector.entry` defaulted to `"main.js"`, causing CSR-only apps to crash on `ev dev`. The entry is now `undefined` when no server bundle is produced.

---

## [0.0.12] — 2026-04-01

### 🐛 Bug Fixes

- Fixed `create-app` scaffolding: restored `basic-server-routes` symlink after npm pack
- Fixed `bundler-webpack`: removed `devServerOverrides` spread leaking `https` into devServer config
- Removed fallback RSA certificate generation for HTTPS (explicit key/cert now required)
- Fixed E2E `ENOTEMPTY` race condition by spawning node directly

---

## [0.0.11] — 2026-04-01

### ✨ Changes

- Reverted scaffolding package name from `create-ev-app` back to `@evjs/create-app`
- Reverted registry publishing to use token-based auth for stability

---

## [0.0.10] — 2026-04-01

### 🐛 Bug Fixes

- Updated docs landing page terminal preview
- Removed npm caching from CI workflows to resolve `husky` permission errors
- Fixed stale `create-evjs-app` references in lockfile

---

## [0.0.9] — 2026-04-01

### ✨ Changes

- Renamed scaffolding package `@evjs/create-app` → `create-evjs-app` (later reverted in v0.0.11)

---

## [0.0.8] — 2026-04-01

### ✨ Features

- **String literal route paths** — Enforced compile-time string literal types for `path` in `createRoute()` and `route()`, ensuring routes are statically analyzable

### 📝 Documentation

- Added comprehensive READMEs for all published packages
- Standardized scaffolding command to `npx create-evjs-app`

---

## [0.0.7] — 2026-03-31

### ✨ Features

- **Bundler adapter architecture** — Decoupled bundler logic with a new adapter layer, enabling future bundler backends (Rspack, Vite)
- **Renamed** `@evjs/webpack-plugin` → `@evjs/bundler-utoopack` with relocated adapter logic
- **Docusaurus site** — Redesigned landing page, added config/dev/build/deploy guides, Mermaid diagrams, and Chinese (zh-Hans) i18n

### 🐛 Bug Fixes

- Fixed `ERR_REQUIRE_CYCLE_MODULE` in Node 22 CI
- Fixed mobile navbar sidebar z-index stacking
- Cleaned up technical debt and lint warnings

---

## [0.0.6] — 2026-03-30

### ✨ Features

- **`getFnQueryOptions()`** — New extractor replacing deprecated `serverFn()` wrapper for TanStack Query integration
- **Project structure guide** — Documented recommended FSD (Feature-Sliced Design) conventions

---

## [0.0.5] — 2026-03-30

### ✨ Features

- **Server function metadata** — `.queryKey()`, `.fnId`, `.fnName` properties on server function stubs for cache invalidation and introspection
- **Docusaurus documentation site** — Full docs with config, dev, build, deploy pages; Mermaid diagram support; GitHub Pages deployment
- **Chinese (zh-Hans) i18n** — Complete translated documentation

### 🧹 Code Quality

- Renamed `EvPlugin` loaders to `module.rules` for webpack alignment

---

## [0.0.4] — 2026-03-26

### 🐛 Bug Fixes

- Added `declaration: true` to `packages/cli/tsconfig.json` to emit type declarations during build

---

## [0.0.3] — 2026-03-26

### ✨ Features

- **Programmatic CLI API** — Extracted `dev(config?, options?)` and `build(config?, options?)` for programmatic usage alongside the CLI
- **HTTPS support** — Added self-signed HTTPS generation for the local dev server (`server.dev.https`)
- **Config cleanup** — Restructured `ServerConfig` with nested endpoints, removed stale dev options

---

## [0.0.2] — 2026-03-24

### 🎉 First Stable Release

The first stable release of evjs — a React fullstack framework with server functions and programmatic route handlers.

- **Server Functions** — `"use server"` RPC with type-safe `useQuery`/`useSuspenseQuery`
- **Route Handlers** — `route(path, { GET, POST, ... })` REST API with middleware, auto-OPTIONS, auto-HEAD, 405 fallback
- **Zero-Config CLI** — `ev dev`, `ev build` with Webpack, SWC, and HMR
- **Plugin System** — `EvPlugin` with module rules for custom loaders (Tailwind, SVG, etc.)
- **Multi-Runtime** — Hono-based server with Node.js and ECMA (Deno/Bun) adapters
- **TypeScript 6** — Full TypeScript 6.0 support across all packages
