import type {
  BuildEntry,
  PagesAppEntryMetadata,
  ReactComponentPageEntryMetadata,
} from "@evjs/shared/manifest";

type ImportFile = (file: string) => string;

export function createOriginalClientEntryFacadeSource(
  entry: BuildEntry,
  importFile: ImportFile,
  options: { autoStart?: boolean; bundleCoreJs?: boolean } = {},
): string {
  let source: string;
  if (entry.metadata?.type === "pages-app") {
    source = createPagesAppEntryMainSource(
      entry.metadata,
      importFile,
      options.autoStart,
    ).join("\n");
  } else if (entry.metadata?.type === "react-component-page") {
    source = createReactComponentPageEntryMainSource(
      entry.metadata,
      importFile,
    ).join("\n");
  } else {
    source = `import ${JSON.stringify(importFile(entry.import))};`;
  }
  return options.bundleCoreJs
    ? `import "@evjs/ev/_internal/client/polyfill";\n${source}`
    : source;
}

export function createPagesAppEntryMainSource(
  metadata: PagesAppEntryMetadata,
  importFile: ImportFile,
  autoStart = true,
): string[] {
  const imports = [
    `import { createPagesApp, startPagesApp } from "@evjs/ev/_internal/client";`,
    metadata.rootModule
      ? `import * as rootModule from ${JSON.stringify(
          importFile(metadata.rootModule),
        )};`
      : "",
    ...metadata.routes.flatMap((route, index) =>
      route.module
        ? [
            `import * as routeModule${index} from ${JSON.stringify(
              importFile(route.module),
            )};`,
          ]
        : [],
    ),
    ...metadata.routes.flatMap((route, routeIndex) =>
      (route.wrappers ?? []).map(
        (wrapper, wrapperIndex) =>
          `import * as routeWrapperModule${routeIndex}_${wrapperIndex} from ${JSON.stringify(
            importFile(wrapper),
          )};`,
      ),
    ),
    ...metadata.routes.flatMap((route, index) => [
      route.errorModule
        ? `import * as routeErrorModule${index} from ${JSON.stringify(
            importFile(route.errorModule),
          )};`
        : "",
      route.notFoundModule
        ? `import * as routeNotFoundModule${index} from ${JSON.stringify(
            importFile(route.notFoundModule),
          )};`
        : "",
    ]),
  ].filter(Boolean);

  const routeDefinitions = metadata.routes.map((route, index) => {
    let routeKind:
      | PagesAppEntryMetadata["routes"][number]["kind"]
      | "group"
      | "redirect" = route.kind;
    if (!routeKind && route.target?.kind === "group") {
      routeKind = "group";
    } else if (!routeKind && route.target?.kind === "redirect") {
      routeKind = "redirect";
    }

    const properties = [
      route.id ? `id: ${JSON.stringify(route.id)}` : "",
      `path: ${JSON.stringify(route.path)}`,
      route.parentId ? `parentId: ${JSON.stringify(route.parentId)}` : "",
      routeKind ? `kind: ${JSON.stringify(routeKind)}` : "",
      route.module
        ? `module: ${createRouteModuleExpression(route, index)}`
        : "",
      route.target?.kind === "redirect"
        ? `redirect: ${JSON.stringify(route.target.to)}`
        : "",
      route.wrappers && route.wrappers.length > 0
        ? `wrappers: [${route.wrappers
            .map(
              (_, wrapperIndex) => `routeWrapperModule${index}_${wrapperIndex}`,
            )
            .join(", ")}]`
        : "",
      route.layout === false ? "layout: false" : "",
      route.metadata ? `metadata: ${JSON.stringify(route.metadata)}` : "",
    ].filter(Boolean);
    return `{ ${properties.join(", ")} }`;
  });

  return [
    ...imports,
    "",
    "export const pagesApp = createPagesApp({",
    metadata.rootModule ? "  rootModule," : "",
    `  routes: [${routeDefinitions.join(", ")}],`,
    "});",
    "const { app } = pagesApp;",
    autoStart
      ? `startPagesApp(app, ${JSON.stringify(metadata.mount)});`
      : `export const start = (container: string | HTMLElement = ${JSON.stringify(metadata.mount)}) => startPagesApp(app, container);`,
    "export { app };",
    "export default app;",
  ].filter(Boolean);
}

export function createReactComponentPageEntryMainSource(
  metadata: ReactComponentPageEntryMetadata,
  importFile: ImportFile,
): string[] {
  const component = importFile(metadata.component);
  const layers = metadata.layers ?? [];
  const entryOptions = {
    mount: metadata.mount,
    hydrate: metadata.hydrate,
    render: metadata.render,
    ...(metadata.route ? { route: metadata.route } : {}),
  };

  return [
    `import * as pageModule from ${JSON.stringify(component)};`,
    ...layers.map(
      (layer, index) =>
        `import * as layerModule${index} from ${JSON.stringify(
          importFile(layer.module),
        )};`,
    ),
    ...(layers.length > 0 ? [`import { createElement } from "react";`] : []),
    `import { createGeneratedReactPageEntry } from "@evjs/ev/_internal/client/react-page";`,
    "",
    'const Component = pageModule.default ?? Reflect.get(pageModule, "Page");',
    `if (!Component) throw new Error(${JSON.stringify(`[evjs] Page module "${metadata.component}" must export a default component or a named Page component.`)});`,
    ...layers.flatMap((layer, index) => [
      `const Layer${index} = layerModule${index}.default;`,
      `if (!Layer${index}) throw new Error(${JSON.stringify(`[evjs] Page ${layer.kind} module "${layer.module}" must export a default component.`)});`,
    ]),
    ...(layers.length > 0
      ? [
          "function PageWithLayers() {",
          "  let child = createElement(Component);",
          ...layers.map(
            (_, index) =>
              `  child = createElement(Layer${layers.length - index - 1}, undefined, child);`,
          ),
          "  return child;",
          "}",
        ]
      : []),
    `const mod = createGeneratedReactPageEntry(${layers.length > 0 ? "PageWithLayers" : "Component"}, ${JSON.stringify(entryOptions)}, import.meta.url);`,
    "export default mod;",
  ];
}

function createRouteModuleExpression(
  route: PagesAppEntryMetadata["routes"][number],
  index: number,
): string {
  if (!route.module) {
    throw new Error(
      `[evjs] Generated Application Route "${route.id}" has no module.`,
    );
  }

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
  if (properties.length === 0) {
    return `routeModule${index}`;
  }
  return `{ ${properties.join(", ")}, ...routeModule${index} }`;
}
