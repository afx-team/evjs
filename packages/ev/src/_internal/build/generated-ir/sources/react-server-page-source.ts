import type {
  BuildEntry,
  ReactServerPageEntryMetadata,
} from "@evjs/shared/manifest";

type ImportFile = (file: string) => string;

export function createReactServerPageEntrySource(
  metadata: ReactServerPageEntryMetadata,
  kind: BuildEntry["kind"],
  importFile: ImportFile,
): string {
  const component = importFile(metadata.component);
  const layers = metadata.layers ?? [];
  const facadeName = layers.length > 0 ? "PageWithRouteLayers" : "Component";

  return [
    `import * as pageModule from ${JSON.stringify(component)};`,
    ...layers.map(
      (layer, index) =>
        `import * as layerModule${index} from ${JSON.stringify(
          importFile(layer.module),
        )};`,
    ),
    ...(layers.length > 0 ? ['import { createElement } from "react";'] : []),
    ...(kind === "rsc-page"
      ? [
          'import { createRscPageFlightRenderer } from "@evjs/ev/_internal/client/rsc-page-context";',
        ]
      : []),
    "",
    'const Component = pageModule.default ?? Reflect.get(pageModule, "Page");',
    `if (!Component) throw new Error(${JSON.stringify(`[evjs] Page module "${metadata.component}" must export a default component or a named Page component.`)});`,
    ...layers.flatMap((layer, index) => [
      `const Layer${index} = layerModule${index}.default;`,
      `if (!Layer${index}) throw new Error(${JSON.stringify(`[evjs] Page ${layer.kind} module "${layer.module}" must export a default component.`)});`,
    ]),
    ...(layers.length > 0
      ? [
          "function PageWithRouteLayers(props) {",
          "  let child = createElement(Component, props);",
          ...layers.map(
            (_, index) =>
              `  child = createElement(Layer${layers.length - index - 1}, undefined, child);`,
          ),
          "  return child;",
          "}",
        ]
      : []),
    ...(kind === "rsc-page"
      ? [
          `export const renderFlight = createRscPageFlightRenderer(${facadeName});`,
        ]
      : []),
    ...(kind === "rsc-page"
      ? []
      : [
          'export { PageProvider } from "@evjs/ev/_internal/client/page-context";',
        ]),
    `export { ${facadeName} as default };`,
    `export * from ${JSON.stringify(component)};`,
  ]
    .filter(Boolean)
    .join("\n");
}
