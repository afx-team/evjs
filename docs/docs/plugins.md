# Plugins

Plugins extend supported framework stages without expanding the core
application config. Applications install a plugin once in `ev.config.ts`;
Pages can then use the plugin's short key to configure, enable, or disable
Page-specific behavior. Lifecycle hooks and generated contributions remain the
extension points for build, bundler, HTML, and runtime integration.

## Install and Configure an Application

Import the plugin factory and call it inside `plugins`:

```ts
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/analytics";

export default defineConfig({
  plugins: [analytics({ endpoint: "/events" })],
});
```

The factory call installs the plugin and provides its typed Application
configuration. A plugin without Application configuration is called without
arguments, for example `buildTimer()`.

The `plugins` array is the ordered installation boundary. Configuration stays
in each factory call, so there is no separate extension bag or repeated package
key.

## Configure a Page

Put Page behavior next to the Page and use the plugin's short key:

```ts
// src/pages/checkout/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  plugins: {
    analytics: { channel: "checkout" },
  },
});
```

No plugin import is needed in `page.config.ts`. `ev prepare`, `ev dev`, and
`ev build` generate `src/plugin-types.d.ts` as a stable bridge to
the discovered config. With `ev.config.ts`, TypeScript derives exact plugin
keys and Page value types from the static config type; JavaScript configs get a
safe bridge without an `any` registry, so use TypeScript config when Pages need
plugin completion. Only entries that are statically guaranteed to install are
exposed to Page config. Do not edit or import the generated declaration. Keep
`src` included by the project's `tsconfig.json`.

The Page keeps one `plugins` map so third-party keys cannot collide with core
fields such as `title` or `render`. Inside that map, Page configuration uses a
short key instead of a package name or another nested plugin layer.

## Application and Page Settings Are Independent

Application configuration and Page configuration are two independent typed
contracts:

- Application settings are passed to the factory in `ev.config.ts`. They may
  include build-only callbacks or module references when the plugin supports
  them.
- Page settings live in `page.config.ts`. They must be plain,
  JSON-serializable objects because they cross the static CoreGraph boundary.
- Page objects never inherit or merge Application fields.
- Within either contract, explicit fields are deeply merged over that
  contract's defaults before validation.

Plugin configuration exists only at Application and Page scope. A Page-aware
plugin derives any Route or Document behavior from the normalized Page graph;
applications do not configure separate Route or Document plugin surfaces.

## Enable or Disable by Scope

Both factory forms install and execute the plugin and resolve the same typed
Application options. They differ only in what an omitted Page key means:

| Authoring form | Result |
|---|---|
| `analytics(config)` | Install and execute the plugin. An omitted Page uses Page defaults when they exist; otherwise that Page is off. |
| `analytics.forPages(config)` | For a Page contract with defaults, install and execute the plugin but require every Page to opt in explicitly. |
| `false`, `null`, or `undefined` in `plugins` | Omit the whole plugin conditionally; no plugin hook executes. |
| Page key omitted after `analytics(config)` | Enable with Page defaults when the Page contract has defaults; otherwise disable that Page. |
| Page key omitted after `analytics.forPages(config)` | Disable that Page, even when Page defaults exist. |
| `analytics: false` | Disable this Page. |
| `analytics: true` | Enable this Page with Page `defaults`; rejected when no defaults exist. |
| `analytics: { ... }` | Enable this Page after merging the object over Page defaults and validating it. |

To opt in only on selected Pages, use `forPages()`:

```ts
// ev.config.ts
export default defineConfig({
  plugins: [analytics.forPages({ endpoint: "/events" })],
});
```

Then enable it where needed:

```ts
// src/pages/checkout/page.config.ts
export default definePageConfig({
  plugins: {
    analytics: true,
  },
});
```

`true` requires Page defaults. If the plugin requires explicit Page settings,
provide the object instead:

```ts
export default definePageConfig({
  plugins: {
    analytics: { channel: "checkout" },
  },
});
```

To enable a plugin broadly and exclude individual Pages, give the Page
contract defaults, install the plugin normally, and set `analytics: false` on
exceptions. A Page contract without defaults always treats omission as off and
requires an object to enable the Page.

For a build-only condition, use a falsy array entry:

```ts
plugins: [process.env.ANALYTICS === "1" && analytics(options)]
```

A plugin with a possible falsy branch is not statically guaranteed to be
installed, so its Page key is intentionally unavailable. Use this form for
whole-plugin conditions that have no Page settings. When Pages configure the
plugin, install it deterministically and use `analytics: false` or
`forPages()` for Page-specific activation.

Page keys are derived only from the definite entries of the tuple inferred by
`defineConfig()`. A widened plugin array, a conditional choice between arrays,
or a conditional choice between whole config objects cannot prove that an
entry exists and therefore exposes no Page key. Keep Page-configurable plugins
directly in the `defineConfig({ plugins: [...] })` tuple.

## Type Safety and Validation

TypeScript checks Application factory arguments and Page values at their
authoring sites. Plugins can additionally validate both contracts
synchronously while evjs resolves configuration and analyzes the graph.

Page values and resolved Page defaults must remain static JSON. Functions,
symbols, bigint, non-finite numbers, class instances, sparse arrays, and cycles
are rejected. Runtime projection is an explicit plugin responsibility, and a
plugin must never expose secrets from its Application configuration.

## Next Steps

| Goal | Read |
|---|---|
| Define a typed plugin and its Application/Page contracts | [Plugin Authoring](./plugin-authoring) |
| Choose and implement lifecycle hooks | [Plugin Hooks](./plugin-hooks) |
| Emit modules and attach them to framework slots | [Generated Contributions IR](./generated-contributions) |
| Start from focused implementation examples | [Plugin Recipes](./plugin-recipes) |
| Configure the official micro-frontend bridge | [qiankun](./qiankun) |
