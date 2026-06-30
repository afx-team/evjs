const path = require("node:path");

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
      ? `import * as rootModule from ${JSON.stringify(toLoaderRelativeRequest(rootModule, loaderContext))};`
      : "",
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderRelativeRequest(route.module, loaderContext))};`,
    ),
    ...routes.flatMap((route, index) => [
      route.errorModule
        ? `import * as routeErrorModule${index} from ${JSON.stringify(toLoaderRelativeRequest(route.errorModule, loaderContext))};`
        : "",
      route.notFoundModule
        ? `import * as routeNotFoundModule${index} from ${JSON.stringify(toLoaderRelativeRequest(route.notFoundModule, loaderContext))};`
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

function toLoaderRelativeRequest(specifier, loaderContext) {
  if (!specifier.startsWith(".")) return specifier;
  const rootContext = loaderContext.rootContext || process.cwd();
  const fromDir = path.dirname(loaderContext.resourcePath);
  const absolute = path.resolve(rootContext, specifier);
  let relative = path.relative(fromDir, absolute).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}
