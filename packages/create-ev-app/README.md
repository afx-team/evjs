# create-ev-app

> Scaffolding tool for the **evjs** fullstack framework.

## Commands

### `create-ev-app`

The primary interactive CLI for creating new projects.

```bash
npx create-ev-app [name] [options]
```

## Options

- `[name]` (string): Project name and directory.
- `--template <name>`: Specify a template (see [Templates](#templates)).
- `--help`: Show usage info.

## Templates

| Name | Description |
|------|-------------|
| **`basic-csr`** | Client-side only (React + TanStack Router). |
| **`basic-server-fns`** | Basic full-stack with server functions. |
| **`configured-server-fns`** | Full-stack with `create-ev-app` + `ev.config.ts`. |
| **`complex-routing`** | Nested layouts, loaders, and search params. |
| **`with-tailwind`** | Ready-to-go Tailwind CSS integration. |

## Quick Start via npx

```bash
npx create-ev-app my-new-app
```

Follow the interactive prompts to select your features and get started in seconds.

## License

MIT
