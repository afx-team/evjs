# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/afx-team/evjs/ci.yml?style=flat-square&label=CI)](https://github.com/afx-team/evjs/actions)

evjs is a React full-stack framework built around file-based pages, optional
server capabilities, and a predictable path from local development to
deployment.

[Documentation](https://afx-team.github.io/evjs/docs/overview) ·
[Quick Start](https://afx-team.github.io/evjs/docs/quick-start) ·
[简体中文](https://afx-team.github.io/evjs/zh-Hans/docs/overview)

## Why evjs?

- **Pages follow the filesystem.** A `page.*` file creates a page, and its
  directory determines the URL. Components, hooks, styles, tests, and other
  source can stay beside the page that uses them.
- **One page tree supports SPA and MPA.** Choose the navigation model in
  `ev.config.ts` without reorganizing the application.
- **Rendering is selected per page.** Use an adjacent `page.config.ts` for
  metadata and CSR, SSR, SSG, PPR, or RSC behavior.
- **Server capabilities are optional.** Add imported `"use server"` functions
  for application operations or `api.*` files for public HTTP endpoints.
- **Plugins remain typed and local.** Configure integrations for the
  application and opt individual pages into plugin behavior when needed.
- **Build for the target you need.** Produce browser output and, when required,
  server output for static, Node.js, or edge deployments.

## Quick start

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

Open the browser URL printed by the development server.

Choose SPA or MPA in `ev.config.ts`:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

Then add a page:

```tsx
// src/pages/page.tsx → /
export default function HomePage() {
  return <h1>Hello from evjs</h1>;
}
```

The directory structure is the route structure:

```text
src/
├── pages/
│   ├── page.tsx                     # /
│   └── users/
│       └── $userId/
│           └── page.tsx             # /users/:userId
└── apis/
    └── health/
        └── api.ts                    # /health
```

Continue with the [Quick Start](https://afx-team.github.io/evjs/docs/quick-start)
to add navigation, page configuration, server functions, and API routes.

## Framework model

An evjs application has a small set of public conventions:

| File or directory | Purpose |
| --- | --- |
| `ev.config.ts` | Select routing, plugins, build behavior, and deployment options. |
| `src/pages/**/page.*` | Publish React pages; directories define their URLs. |
| `src/pages/**/page.config.ts` | Configure metadata, rendering, and page-level plugin behavior. |
| Imported `"use server"` modules | Expose named server functions to application code. |
| `src/apis/**/api.*` | Publish HTTP handlers using standard `Request` and `Response`. |

Only these explicit conventions create framework behavior. Other files remain
ordinary application source and can be organized around the feature that owns
them.

## Documentation

- [What is evjs?](https://afx-team.github.io/evjs/docs/overview)
- [Project structure](https://afx-team.github.io/evjs/docs/project-structure)
- [Framework design](https://afx-team.github.io/evjs/docs/architecture)
- [Guides](https://afx-team.github.io/evjs/docs/guides)
- [Reference](https://afx-team.github.io/evjs/docs/reference)

## Packages

| Package | Purpose |
| --- | --- |
| [`@evjs/ev`](./packages/ev) | Main framework API for application configuration, pages, plugins, builds, and deployment. |
| [`@evjs/cli`](./packages/cli) | Commands for development, inspection, preparation, and production builds. |
| [`@evjs/create-app`](./packages/create-app) | Project scaffolding through `npx @evjs/create-app`. |
| [`@evjs/client`](./packages/client) | Browser runtime APIs for applications that manage their own route tree. |
| [`@evjs/server`](./packages/server) | Server runtime APIs for Hono and standard Fetch applications. |
| [`@evjs/plugin-qiankun`](./packages/plugin-qiankun) | Optional qiankun integration. |
| [`examples/`](./examples) | Runnable examples for common application patterns and integrations. |

Most applications start with `@evjs/ev`. The focused authoring imports
`@evjs/ev/route`, `@evjs/ev/navigation`, `@evjs/ev/query`,
`@evjs/ev/server-context`, and `@evjs/ev/transport` are available when those
capabilities are needed.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before making a change. Framework
contributors should also use [AGENTS.md](./AGENTS.md) and
[ARCHITECTURE.md](./ARCHITECTURE.md) for repository instructions and internal
design details.

```bash
npm install
npm run build
npm test
npm run test:e2e
npm run check-types
npm run lint
```

## License

MIT © [Ant UED](https://xtech.antfin.com/)
