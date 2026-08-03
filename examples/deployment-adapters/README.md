# ev Deployment Adapters Example

This example focuses on deployment adapter hooks. It keeps a small app, a server
function, and a REST route so adapters can inspect a realistic `BuildOutput`
without mixing in render-mode pages or unrelated runtime behavior.

The application uses the canonical model: `src/pages/page.tsx` defines the
`/` Page, while `routing.mode` selects SPA materialization.

It exercises:

- `transformOutput()` metadata mutation;
- per-document `transformHtml()`;
- `afterBuild({ output })` artifact generation;
- the built-in node, static, and edge deployment adapters;
- `createDeploymentArtifact()` output.

The custom adapter writes `dist/deployment.example.json` and adds
`deploymentAdaptersExample` metadata to the in-memory build result.

Deployment hooks receive the complete in-memory `BuildOutput` plus canonical
`deploymentMetadata`. Platform artifacts should consume
`deploymentMetadata` or `createDeploymentArtifact()` instead of reading
bundler stats. Plugins that need semantic
Application/Page/Route/Document data use the normalized framework view.
