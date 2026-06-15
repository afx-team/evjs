const path = require("node:path");

module.exports = function pagesEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  return createPagesEntrySource(options, {
    resourcePath: this.resourcePath,
    rootContext: this.rootContext,
  });
};

function createPagesEntrySource(options, loaderContext) {
  const routes = Array.isArray(options.routes) ? options.routes : [];
  const mount = options.mount || "#app";
  const rootModule = options.rootModule;
  const imports = [
    `import { createPagesApp } from "@evjs/client/internal";`,
    rootModule
      ? `import * as rootModule from ${JSON.stringify(toLoaderRelativeRequest(rootModule, loaderContext))};`
      : "",
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderRelativeRequest(route.module, loaderContext))};`,
    ),
  ].filter(Boolean);

  const routeDefinitions = routes.map(
    (route, index) =>
      `{ path: ${JSON.stringify(route.path)}, module: routeModule${index} }`,
  );

  return [
    ...imports,
    ``,
    `const { app } = createPagesApp({`,
    rootModule ? `  rootModule,` : "",
    `  routes: [${routeDefinitions.join(", ")}],`,
    `});`,
    `app.render(${JSON.stringify(mount)});`,
    `export { app };`,
    `export default app;`,
    ``,
  ].join("\n");
}

function toLoaderRelativeRequest(specifier, loaderContext) {
  if (!specifier.startsWith(".")) return specifier;
  const rootContext = loaderContext.rootContext || process.cwd();
  const fromDir = path.dirname(loaderContext.resourcePath);
  const absolute = path.resolve(rootContext, specifier);
  let relative = path.relative(fromDir, absolute).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}
