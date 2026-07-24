# ev Deployment Adapters Example

This example focuses on deployment adapter hooks. It keeps a small app, a server
function, and a REST route so adapters can inspect a realistic `BuildOutput`
without mixing in render-mode pages or unrelated runtime behavior.

The application uses the unified Core 0.3 model: `src/pages/page.tsx` defines
the `/` Page, while `routing.mode` selects SPA materialization. There is no
manual `src/main.tsx`, route tree, or legacy `app.entry` declaration.

It exercises:

- `buildOutput()` metadata mutation;
- per-document `transformHtml()`;
- `buildEnd({ output })` artifact generation;
- the built-in node, static, and edge deployment adapters;
- `createDeploymentArtifact()` output.

The custom adapter writes `dist/deployment.example.json` and adds
`deploymentAdaptersExample` metadata to the in-memory build result.

Deployment hooks receive the complete in-memory `BuildOutput` plus canonical
`deploymentMetadata`. Platform artifacts should consume
`deploymentMetadata` or `createDeploymentArtifact()` instead of reading
bundler stats or split compatibility manifests. Plugins that need semantic
Application/Page/Route/Document data use the normalized framework view.
