# ev Deployment Adapters Example

This example focuses on deployment adapter hooks. It keeps a small app, a server
function, and a REST route so adapters can inspect a realistic `BuildOutput`
without mixing in render-mode pages or unrelated runtime behavior.

It exercises:

- `buildOutput()` metadata mutation;
- per-document `transformHtml()`;
- `buildEnd({ output })` artifact generation;
- the built-in node, static, and edge deployment adapters;
- `createDeploymentArtifact()` output.

The custom adapter writes `dist/deployment.example.json` and adds
`deploymentAdaptersExample` metadata to the main manifest.
