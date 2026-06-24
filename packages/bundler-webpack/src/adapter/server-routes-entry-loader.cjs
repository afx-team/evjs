const path = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = function serverRoutesEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  const loaderContext = {
    rootContext: this.rootContext,
  };
  const routes = Array.isArray(options.routes) ? options.routes : [];
  const imports = [
    `import { createApp, createRoute } from "@evjs/server";`,
    `import { createReactFrameworkServer } from "@evjs/server/react";`,
    ...routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(toLoaderModuleRequest(route.module, loaderContext))};`,
    ),
  ];
  const routeDefinitions = routes.flatMap((route, index) => [
    `const routeDefinition${index} = {};`,
    ...(route.hasMiddlewares
      ? [
          `routeDefinition${index}.middlewares = routeModule${index}.middlewares;`,
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
    `const routes = [${routeEntries.join(", ")}];`,
    `const app = createApp({ routes, ...(framework ? { framework } : {}) });`,
    `export const fetch = app.fetch;`,
    `export default { fetch };`,
    ``,
  ].join("\n");
};

function toMethods(route) {
  return Array.isArray(route.methods) ? route.methods : [];
}

function toLoaderModuleRequest(specifier, loaderContext) {
  if (!isLocalModuleRequest(specifier)) return specifier;

  const rootContext = loaderContext.rootContext || process.cwd();
  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(rootContext, specifier);
  return pathToFileURL(absolute).href.replace(/!/g, "%21");
}

function isLocalModuleRequest(specifier) {
  return (
    typeof specifier === "string" &&
    (specifier.startsWith(".") ||
      path.isAbsolute(specifier) ||
      (!specifier.startsWith("@") && specifier.includes("/")))
  );
}
