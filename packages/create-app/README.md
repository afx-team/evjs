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

| Name | Description |
|------|-------------|
| **`basic`** | Basic full-stack example with routing and server functions. |
| **`mpa`** | Multi-page application with separate page entries. |
| **`api-routes`** | REST API routes via `server.routing` file routes. |
| **`complex-routing`** | Root layout, loaders, search params, and nested paths. |
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

Generated route type files such as `src/route-types.d.ts` are not copied
from templates; `ev dev` and `ev build` recreate them for the new project.

## License

MIT
