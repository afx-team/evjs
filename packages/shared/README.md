# @evjs/shared

`@evjs/shared` is the framework contract package used by evjs packages,
bundler adapters, deployment adapters, and custom framework tooling.

Application code should not import this package directly. Use the app-facing
packages instead:

- `@evjs/ev` for config, plugin types, and framework build APIs.
- `@evjs/client` for browser/page APIs and client-side server-function errors.
- `@evjs/server` for server functions, server routes, and structured server
  errors.

## Contract Surface

The package intentionally exposes only two subpaths:

- `@evjs/shared` for runtime constants, page/server route helpers, HTTP method
  helpers, build identifier validation, path pattern validation and matching,
  URL string validation, server-function ID validation, and RSC Flight page URL
  normalization. It also exposes shared error classes used internally by `@evjs/client` and
  `@evjs/server`.
- `@evjs/shared/manifest` for `AppGraph`, `BuildPlan`, `BuildOutput`, and
  manifest types consumed by framework tooling and deployment adapters.

When adding new framework contracts, prefer extending one of these subpaths
instead of creating another distributed package.

## Tooling Usage

Custom adapters can consume manifest contracts directly:

```ts
import type { BuildOutput } from "@evjs/shared/manifest";

export function deploy(output: BuildOutput) {
  return output;
}
```

App code should import equivalent runtime APIs from `@evjs/client` or
`@evjs/server`; `@evjs/shared` remains for framework contracts and custom
tooling.
