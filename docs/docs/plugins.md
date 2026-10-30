# Using Plugins

Plugins add integrations and build or deployment behavior without expanding
the core evjs configuration. Install a plugin once for the application, then
configure individual pages only when the integration supports page scope.

## Install a plugin

Import its factory and call it in `ev.config.ts`:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/analytics";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    analytics({
      endpoint: "/events",
      debug: false,
    }),
  ],
});
```

The factory call both installs the plugin and supplies its application-wide
options. A plugin with no options is still called, for example `buildTimer()`.

Plugin order is the array order. Use the order recommended by each integration
when two plugins affect the same output.

## Configure one page

A page-aware plugin exposes its id in adjacent `page.config.ts`:

```ts title="src/pages/checkout/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  plugins: {
    analytics: {
      channel: "checkout",
    },
  },
});
```

Do not import the plugin package into page configuration. With
`ev.config.ts`, generated TypeScript declarations provide completion for
installed plugin ids and page values. Keep `src/plugin-types.d.ts` ignored and
let the framework update it.

## Configure application and page scope

Application and page options are intentionally separate:

| Scope | Location | Good for |
| --- | --- | --- |
| Application | Plugin factory in `ev.config.ts` | Endpoints, credentials references, build choices, callbacks allowed by the plugin |
| Page | Plugin id in `page.config.ts#plugins` | Static metadata or behavior owned by one page |

Page options must be static JSON data. They do not inherit application fields,
and application fields are not copied into page values. Never put secrets in a
page value or in any option that the plugin documents as browser-visible.

## Choose default or opt-in behavior

The plugin's declared page defaults determine what omission means:

| Authoring form | Behavior |
| --- | --- |
| `analytics(options)` | Installs the plugin. An omitted page uses page defaults when they exist; otherwise it is off for that page. |
| `analytics.forPages(options)` | Installs the plugin but requires every page to opt in, even when defaults exist. |
| Page entry `false` | Disable the plugin for this page. |
| Page entry `true` | Enable with declared page defaults; invalid when the plugin has no defaults. |
| Page entry `{ ... }` | Enable with the supplied typed page options merged over page defaults. |

Use `forPages()` for selected-page activation:

```ts title="ev.config.ts"
export default defineConfig({
  plugins: [analytics.forPages({ endpoint: "/events" })],
});
```

```ts title="src/pages/checkout/page.config.ts"
export default definePageConfig({
  plugins: {
    analytics: true,
  },
});
```

When the plugin has no page defaults, provide the required object instead of
`true`.

## Disable a plugin conditionally

The application plugin array accepts `false`, `null`, and `undefined`:

```ts
export default defineConfig({
  plugins: [process.env.ANALYTICS === "1" && analytics(options)],
});
```

Use this for integrations without page configuration. A conditional plugin is
not guaranteed to exist, so its id cannot be offered safely to
`page.config.ts`. For a page-aware plugin, install it deterministically and use
`forPages()` or a page value of `false`.

## Keep page configuration type-safe

Page completion works best when page-aware plugin factories remain directly in
the tuple passed to `defineConfig()`:

```ts
export default defineConfig({
  plugins: [analytics(options), accessControl(options)],
});
```

Avoid widening that list to a generic plugin array or choosing between whole
arrays when pages need exact plugin ids. TypeScript can expose only plugins
that are statically certain to install.

## Diagnose plugin configuration

Run:

```bash
ev inspect
```

It reports installed plugins, page configuration, and validation errors.
Common problems are:

- using a page plugin id that is not installed;
- setting `true` for a plugin without page defaults;
- putting functions, symbols, class instances, cycles, or non-finite numbers
  in page configuration;
- conditionally installing a plugin that pages try to configure;
- expecting application fields to merge into page values.

## Build a plugin

Application authors normally stop here. To create an integration, continue
with:

| Goal | Read |
| --- | --- |
| Define typed application and page options | [Plugin Development](./plugin-authoring) |
| Choose lifecycle hooks | [Plugin Hooks](./plugin-hooks) |
| Generate modules or attach framework code | [Generating Code](./generated-contributions) |
| Start from small examples | [Plugin Recipes](./plugin-recipes) |
| Configure the official micro-frontend bridge | [Qiankun](./qiankun) |
