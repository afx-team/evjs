const path = require("node:path");

module.exports = function rscPageRendererLoader() {
  this.cacheable?.();

  const component = this.resourcePath;
  const componentRequest = path.isAbsolute(component)
    ? component
    : path.resolve(this.rootContext, component);

  return `
import { createElement } from "react";
import { renderToReadableStream } from "react-server-dom-webpack/server.node";
import Component from ${JSON.stringify(componentRequest)};

function findRouteForPage(manifest, pageId) {
  if (!pageId) return undefined;
  const route = manifest.routes?.find((candidate) => candidate.pageId === pageId);
  return route
    ? {
        id: route.id,
        path: route.path,
      }
    : undefined;
}

function createProps(ctx) {
  return {
    manifest: {
      buildId: ctx.manifest.buildId,
    },
    pageId: ctx.pageId,
    route: findRouteForPage(ctx.manifest, ctx.pageId),
  };
}

export async function renderFlight(ctx) {
  const clientReferenceManifest = ctx.manifest.rsc?.clientReferenceManifest;
  if (!clientReferenceManifest) {
    return new Response("[evjs] RSC client reference manifest is not available.", {
      status: 501,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const stream = await renderToReadableStream(
    createElement(Component, createProps(ctx)),
    clientReferenceManifest,
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/x-component; charset=utf-8",
    },
  });
}

export default Component;
`;
};
