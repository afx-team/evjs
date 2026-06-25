const path = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = function frameworkEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  const moduleRequest = toModuleRequest(
    options.module || options.component || options.app,
  );

  if (options.type === "react-component-page") {
    const entryOptions = {
      mount: options.mount ?? "#app",
      hydrate: options.hydrate ?? "load",
      render: options.render ?? "csr",
      ...(options.route ? { route: options.route } : {}),
    };
    return [
      `import Component from ${JSON.stringify(moduleRequest)};`,
      `import { createGeneratedReactPageEntry } from "@evjs/ev/internal/client/react-page";`,
      ``,
      `const mod = createGeneratedReactPageEntry(Component, ${JSON.stringify(entryOptions)}, import.meta.url);`,
      `export default mod;`,
      ``,
    ].join("\n");
  }

  if (options.type === "server-renderer") {
    return [
      `export { PageProvider } from "@evjs/ev/internal/client/page-context";`,
      `export { default } from ${JSON.stringify(moduleRequest)};`,
      `export * from ${JSON.stringify(moduleRequest)};`,
      ``,
    ].join("\n");
  }

  if (options.type === "rsc-page-renderer") {
    return [
      `import Component from ${JSON.stringify(moduleRequest)};`,
      `import { createRscPageFlightRenderer } from "@evjs/ev/internal/client/rsc-page-context";`,
      ``,
      `export const renderFlight = createRscPageFlightRenderer(Component);`,
      `export default Component;`,
      ``,
    ].join("\n");
  }

  throw new Error(
    `[evjs] Unknown webpack framework entry loader type "${options.type}".`,
  );
};

function toModuleRequest(specifier) {
  if (typeof specifier !== "string" || specifier.trim() === "") {
    throw new Error(
      "[evjs] Webpack framework entry loader requires a module path.",
    );
  }

  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(process.cwd(), specifier);
  return pathToFileURL(absolute).href.replace(/!/g, "%21");
}
