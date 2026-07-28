# @evjs/create-app

> Scaffolding tool for the **evjs** fullstack framework.

## Commands

### `npx @evjs/create-app`

The primary interactive CLI for creating new projects.

```bash
npx @evjs/create-app [name] [options]
```

## Options

- `[name]` (string): Project name and directory.
- `--template <name>`: Specify a template (see [Templates](#templates)).
- `--help`: Show usage info.

## Templates

Every template uses the same Page-and-Route authoring model: `page.tsx` anchors,
optional build-time `page.config.ts` for static title/named metadata and
rendering, and directory-derived URLs.
`routing.mode` is the only routing-mode configuration; SPA and MPA
materialize the same Page tree differently.

| Name | Description |
|------|-------------|
| **`basic`** | Basic full-stack SPA with routing, `page.config.ts`, and server functions. |
| **`mpa`** | The same Page/config model materialized as separate documents. |
| **`api-routes`** | REST API routes via positive `src/apis/**/api.*` anchors. |
| **`complex-routing`** | Advanced Page routes with a root layout, params, redirects, and nested paths. |
| **`custom-ws-transport`** | Custom transport example using WebSockets. |
| **`plugin-authoring`** | Starter focused on plugin authoring and bundler hooks. |
| **`with-sqlite`** | Full-stack CRUD example backed by SQLite. |
| **`with-tailwind`** | Ready-to-go Tailwind CSS integration. |
| **`with-trpc`** | Example interoperating with tRPC. |

## Quick Start via npx

```bash
npx @evjs/create-app my-new-app
```

Follow the interactive prompts to select your features and get started in seconds.

Generated framework files such as `src/route-types.d.ts` are never copied from
templates and should remain ignored by source control.

`page.config.ts` is evaluated by evjs during graph construction. It is not a
browser entry: plugins must explicitly project any configured extension data
that their runtime needs.

## License

MIT
