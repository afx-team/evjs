# Plugin Authoring

Use `definePlugin()` from `@evjs/ev/plugin` to declare a stable plugin identity,
typed configuration contracts, and the framework stages the plugin extends.
Applications consume the returned factory through `config.plugins`.

The authoring model has three layers: `pluginOptions()` declares plugin-owned
Application or Page data, descriptor methods such as `configure()` and
`emitIR()` / `emitPageIR()` participate in framework planning, and `setup()`
returns imperative lifecycle hooks. A behavior should live in only one layer.
These are responsibility layers rather than adjacent time blocks:
`configure()` runs before `setup()`, while IR emission runs later during graph
planning. `emitIR()` and `emitPageIR()` only declare deterministic records for
evjs to collect, validate, and materialize; they do not immediately write
files. Descriptor methods never belong in the object returned by `setup()`,
and lifecycle hooks never belong on the descriptor.

## Define a Minimal Plugin

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const outputReporter = definePlugin({
  name: "@example/output-reporter",
  setup() {
    let start = 0;
    return {
      beforeBuild() {
        start = Date.now();
      },
      afterBuild({ output }) {
        console.log(
          `Canonical output ${output.buildId} published in ${Date.now() - start}ms`,
        );
      },
    };
  },
});
```

This elapsed time covers canonical output linking and publishing after fresh
bundler facts are available; it does not include bundler compilation.

`definePlugin()` returns a factory rather than an installed plugin. An
application calls it in `ev.config.ts`:

```ts
import { defineConfig } from "@evjs/ev";
import { outputReporter } from "@example/output-reporter";

export default defineConfig({
  plugins: [outputReporter()],
});
```

The `plugins` array preserves installation order among otherwise equivalent
plugins; required dependencies and present optional dependencies may perform a
stable topological reorder. There is no global pre/post tier spanning unrelated
plugin stages. Factory arguments hold Application configuration; there is no
parallel top-level configuration bag.

## Declare Application and Page Contracts

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
  name: "@company/analytics",
  key: "analytics",

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
plugin `key` and its Page value for `definePageConfig()`. This exact bridge is
available for `ev.config.ts`; JavaScript config stays safe but does not claim
exact plugin keys. Entries with a possible falsy branch are also excluded because
they are not guaranteed to exist at runtime. Widened arrays and conditional
config or array unions are excluded for the same reason; keep Page-configurable
plugins in the tuple passed directly to `defineConfig()`. See
[Plugins](./plugins) for the Application and Page authoring forms.

`ev prepare`, `ev dev`, and `ev build` create this declaration under `src`
before Page graph analysis. That keeps editor completion available even when
later Page validation fails. It intentionally does not live under `.ev`, which
ordinary application TypeScript configurations exclude.

Application and Page values never merge with each other. Within either
contract, authored fields are deeply merged over that contract's defaults
before validation. `setup()` receives only
`ctx.options`; `emitIR()` receives that setting plus the
enabled `ctx.pages`, whose entries expose `{ page, options }`. Use
`emitPageIR()` as the per-enabled-Page alternative; it exposes
`ctx.options`, `ctx.page`, and `ctx.pageOptions` directly.

## Contracts, Defaults, and Validation

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
Application contract exactly once. `configure()`, `setup()`, and IR-emission
methods share that snapshot. A context-derived `routingMode` therefore reflects
the authored mode before `configure()` runs; read the later method's `ctx.config`
when the final resolved framework mode matters.

Page omission is determined by whether the Page contract has defaults and, for
defaultable contracts, the factory form. With `plugin(options)`, an omitted
Page uses defaults when they exist and is otherwise disabled. A defaultable
contract also exposes `plugin.withPageOptIn(options)`, where omission is always
disabled. A non-defaultable contract is already opt-in-only and does not expose
the redundant method. Explicit `false` disables a Page, `true` requires
defaults, and an object enables the Page after merging over any defaults and
validation.

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

## Identity and Ordering

Plugin `name` values are stable dependency and lifecycle identities. One short
lowercase `key`, such as `analytics` or `error-reporting`, is required whenever
the plugin declares Application or Page options. The same key identifies both
contracts and their CoreGraph settings. A hooks-only plugin may omit it. Plugin
keys and names must each be unique in one Application.

`dependencies` names plugins that must be installed and active first.
`optionalDependencies` adds the same ordering edge only when the named plugin
is present and active. Otherwise evjs preserves the authored array order.
Unknown descriptor fields and misspelled hooks are rejected.

Plugin configuration exists only at Application and Page scope. Derive Route or
Document effects from enabled Pages during graph analysis and emit them through
[generated contributions](./generated-contributions).

## Modify Framework Configuration Early

Use `configure()` for framework configuration that must be visible before
framework defaults, route discovery, dev proxy setup, or runtime path
derivation. Return a config object, or return `undefined` after mutating the
received working copy in place. evjs isolates that copy from the caller and
from the last committed dev configuration, so a failed reload cannot leak
candidate mutations.
`null`, arrays, and other return values are rejected. The result is validated by
the same resolver as user config before `setup()` or bundling runs.
`configure()` may change framework fields, but it must not add, remove, replace,
or reorder `config.plugins`. Declare the complete plugin list in
`defineConfig()` so dependency ordering, typed options, and rollback all refer
to one stable snapshot.

```ts
import { defineConfig } from "@evjs/ev";
import { merge } from "@evjs/ev/config";
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

