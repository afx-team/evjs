import fs from "node:fs";
import path from "node:path";
import { createDeploymentArtifact } from "@evjs/ev/deployment";
import { definePlugin } from "@evjs/ev/plugin";

export const deploymentExampleAdapter = definePlugin({
  name: "@example/deployment-adapter",
  setup(ctx) {
    return {
      transformOutput(output) {
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
        const kind = htmlCtx.owner.kind;
        const id =
          kind === "page"
            ? htmlCtx.owner.pageId
            : kind === "plugin"
              ? htmlCtx.owner.pluginId
              : htmlCtx.applicationId;
        doc.documentElement?.setAttribute("data-deployment-example-html", id);
        doc.head?.insertAdjacentHTML(
          "beforeend",
          `<meta name="evjs-deployment-example-html" content="${kind}:${id}">`,
        );
      },
      afterBuild({ output }) {
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
});
