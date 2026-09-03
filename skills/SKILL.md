---
name: evjs
description: Develop, migrate, review, document, or debug evjs applications and framework code involving file-based pages, ev.config.ts, server functions, API routes, rendering, plugins, development, builds, and deployment.
---

# evjs development

## Workflow

1. Determine whether the target is an application using the evjs file
   conventions, an application using the client or server runtime directly, or
   the evjs framework repository.
2. Read the target `package.json`, `ev.config.ts`, page tree, and relevant tests
   before editing. In the framework repository, read `AGENTS.md` and follow the
   documented source-of-truth files.
3. Use the application model and public import boundaries below. Do not copy
   generated files or framework internals into application code.
4. Use `ev inspect --json` when routes, rendering choices, or build support need
   verification.
5. Run focused checks for the affected workspace, then lint and run
   `git diff --check`.

## Application model

- Enable file-based pages with `routing: { mode: "spa" | "mpa" }`.
- A `src/pages/**/page.{ts,tsx,js,jsx}` file publishes a React page. Its
  directory determines the URL and can contain the components, hooks, models,
  styles, tests, and other source owned by that page.
- An optional adjacent `page.config.ts` defines static `title`, named `meta`,
  rendering options, and page-level plugin options.
- `$param`, terminal `$...splat`, and `(group)` directories represent dynamic,
  catch-all, and pathless segments. Dynamic and catch-all pages require SPA
  mode.
- A module imported by the application and beginning with `"use server";`
  exposes supported named exports as server functions. `.server.*` is a useful
  filename, not the discovery rule.
- A `src/apis/**/api.{ts,tsx,js,jsx}` file publishes an HTTP endpoint through
  uppercase method exports. Compose application-wide middleware in
  `src/middlewares/middleware.{ts,tsx,js,jsx}`, exporting one function or an
  ordered non-empty array. Compose HTTP method policies with
  `withMiddlewares(handler, middlewares)` from `@evjs/ev/api`, and reuse shared
  chains through ordinary imports. Import middleware types and `requestLogger`
  from `@evjs/ev/middleware`.
- `application.routes` is an advanced, explicit SPA alternative to file-based
  routing. Do not combine it with `routing`; nested declarations use `routes`.
- Install plugins through `config.plugins`, normally as
  `pluginFactory(applicationConfig)`. Put page-specific plugin options in
  `page.config.ts`.

## Public imports

- Use `@evjs/ev` for `defineConfig()` and `definePageConfig()`.
- Use `@evjs/ev/api`, `/middleware`, `/route`, `/navigation`, `/query`,
  `/server-context`, and `/transport` in applications that use the file conventions.
- Use `@evjs/ev/plugin` for plugin authoring and `@evjs/ev/deployment` for
  deployment helpers.
- Use `@evjs/client` or `@evjs/server` when an application deliberately manages
  its browser route tree or server runtime directly.
- Reserve `@evjs/ev/_internal/*` for the CLI, bundler adapters, and generated
  framework code.

## Documentation work

Treat documentation as a user interface for the framework.

### Content

- Explain the framework model, the choices available to application authors,
  and the workflow for completing a task. Lead with what the reader can
  achieve, then show the smallest useful example, constraints, and relevant
  troubleshooting.
- Keep implementation call flow, compiler data structures, generated
  intermediate representation, and package ownership out of user guides.
  Document those details in `ARCHITECTURE.md`, contributor guides, or focused
  implementation references when they are genuinely needed.
- Describe current supported behavior. Put release history in `CHANGELOG.md`
  and active gaps or future work in `ROADMAP.md`.
- Prefer public language such as “page”, “API route”, “file convention”,
  “imported module”, and “direct runtime”. Avoid implementation-oriented terms
  such as “canonical”, “positive anchor”, “materialize”, “reachable”, “facet”,
  and “projection” unless the document is explicitly about an internal
  contract.
- Use public imports and runnable examples. Do not teach users to edit `.ev`,
  generated declarations, `dist`, or private `@evjs/ev/_internal/*` modules.

### Structure and language

- Organize material by reader intent: overview and framework design first,
  task-oriented guides next, and exact configuration or API details in the
  reference section.
- Use precise, action-oriented headings. Write sentence-case English and
  natural Chinese; avoid literal translations, mixed jargon, vague labels, or
  wording that describes an implementation step instead of the user's goal.
- Keep paragraphs short, use tables only for real comparisons, and place code
  immediately after the concept it demonstrates. Link to one authoritative
  explanation instead of repeating internal detail across pages.
- Keep the root `README.md` concise: introduce the framework, show the quick
  start and application model, and point readers to the documentation. Keep
  repository architecture in `ARCHITECTURE.md`.

### English and Chinese parity

- Update an English page under `docs/docs/` and its Chinese counterpart under
  `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/` together.
- Preserve the same supported behavior, examples, cautions, links, and
  information hierarchy in both languages. The wording should be idiomatic in
  each language rather than mechanically identical.
- Treat the convention matrix in `docs/docs/project-structure.md` as the
  authoring source of truth for pages and routes. When a convention changes,
  update its Chinese counterpart and any affected examples or scaffolds in the
  same change.

### Documentation validation

For documentation-only changes, run:

```bash
npm run lint
npm --workspace evjs-docs run build
git diff --check
```

Open affected pages locally when navigation, links, routes, code layout, or
responsive rendering changed. Confirm both locale URLs when shared structure or
document routing changed.

## Generated and internal boundaries

- Treat `.ev`, `src/route-types.d.ts`, `src/plugin-types.d.ts`, and `dist` as
  generated output. Do not edit them or copy them into scaffolds.
- Framework implementation work must keep route discovery, rendering behavior,
  and output identity in `@evjs/ev`; bundler adapters implement the build plan
  they receive.
- Programmatic client route trees and `@evjs/server` `createRoute()` belong to
  the direct runtime APIs. They are not inputs to the file conventions.
- Read `ARCHITECTURE.md` before changing graph, build-plan, generated-output,
  bundler, runtime, or deployment ownership.

## References

- [What is evjs?](../docs/docs/overview.md)
- [Quick start](../docs/docs/quick-start.md)
- [Framework design](../docs/docs/architecture.md)
- [Project structure and convention matrix](../docs/docs/project-structure.md)
- [Guides](../docs/docs/guides.md)
- [Reference](../docs/docs/reference.md)
- [Configuration](../docs/docs/config.md)
- [Pages and routing](../docs/docs/client-routes.md)
- [Server functions](../docs/docs/server-functions.md)
- [API routes and middleware](../docs/docs/server-routes.md)
- [Plugins](../docs/docs/plugins.md)
- [Build and deployment](../docs/docs/build.md)
- [Framework architecture](../ARCHITECTURE.md)
