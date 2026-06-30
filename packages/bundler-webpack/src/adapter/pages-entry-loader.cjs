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
    `import { createPagesApp } from "@evjs/ev/_internal/client";`,
    rootModule
      ? `import * as rootModule from ${JSON.stringify(toLoaderModuleRequest(rootModule, loaderContext))};`
      : "",
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderModuleRequest(route.module, loaderContext))};`,
    ),
    ...routes.flatMap((route, index) => [
      route.errorModule
        ? `import * as routeErrorModule${index} from ${JSON.stringify(toLoaderModuleRequest(route.errorModule, loaderContext))};`
        : "",
      route.notFoundModule
        ? `import * as routeNotFoundModule${index} from ${JSON.stringify(toLoaderModuleRequest(route.notFoundModule, loaderContext))};`
        : "",
    ]),
  ].filter(Boolean);

  const routeDefinitions = routes.map((route, index) => {
    const properties = [
      route.id ? `id: ${JSON.stringify(route.id)}` : "",
      `path: ${JSON.stringify(route.path)}`,
      route.parentId ? `parentId: ${JSON.stringify(route.parentId)}` : "",
      route.kind ? `kind: ${JSON.stringify(route.kind)}` : "",
      `module: ${createRouteModuleExpression(route, index)}`,
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

function createRouteModuleExpression(route, index) {
  const properties = [];
  if (route.errorModule) {
    properties.push(
      `errorComponent: routeErrorModule${index}.default ?? routeErrorModule${index}.errorComponent`,
    );
  }
  if (route.notFoundModule) {
    properties.push(
      `notFoundComponent: routeNotFoundModule${index}.default ?? routeNotFoundModule${index}.notFoundComponent`,
    );
  }
  if (properties.length === 0) return `routeModule${index}`;
  return `{ ${properties.join(", ")}, ...routeModule${index} }`;
}

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
