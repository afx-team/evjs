# Contributing

> Internal guide for developing the evjs monorepo.

## Project identity

- **Name**: evjs, package scope `@evjs/*`
- **Repository**: [afx-team/evjs](https://github.com/afx-team/evjs)
- **CLI**: `ev` from `@evjs/cli`
- **Linter**: Biome
- **Modules**: ESM-only

## Setup

```bash
git clone https://github.com/afx-team/evjs.git
cd evjs
npm install
```

## Commands

```bash
npm run build
npm run test
npm run test:e2e
npm run check-types
npm run lint
npx biome check --write
```

## Coding rules

1. Keep imports at the top and use `import type` for type-only imports.
2. Use Biome formatting and linting. Avoid `any` and broad namespace imports
   without a concrete reason.
3. New applications use one page-and-route model:
   `src/pages/**/page.*`, optional build-time `page.config.ts`,
   directory-derived URLs, and `routing.mode`.
4. Keep page-specific components, hooks, models, services, tests, and styles
   inside that page directory. They do not need `_`.
5. File-based client routes use `$param`, terminal `$...splat`, and `(group)`
   directories. API routes use `src/apis/**/api.*`; their directories determine
   the URL.
6. New runnable examples use `page.*`, `page.config.ts`, and `routing.mode`.
   Keep explicit `application.routes` cases in focused config-route fixtures.
7. Server functions begin with `"use server";` and export named callables.
8. Config/build imports stay on `@evjs/ev`; app source uses
   `@evjs/ev/api`, `/route`, `/navigation`, `/query`, `/server-context`, and
   `/transport`. Applications that use a runtime directly import
   `@evjs/client` or `@evjs/server`.
9. Keep framework semantics in `@evjs/ev` build internals and normalized
   contracts in `@evjs/shared/manifest`. Bundler adapters consume BuildPlan and
   return facts.
10. `.ev`, `dist`, `.turbo`, `node_modules`, and route-type declarations are
    generated output.
11. Use `middlewares` for middleware collection fields and arguments.
    Use `MiddlewareHandler` for one function and `MiddlewareChain` for an
    ordered chain. Use singular middleware names for capabilities, hooks, and
    modules: `server.request.middleware`, `clientDevMiddleware`, and `middleware.*`.
    Name concrete middleware factories by behavior, such as `requestLogger()`.

## Common tasks

### Add a page route

1. Create `src/pages/<url-segments>/page.tsx`.
2. Default-export the page component.
3. Use `$param`, terminal `$...splat`, or `(group)` directories when needed.
4. Put page-specific source in the same directory; no `_` prefix is required.
5. Add `page.config.ts` when the page needs a static title, supported named
   metadata, core rendering fields, or page settings for an installed plugin.
   Runtime use of plugin settings requires explicit plugin projection.

### Add a server function

1. Create `[name].server.ts` beside its caller or domain code and import it from
   the application.
2. Add `"use server";` at the top.
3. Export named async callables.
4. Consume them through `@evjs/ev/query`.

### Add an API route

1. Create the URL directory under `src/apis` and add its `api.ts` file.
2. Export uppercase HTTP handlers such as `GET` or `POST` from that file.
3. Keep helpers in ordinary colocated non-`api.*` modules.
4. Compose ordered global middleware in `src/middlewares/middleware.ts`, or
   use `src/apis/**/middleware.*` for middleware limited to an API route tree.
   Both accept one function or a non-empty array. Compose a method's policies
   with `withMiddlewares(handler, middlewares)` from `@evjs/ev/api`.

### Add an example

1. Add a private workspace package under `examples/`.
2. Use `routing.mode` and `page.*` route directories.
3. Add `index.html` and the required workspace dependencies.
4. Add/update create-app mapping only when it is a supported user template.
5. Add focused unit/e2e validation.
6. Keep explicit route-tree cases in clearly named config-route fixtures, not
   user templates.

### Change page or route conventions

1. Update config resolution and graph normalization first.
2. Update English and Chinese `project-structure`, `file-conventions`, config,
   and relevant examples together.
3. Add graph, diagnostics, scaffold, and config-route coverage.
4. Run the repository validation gates.

### Release a version

1. Create a GitHub Release with the `vX.Y.Z` tag for the version being released.
2. Release automation synchronizes internal package versions and publishes.
3. Do not bump workspace-internal `"*"` dependencies locally.
