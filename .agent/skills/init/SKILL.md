---
name: evjs-init
description: Guide on scaffolding new evjs projects with `ev init`.
---

# Instruction

Use this skill when helping a user create a new evjs project.

## Command

```bash
npx @evjs/cli init [name] [-t, --template <template>]
```

Both arguments are optional — if omitted, the CLI prompts interactively.

## Available Templates

| Template | Description |
|----------|-------------|
| `basic-csr` | Client-side rendering only, no server functions |
| `basic-server-fns` | Minimal server functions with `"use server"` |
| `configured-server-fns` | Server functions with `ev.config.ts` + Query proxy |
| `complex-routing` | Params, search, layouts, loaders, nested routes |

## After Scaffolding

```bash
cd <project-name>
npm install
npm run dev     # http://localhost:3000
```

## Project Structure

```
my-app/
├── ev.config.ts          # optional config
├── index.html            # HTML template
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx           # app bootstrap (keep minimal)
    ├── routes.tsx         # route tree + components
    └── api/               # server functions
        └── users.server.ts
```

## Key Points

- Zero-config by default — `ev.config.ts` is optional
- All `@evjs/*` dependencies are set to the correct version automatically
- `src/main.tsx` should be kept minimal — define routes in `routes.tsx`
