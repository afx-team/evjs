module.exports = function remoteClientLoader() {
  this.cacheable?.();
  const app = this.resourcePath;

  return [
    `import * as mod from ${JSON.stringify(app)};`,
    `import { createRemoteReactModule, registerShellModule } from "@evjs/client";`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `if (href) registerShellModule(href, () => createRemoteReactModule(mod));`,
    `export * from ${JSON.stringify(app)};`,
    `export { default } from ${JSON.stringify(app)};`,
  ].join("\n");
};