const serverBasePath = definePlugin({
  name: "@example/server-base-path",
  key: "server-base-path",
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

After `configure()` finishes, every later `ctx.config` is a detached, frozen
metadata view of the resolved framework config. Installed plugins expose only
their identity, key, and activation state; the selected bundler exposes only
its name and capabilities. Callable plugin hooks and adapter build/dev methods
are not projected through another plugin's context. `configureBundler()` may
mutate only its explicit bundler-config argument. Plugin authors should keep
framework configuration changes in this one validated phase.

## Initialize Shared State in `setup()`

Use `setup()` to allocate shared state and return lifecycle hooks. Return a
hooks object or `undefined`; `null`, arrays, and non-function hook fields are
rejected before lifecycle hooks run. Unknown hook keys are rejected so
misspelled hooks cannot become silent no-ops. Put package-local metadata outside
the hooks object.

The setup context provides `mode`, `command`, `cwd`, resolved `config`,
`logger`, `addWatchFile()`, `onDispose()`, and the typed Application
`ctx.options` declared by the descriptor. Register cleanup with
`ctx.onDispose()` immediately after allocating a resource:

```ts
setup(ctx) {
  const watcher = createWatcher();
  ctx.onDispose(() => watcher.close());

  return {
    beforeBuild() {
      watcher.refresh();
    },
  };
}
```

Registered callbacks run in reverse registration order when the plugin
snapshot is disposed. They also run when `setup()` throws or returns an invalid
hooks object, so partially initialized resources are not stranded. A returned
`dispose()` hook runs before these callbacks during normal snapshot teardown.
Register callbacks before `setup()` settles.

Failures from `configure()`, `setup()`, IR emission, and returned lifecycle
hooks identify both the plugin `name` and failing hook. The exported
`PluginHookError` also exposes stable `code`, `plugin`, `hook`, and `cause`
fields for programmatic diagnostics.

Continue with [Plugin Hooks](./plugin-hooks) for lifecycle order and
hook-specific contracts.

## Installation and Execution Modes

The normal and `withPageOptIn()` factory forms control Page omission without
changing typed Application options. `.when()` separately controls whether the
installed plugin executes:

- `plugin(options)` installs and executes the plugin; Pages with defaults are
  enabled when their key is omitted;
- for a Page contract with defaults, `plugin.withPageOptIn(options)` installs and
  executes the same plugin with the same Application options, but every Page
  must opt in with `true` or an object;
- `plugin(options).when(condition, reason?)` keeps the contracts and generated
  Page types installed, but a false condition disables owner settings and skips
  `configure()`, `setup()`, and IR emission;
- a `false`, `null`, or `undefined` entry in `config.plugins` omits the whole
  plugin and executes no plugin hook.

Required Application options stay required in either available factory form.
Reusable typed groups should be created with `definePluginPreset(factory)`;
bare nested arrays and asynchronous preset results are rejected.

## Choose the Right Extension Point

| Need | API |
|---|---|
| Change framework config before discovery | `configure()` |
| Allocate shared state | `setup()` |
| Start one framework output/link cycle from fresh bundler facts | `beforeBuild()` |
| Run build lifecycle behavior | Hooks returned by `setup()` |
| Generate modules or attach structured behavior | `emitIR()` or `emitPageIR()` |
| Compile a custom file type or tune optimization | `configureBundler()` |
| Rewrite a parsed HTML document | `transformHtml()` |
| Adjust linked assets or deployment metadata before projection | `transformOutput()` |
| Write final external artifacts after output stabilizes | `afterBuild()` |

Keep `emitIR()` and `emitPageIR()` deterministic and free of external side
effects. They declare IR records rather than writing `.ev` directly, and evjs
may evaluate them again when emitted source aliases change the framework graph.
