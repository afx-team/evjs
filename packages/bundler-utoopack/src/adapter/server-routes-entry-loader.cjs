const path = require("node:path");

module.exports = function serverRoutesEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  const loaderContext = {
    resourcePath: this.resourcePath,
    rootContext: this.rootContext,
  };
  const routes = Array.isArray(options.routes) ? options.routes : [];
  const middlewares = toMiddlewares(options.middlewares);
  const serverFunctionModules = collectServerFunctionModules(
    options.serverFunctions,
  );
  const middlewareModules = collectMiddlewareModules(middlewares, routes);
  const middlewareImportNames = new Map(
    middlewareModules.map((middleware, index) => [
      middleware.module,
      `middleware${index}`,
    ]),
  );
  const imports = [
    `import { createApp, createRoute } from "@evjs/ev/_internal/server";`,
    `import { createReactFrameworkServer } from "@evjs/ev/_internal/server/react";`,
    ...middlewareModules.map(
      (middleware, index) =>
        `import middleware${index} from ${JSON.stringify(toLoaderRelativeRequest(middleware.module, loaderContext))};`,
    ),
    ...serverFunctionModules.map(
      (module) =>
        `import ${JSON.stringify(toLoaderRelativeRequest(module, loaderContext))};`,
    ),
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderRelativeRequest(route.module, loaderContext))};`,
    ),
  ];
  const routeDefinitions = routes.flatMap((route, index) => [
    `const routeDefinition${index} = {};`,
    ...(toMiddlewares(route.middlewares).length > 0
      ? [
          `routeDefinition${index}.middlewares = [${toMiddlewareReferences(route.middlewares, middlewareImportNames).join(", ")}];`,
        ]
      : []),
    ...toMethods(route).map(
      (method) =>
        `routeDefinition${index}.${method} = routeModule${index}.${method};`,
    ),
  ]);
  const routeEntries = routes.map(
    (route, index) =>
      `createRoute(${JSON.stringify(route.path)}, routeDefinition${index})`,
  );

  return [
    ...imports,
    ``,
    ...routeDefinitions,
    ``,
    `const framework = createReactFrameworkServer();`,
    `const middlewares = [${toMiddlewareReferences(middlewares, middlewareImportNames).join(", ")}];`,
    `const routes = [${routeEntries.join(", ")}];`,
    `const app = createApp({ middlewares, routes, ...(framework ? { framework } : {}) });`,
    `export const fetch = app.fetch;`,
    `export default { fetch };`,
    ``,
  ].join("\n");
};

function toMethods(route) {
  return Array.isArray(route.methods) ? route.methods : [];
}

function toMiddlewares(value) {
  return Array.isArray(value)
    ? value.filter(
        (middleware) =>
          middleware &&
          typeof middleware === "object" &&
          typeof middleware.module === "string",
      )
    : [];
}

function collectServerFunctionModules(value) {
  const modules = new Set();
  if (!Array.isArray(value)) return [];
  for (const serverFunction of value) {
    if (
      serverFunction &&
      typeof serverFunction === "object" &&
      typeof serverFunction.module === "string"
    ) {
      modules.add(serverFunction.module);
    }
  }
  return [...modules];
}

function collectMiddlewareModules(globalMiddlewares, routes) {
  const byModule = new Map();
  for (const middleware of globalMiddlewares) {
    byModule.set(middleware.module, middleware);
  }
  for (const route of routes) {
    for (const middleware of toMiddlewares(route.middlewares)) {
      byModule.set(middleware.module, middleware);
    }
  }
  return [...byModule.values()];
}

function toMiddlewareReferences(value, importNames) {
  return toMiddlewares(value)
    .map((middleware) => importNames.get(middleware.module))
    .filter(Boolean);
}

function toLoaderRelativeRequest(specifier, loaderContext) {
  if (!isLocalModuleRequest(specifier)) return specifier;
  const rootContext = loaderContext.rootContext || process.cwd();
  const fromDir = path.dirname(loaderContext.resourcePath);
  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(rootContext, specifier);
  let relative = path.relative(fromDir, absolute).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function isLocalModuleRequest(specifier) {
  return (
    typeof specifier === "string" &&
    (specifier.startsWith(".") ||
      path.isAbsolute(specifier) ||
      (!specifier.startsWith("@") && specifier.includes("/")))
  );
}
