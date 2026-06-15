const path = require("node:path");

module.exports = function componentPageLoader() {
  this.cacheable?.();

  const options = this.getOptions ? this.getOptions() : {};
  const route = options.route;

  return [
    `import Component from ${JSON.stringify(`./${path.basename(this.resourcePath)}?evjs-component-page-source`)};`,
    `import { createReactPageModule, mountReactPage, registerShellModule } from "@evjs/ev/client/internal/react-page";`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `const loadedByShell = currentScript?.getAttribute?.("data-evjs-shell-load") === "true";`,
    `const mod = createReactPageModule({`,
    `  component: Component,`,
    `  hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `  render: ${JSON.stringify(options.render ?? "csr")},`,
    `  route: ${JSON.stringify(route)},`,
    `});`,
    `if (href) registerShellModule(href, mod);`,
    `if (!loadedByShell) {`,
    `  mountReactPage({`,
    `    component: Component,`,
    `    mount: ${JSON.stringify(options.mount ?? "#app")},`,
    `    hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `    render: ${JSON.stringify(options.render ?? "csr")},`,
    `    route: ${JSON.stringify(route)},`,
    `  });`,
    `}`,
    `export default mod;`,
    ``,
  ].join("\n");
};
