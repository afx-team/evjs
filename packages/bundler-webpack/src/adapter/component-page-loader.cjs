module.exports = function componentPageLoader() {
  this.cacheable?.();

  const options = this.getOptions();

  return [
    `import Component from ${JSON.stringify(this.resourcePath)};`,
    `import { createReactPageModule, mountReactPage } from "@evjs/client";`,
    `import { registerShellModule } from "@evjs/client";`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `const loadedByShell = currentScript?.getAttribute?.("data-evjs-shell-load") === "true";`,
    `const mod = createReactPageModule({`,
    `  component: Component,`,
    `  hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `  render: ${JSON.stringify(options.render ?? "csr")},`,
    `});`,
    `if (href) registerShellModule(href, mod);`,
    `if (!loadedByShell) {`,
    `  mountReactPage({`,
    `    component: Component,`,
    `    mount: ${JSON.stringify(options.mount ?? "#app")},`,
    `    hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `    render: ${JSON.stringify(options.render ?? "csr")},`,
    `  });`,
    `}`,
    `export default mod;`,
    ``,
  ].join("\n");
};
