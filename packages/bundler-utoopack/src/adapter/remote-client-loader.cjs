const path = require("node:path");

const reactPageRuntime = "@evjs/client/internal/react-page";

module.exports = function remoteClientLoader() {
  this.cacheable?.();

  const sourceRequest = `./${path.basename(this.resourcePath)}?evjs-remote-client-source`;
  const runtimeRequest = JSON.stringify(reactPageRuntime);

  return [
    `import * as mod from ${JSON.stringify(sourceRequest)};`,
    `import { registerGeneratedRemoteClientEntry } from ${runtimeRequest};`,
    ``,
    `registerGeneratedRemoteClientEntry(mod, import.meta.url);`,
    `export * from ${JSON.stringify(sourceRequest)};`,
    `export { default } from ${JSON.stringify(sourceRequest)};`,
    ``,
  ].join("\n");
};
