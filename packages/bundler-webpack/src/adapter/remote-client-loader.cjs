module.exports = function remoteClientLoader() {
  this.cacheable?.();
  const app = this.resourcePath;

  return [
    `import * as mod from ${JSON.stringify(app)};`,
    `import { createReactPageModule, registerShellModule } from "@evjs/client";`,
    ``,
    `function createRemoteShellModule(exports) {`,
    `  if (typeof exports.mount === "function" || typeof exports.hydrate === "function" || typeof exports.unmount === "function") {`,
    `    return exports;`,
    `  }`,
    `  if (typeof exports.default === "function") {`,
    `    return {`,
    `      init: typeof exports.init === "function" ? exports.init : undefined,`,
    `      ...createReactPageModule({`,
    `        component: exports.default,`,
    `        hydrate: "load",`,
    `        render: "csr",`,
    `        props(ctx) {`,
    `          return {`,
    `            ctx,`,
    `            remote: ctx && ctx.remote,`,
    `            request: ctx && ctx.request,`,
    `          };`,
    `        },`,
    `      }),`,
    `    };`,
    `  }`,
    `  return exports;`,
    `}`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `if (href) registerShellModule(href, () => createRemoteShellModule(mod));`,
    `export * from ${JSON.stringify(app)};`,
    `export { default } from ${JSON.stringify(app)};`,
  ].join("\n");
};
