# @evjs/bundler-webpack

Webpack adapter used to validate the evjs graph / build plan / manifest contracts.

The default evjs bundler remains Utoopack. This package exists so
framework-level features that need multiple server build entries or dynamic dev
plan updates can be exercised before Utoopack exposes equivalent lower-level
APIs.

Implemented capabilities:

- production build through webpack;
- dev mode through webpack-dev-server for client entries;
- server watch builds for SSR/PPR/server runtime entries;
- manifest and HTML relinking from `BuildPlan` + `AppGraph` + webpack stats;
- in-process `updatePlan(update, graph)` support for configured page additions
  without stopping the running webpack dev server;
- finer dev updates: HTML-only changes relink manifest/HTML without invoking
  webpack, and added/changed client entries compile as an entry subset when no
  server/removal semantics are involved;
- framework-managed component pages, SSR, PPR, and the first RSC page/Flight
  validation path;
- hardened RSC validation path: request validation, renderer matching, Flight
  content-type validation, and defensive server error responses.
