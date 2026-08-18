# Plugin Authoring

Use `definePlugin()` from `@evjs/ev/plugin` to declare a stable plugin identity,
typed configuration contracts, and the framework stages the plugin extends.
Applications consume the returned factory through `config.plugins`.

The authoring model has three layers: `pluginOptions()` declares plugin-owned
Application or Page data, descriptor methods declare configuration, generated
code, or dev CLI behavior, and `setup()` returns imperative lifecycle hooks. A
behavior should live in only one layer. `configure()` runs first; evjs then
resolves `emitIR()` and `emitPageIR()` contributions; `setup()` runs only after
those contributions succeed. Descriptor methods never belong in the object
returned by `setup()`, and lifecycle hooks never belong on the descriptor.

`cliShortcuts()` declares terminal keys and actions independently from setup
state. Starting or restarting development reruns plugin setup and collects a
fresh shortcut set; an ordinary bundler/HMR update does neither. Shortcut
actions receive the current client origin and a way to stop development. See
[Plugin CLI Shortcuts](./dev#interactive-shortcuts) for the descriptor and action
contracts.

## Define a minimal plugin

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const buildTimer = definePlugin({
  id: "build-timer",
  setup() {
    const start = Date.now();
    return {
      afterBuild({ output }) {
        console.log(`Build ${output.buildId} finished in ${Date.now() - start}ms`);
      },
    };
  },
});
```

`definePlugin()` returns a factory rather than an installed plugin. An
application calls it in `ev.config.ts`:

```ts
import { defineConfig } from "@evjs/ev";
import { buildTimer } from "@example/build-timer";

export default defineConfig({
  plugins: [buildTimer()],
});
```

The `plugins` array preserves installation order among otherwise equivalent
plugins; declared dependencies and `enforce` tiers may reorder hooks. Factory
arguments hold Application configuration; there is no parallel top-level
configuration bag.

## Declare application and page contracts

One descriptor can declare two independent contracts:

```ts
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

type AnalyticsApplicationConfig = {
  endpoint: string;
  debug?: boolean;
};

type AnalyticsPageConfig = {
  channel: string;
};

export const analytics = definePlugin({
  id: "analytics",

  application: pluginOptions<AnalyticsApplicationConfig>({
    validate(value) {
      return value.endpoint.startsWith("/") || "endpoint must start with /";
    },
  }),

  page: pluginOptions<AnalyticsPageConfig>({
    defaults: { channel: "web" },
    validate(value) {
      return value.channel.length > 0 || "channel must not be empty";
    },
  }),

  setup(ctx) {
    // Application settings resolve before setup().
    console.log(ctx.options.endpoint);
  },

  emitIR(ctx) {
    // Only enabled Pages appear in ctx.pages.
    for (const { page, options } of ctx.pages) {
      console.log(page.id, options.channel);
    }
  },
});
```

The Application factory argument is inferred from `application`. The generated
`src/plugin-types.d.ts` declaration bridges the static
`typeof import("../ev.config").default` type, from which TypeScript derives each
plugin `id` and its Page value for `definePageConfig()`. This exact bridge is
available for `ev.config.ts`; JavaScript config stays safe but does not claim an
exact Page plugin-id registry. Entries with a possible falsy branch are also
excluded because they are not guaranteed to exist at runtime. Widened arrays
and conditional config or array unions are excluded for the same reason; keep
Page-configurable plugins in the tuple passed directly to `defineConfig()`. See
[Plugins](./plugins) for the Application and Page authoring forms.

Application and Page values never merge with each other. Within either
contract, authored fields are deeply merged over that contract's defaults
before validation. `setup()` receives only
`ctx.options`; `emitIR()` receives that setting plus the
enabled `ctx.pages`, whose entries expose `{ page, options }`. Use
`emitPageIR()` as the per-enabled-Page alternative; it exposes
`ctx.options`, `ctx.page`, and `ctx.pageOptions` directly.

## Contracts, defaults, and validation

`pluginOptions<T>()` declares a required object. Passing
`pluginOptions<T>({ defaults, validate?, schemaVersion? })` makes the contract
defaultable.

Defaults may be an object or a synchronous function of the Application/Page
setting context. Authored fields are deeply merged over defaults, including
nested plain objects. Explicit `undefined` is treated as omission. Arrays and
non-plain objects are atomic values and are replaced as a whole.
`validate` receives the resolved result and may return `true` or `void`, return
`false` or an error message, or throw.

At the start of each config pipeline, evjs resolves every installed plugin's
Application contract exactly once. `configure()`, `setup()`, and contribution
methods share that snapshot. A context-derived `routingMode` therefore reflects
the authored mode before `configure()` runs; read the later method's `ctx.config`
when the final resolved framework mode matters.

Page omission is determined by whether the Page contract has defaults and, for
defaultable contracts, the factory form. With `plugin(options)`, a Page that
omits the plugin id uses defaults when they exist and is otherwise disabled. A
defaultable contract also exposes `plugin.forPages(options)`, where omission is
always disabled. A non-defaultable contract is already opt-in-only and does
not expose the redundant method. Explicit `false` disables a Page, `true`
requires defaults, and an object enables the Page after merging over any
defaults and validation.

Standard Schema libraries can infer input and output types directly:

```ts
application: pluginOptions(applicationSchema),
page: pluginOptions(pageSchema, {
  defaults: { channel: "web" },
}),
```

Standard Schema validation must complete synchronously during configuration or
graph analysis.

Application contracts may contain build-only callbacks or module references
when the plugin supports them. Page contracts are stricter: configured and
resolved Page values must be plain, JSON-serializable objects. Functions,
symbols, bigint, non-finite numbers, class instances, sparse arrays, and cycles
are rejected.

Plugins explicitly project any runtime data and must never expose Application
secrets. Prefer an explicit module reference when Page configuration needs to
select executable runtime code.

## Identity and ordering

Every plugin declares one stable, short `id` in lower camel case or lowercase
kebab-case, such as `analytics`, `errorReporting`, or `error-reporting`. The
same id identifies dependencies and lifecycle state, owns generated
IR, and—when the plugin declares a Page contract—keys its entry in
`page.config.ts#plugins`. It is not a package name and has no separate Page
alias: the package may be `@company/analytics`, while its plugin id is
`analytics`. An id must start with a lowercase letter and then use either ASCII
letters and digits without separators, or non-empty lowercase alphanumeric
segments separated by hyphens. Camel case and kebab-case must not be mixed in
one id. `__proto__`,
`constructor`, `prototype`, and Windows device basenames (`con`, `prn`, `aux`,
`nul`, `com1` through `com9`, and `lpt1` through `lpt9`) are reserved. This
keeps the unchanged id safe as one generated path segment on every supported
platform. Plugin ids must be unique in one Application after case folding, so
ids such as `errorReporting` and `errorreporting` cannot be installed together.

`dependencies`, `optionalDependencies`, and `enforce` control hook ordering.
Unknown descriptor fields and misspelled hooks are rejected.

Plugin configuration exists only at Application and Page scope. Derive Route or
Document effects from enabled Pages during graph analysis and emit them through
[generated contributions](./generated-contributions).

## Modify framework configuration early

Use `configure()` for framework configuration that must be visible before
framework defaults, route discovery, dev proxy setup, or runtime path
derivation. Return a config object, or return `undefined` after mutating the
received working copy in place. evjs isolates that copy from the caller and
from the last committed dev configuration, so a failed reload cannot leak
candidate mutations.
`config.plugins` is deliberately excluded from the working copy. Plugin
installation is owned by the Application config: its entries and declared
order remain fixed for the complete lifecycle snapshot, while hook execution
still follows `dependencies`, `optionalDependencies`, and `enforce`.
Any own `plugins` property added in place or returned, including `undefined`,
is rejected.
Resolved plugin contexts expose the same isolated, frozen framework-config
view, so setup, contribution, bundler, and lifecycle hooks cannot mutate the
Application's live configuration through `ctx.config`.
`null`, arrays, and other return values are rejected. The result is validated by
the same resolver as user config before `setup()` or bundling runs.

```ts
import { defineConfig } from "@evjs/ev";
import { merge } from "@evjs/ev/config";
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

const serverBasePath = definePlugin({
  id: "server-base-path",
  application: pluginOptions({
    defaults: { basePath: "/_framework" },
  }),
  configure(config, ctx) {
    merge(config, {
      server: {
        basePath: ctx.options.basePath,
      },
    });
    return config;
  },
});

export default defineConfig({
  plugins: [serverBasePath({ basePath: "/_internal" })],
});
```

Do not use `configureBundler()` for framework protocol paths. Server functions,
PPR, and RSC endpoints are derived from `server.basePath`.

After `configure()` finishes, every later `ctx.config` is typed as a deeply
read-only view of the resolved framework config. `configureBundler()` may mutate
only its explicit bundler-config argument. Plugin authors should keep framework
configuration changes in this one validated phase.

## Initialize shared state in `setup()`

Use `setup()` to allocate shared state and return lifecycle hooks. Return a
hooks object or `undefined`; `null`, arrays, and non-function hook fields are
rejected before lifecycle hooks run. Unknown hook keys are rejected so
misspelled hooks cannot become silent no-ops. Put package-local metadata outside
the hooks object.

The setup context provides `mode`, `cwd`, resolved `config`, `logger`,
`addWatchFile()`, and the typed Application `ctx.options` declared by the
descriptor. Use `mode` to distinguish development from production. Continue
with [Plugin Hooks](./plugin-hooks) for lifecycle order and hook-specific
contracts.

Public context names follow their stages: `PluginConfigureContext`,
`PluginSetupContext`, `PluginEmitIRContext`, `ConfigureBundlerContext`,
`DevServerReadyContext`, `BeforeBuildContext`, `TransformOutputContext`,
`TransformHtmlContext`, and `DisposeContext`. Contribution code reads the
normalized `FrameworkView` from `ctx.framework`. Plugin option helpers expose
`PluginOptionsContract`,
`PluginOptionsDefinition`, and `PluginOptionsContext`; internal factory
inference types are not part of the public authoring API.

## Configure plugin and page activation

The factory controls Page omission without changing plugin execution or typed
Application options:

- `plugin(options)` installs and executes the plugin; Pages with defaults are
  enabled when their plugin entry is omitted;
- for a Page contract with defaults, `plugin.forPages(options)` installs and
  executes the same plugin with the same Application options, but every Page
  must opt in with `true` or an object;
- a `false`, `null`, or `undefined` entry in `config.plugins` omits the whole
  plugin and executes no plugin hook.

Required Application options stay required in either available factory form.

## Choose the right extension point

| Need | API |
|---|---|
| Change framework config before discovery | `configure()` |
| Declare interactive dev CLI keys and actions | `cliShortcuts()` |
| Allocate shared state | `setup()` |
| Run build lifecycle behavior | Hooks returned by `setup()` |
| Consume the actual client origin after the dev listener starts | `devServerReady()` |
| Generate modules or attach structured behavior | `emitIR()` or `emitPageIR()` |
| Compile a custom file type or tune optimization | `configureBundler()` |
| Rewrite a parsed HTML document | `transformHtml()` |
| Adjust linked assets or deployment metadata before projection | `transformOutput()` |
| Write final external artifacts after output stabilizes | `afterBuild()` |

Keep `emitIR()` deterministic and free of external side effects. evjs
may evaluate it again when contributed source aliases change the framework
graph.
