const path = require("node:path");

const reactPageRuntime = "@evjs/client/internal/react-page";

module.exports = function remoteClientLoader() {
  this.cacheable?.();

  const sourceRequest = `./${path.basename(this.resourcePath)}?evjs-remote-client-source`;
  const runtimeRequest = JSON.stringify(reactPageRuntime);

  return [
    `import * as mod from ${JSON.stringify(sourceRequest)};`,
    `import { createRemoteReactModule, registerShellModule } from ${runtimeRequest};`,
    ``,
    `const currentScript = typeof document !== "undefined" ? document.currentScript : undefined;`,
    `const currentScriptHref = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `const href = currentScriptHref ?? import.meta.url;`,
    `if (href) registerShellModule(href, () => createRemoteReactModule(mod));`,
    `export * from ${JSON.stringify(sourceRequest)};`,
    `export { default } from ${JSON.stringify(sourceRequest)};`,
    ``,
  ].join("\n");
};
