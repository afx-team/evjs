# What is evjs?

evjs is a React full-stack framework for applications that want file-based
pages, optional server capabilities, and a predictable path from local
development to deployment.

It is designed around a simple idea: **a page directory should contain the
page, its configuration, and the code that belongs to it**. The filesystem
describes the public structure of the application; configuration describes only
the behavior that cannot be inferred safely.

## The application model

An evjs project usually starts with three main areas:

```text
my-app/
├── ev.config.ts
└── src/
    ├── pages/                       # React pages and layouts
    │   ├── page.tsx                 # /
    │   └── users/
    │       └── $userId/
    │           └── page.tsx         # /users/:userId
    └── apis/                        # public HTTP endpoints
        └── health/
            └── api.ts               # /health
```

- A `page.*` file publishes a React page. Its directory determines the URL.
- An optional adjacent `page.config.ts` chooses metadata, rendering, and
  page-level plugin behavior.
- An `api.*` file publishes an HTTP endpoint using standard `Request` and
  `Response` objects.
- A module imported by the application and beginning with `"use server";`
  exposes named operations that application code can call through the
  framework transport.

Files that do not match one of these conventions remain ordinary application code.
Components, hooks, models, tests, and server functions can stay beside the
page that owns them.

## What evjs handles for you

evjs provides defaults for the recurring framework work around an application:

- discovering pages and API routes;
- creating browser and server entry points;
- navigation, parameters, layouts, and route boundaries;
- per-page CSR, SSR, SSG, PPR, and RSC choices;
- local development and production builds;
- plugin configuration at application and page scope;
- deployable output for static, Node.js, and edge environments.

You can replace selected defaults through configuration and plugins without
redefining the whole application.

## One page tree, two navigation models

The same `src/pages` tree can be built as an SPA or an MPA:

| Mode | Best fit | Navigation |
| --- | --- | --- |
| SPA | App-like experiences with nested and dynamic routes | A browser router moves between pages without full document reloads. |
| MPA | Independent static page entries | Each static page owns an HTML document and browser navigation loads that document. |

Changing the mode does not require moving pages or learning a second page
format. MPA intentionally supports only static paths; dynamic segments and
browser-router boundaries belong to SPA applications.

## Server code when you need it

An application can remain browser-only, add a few server functions, expose
public HTTP routes, or render selected pages on a server. These capabilities
share one request boundary and can be deployed together or split between a
static host and an origin.

This lets teams begin with a small client application and add server work only
for the pages that benefit from it.

## Designed for extension

Plugins can add integrations, typed application options, typed page options,
build behavior, and deployment support. Application authors install a plugin
through `ev.config.ts`; plugin-specific page choices stay in the adjacent
`page.config.ts`.

The core page and route model remains stable even when integrations change.

## Where to go next

- New to evjs? Follow the [Quick Start](./quick-start).
- Deciding how to organize an application? Read
  [Project Structure](./project-structure).
- Want the reasoning behind the conventions? Read
  [Framework Design](./architecture).
- Looking for a specific task? Browse the [Guides](./guides).
- Looking for an exact option? Open the [Reference](./reference).
