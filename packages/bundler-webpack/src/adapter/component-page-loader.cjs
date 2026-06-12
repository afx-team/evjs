module.exports = function componentPageLoader() {
  this.cacheable?.();

  const options = this.getOptions();
  const route = options.route;

  return [
    `import Component from ${JSON.stringify(this.resourcePath)};`,
    `import { createReactPageModule, mountReactPage, registerShellModule } from "@evjs/client/internal";`,
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
