const path = require("node:path");

module.exports = function componentPageLoader() {
  this.cacheable?.();

  const options = this.getOptions ? this.getOptions() : {};
  const route = options.route;

  return [
    `import Component from ${JSON.stringify(`./${path.basename(this.resourcePath)}?evjs-component-page-source`)};`,
    `import { createReactPageModule, mountReactPage, registerShellModule } from "@evjs/client/internal/react-page";`,
    ``,
    `const importMetaHref = import.meta.url;`,
    `const currentScript = typeof document !== "undefined" ? document.currentScript : undefined;`,
    `const currentScriptHref = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `const href = currentScriptHref ?? importMetaHref;`,
    `const shellScript = currentScript ?? (typeof document !== "undefined" ? Array.from(document.scripts).find((script) => script.src === importMetaHref) : undefined);`,
    `const loadedByShell = shellScript?.getAttribute?.("data-evjs-shell-load") === "true";`,
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
