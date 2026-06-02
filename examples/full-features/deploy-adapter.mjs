import fs from "node:fs";
import path from "node:path";
import { createDeploymentArtifact } from "@evjs/ev";

export function fullFeaturesDeployAdapter() {
  return {
    name: "full-features-deploy-adapter",
    setup(ctx) {
      return {
        buildOutput(output) {
          output.deployment = {
            ...(output.deployment ?? {}),
            fullFeaturesExample: {
              apps: Object.keys(output.apps),
              pages: Object.keys(output.pages),
              rscPages: Object.keys(output.rsc?.pages ?? {}),
              remotes: Object.keys(output.remotes ?? {}),
              serverBasePath: output.runtime.server?.basePath,
            },
          };
        },
        transformHtml(doc, htmlCtx) {
          const id = htmlCtx.kind === "page" ? htmlCtx.pageId : htmlCtx.appId;
          doc.documentElement?.setAttribute("data-full-features-html", id);
          doc.head?.insertAdjacentHTML(
            "beforeend",
            `<meta name="evjs-example-html" content="${htmlCtx.kind}:${id}">`,
          );
        },
        buildEnd({ output }) {
          const artifactPath = path.join(
            ctx.cwd,
            output.distDir,
            "deployment.full-features.json",
          );
          fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
          fs.writeFileSync(
            artifactPath,
            JSON.stringify(
              createDeploymentArtifact(output, {
                platform: "full-features-example",
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
