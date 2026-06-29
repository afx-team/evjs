import fs from "node:fs";
import path from "node:path";
import { createDeploymentArtifact } from "@evjs/ev";

export function deploymentExampleAdapter() {
  return {
    name: "deployment-example-adapter",
    setup(ctx) {
      return {
        buildOutput(output) {
          output.deployment = {
            ...(output.deployment ?? {}),
            deploymentAdaptersExample: {
              app: Object.keys(output.apps).length > 0,
              pages: Object.keys(output.pages),
              rscPages: Object.keys(output.rsc?.pages ?? {}),
              serverBasePath: output.runtime.server?.basePath,
            },
          };
        },
        transformHtml(doc, htmlCtx) {
          const id = htmlCtx.kind === "page" ? htmlCtx.pageId : htmlCtx.appId;
          doc.documentElement?.setAttribute("data-deployment-example-html", id);
          doc.head?.insertAdjacentHTML(
            "beforeend",
            `<meta name="evjs-deployment-example-html" content="${htmlCtx.kind}:${id}">`,
          );
        },
        buildEnd({ output }) {
          const artifactPath = path.join(
            ctx.cwd,
            output.paths.rootDir,
            "deployment.example.json",
          );
          fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
          fs.writeFileSync(
            artifactPath,
            JSON.stringify(
              createDeploymentArtifact(output, {
                platform: "deployment-adapters-example",
              }),
              null,
              2,
            ),
          );
        },
      };
    },
  };
}
