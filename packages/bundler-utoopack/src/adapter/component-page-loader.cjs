const path = require("node:path");

module.exports = function componentPageLoader() {
  this.cacheable?.();

  const options = this.getOptions ? this.getOptions() : {};
  const entryOptions = {
    mount: options.mount ?? "#app",
    hydrate: options.hydrate ?? "load",
    render: options.render ?? "csr",
    ...(options.route ? { route: options.route } : {}),
  };

  return [
    `import Component from ${JSON.stringify(`./${path.basename(this.resourcePath)}?evjs-component-page-source`)};`,
    `import { createGeneratedReactPageEntry } from "@evjs/ev/internal/client/react-page";`,
    ``,
    `const mod = createGeneratedReactPageEntry(Component, ${JSON.stringify(entryOptions)}, import.meta.url);`,
    `export default mod;`,
    ``,
  ].join("\n");
};
