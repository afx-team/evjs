const path = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = function pagesEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  const loaderContext = {
    resourcePath: this.resourcePath,
    rootContext: this.rootContext,
  };
  const routes = Array.isArray(options.routes) ? options.routes : [];
  const mount = options.mount || "#app";
  const rootModule = options.rootModule;
  const imports = [
    `import { createPagesApp } from "@evjs/client/internal";`,
    rootModule
      ? `import * as rootModule from ${JSON.stringify(toLoaderModuleRequest(rootModule, loaderContext))};`
      : "",
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderModuleRequest(route.module, loaderContext))};`,
    ),
  ].filter(Boolean);

  const routeDefinitions = routes.map((route, index) => {
    const properties = [
      route.id ? `id: ${JSON.stringify(route.id)}` : "",
      `path: ${JSON.stringify(route.path)}`,
      route.parentId ? `parentId: ${JSON.stringify(route.parentId)}` : "",
      route.kind ? `kind: ${JSON.stringify(route.kind)}` : "",
      `module: routeModule${index}`,
    ].filter(Boolean);
    return `{ ${properties.join(", ")} }`;
  });

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
};

function toLoaderModuleRequest(specifier, loaderContext) {
  if (!specifier.startsWith(".") && !path.isAbsolute(specifier)) {
    return specifier;
  }

  const rootContext = loaderContext.rootContext || process.cwd();
  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(rootContext, specifier);
  return pathToFileURL(absolute).href.replace(/!/g, "%21");
}
