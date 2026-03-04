# @evjs Task List

## Stage 1: Core Framework Skeleton
- [x] Plan the `@evjs/runtime` client framework skeleton
- [x] Implement framework core in `packages/runtime/src/client/`
- [x] Verify with `tsc --noEmit`

## Stage 2: React Server Functions (Data/AJAX)
- [x] Implement SHA-256 stable IDs in `server-fn-loader.ts`
- [x] Implement `EvWebpackPlugin` to emit `manifest.json`
- [x] Refactor loader to use `@swc/core` for transformations
- [x] Migrate workspace to `swc-loader`
- [x] Use project-relative paths in manifest metadata

## Stage 2.8: @evjscli Implementation
- [x] Initialize `packages/cli` with `package.json`
- [x] Implement `@evjscli` with `init`, `dev`, `build` commands
- [x] Verify with example project scaffolding

## Stage 3: Server-Side Rendering (SSR)
- [/] Implement server entry point (`packages/runtime/src/server/`)
- [ ] Add `renderToPipeableStream` and HTML streaming
- [ ] Add client hydration
- [ ] Create `examples/basic-ssr`
