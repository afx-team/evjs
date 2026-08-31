import type { BuildOutput, ServerDocumentShell } from "@evjs/shared/manifest";

export type ClientRuntimeOutput = Pick<BuildOutput, "version" | "buildId"> & {
  runtime: ClientRuntimeOutputRuntime;
  app?: ClientRuntimeTargetOutput;
  routing: ClientRuntimeRoutingOutput;
};

export interface ClientRuntimeOutputRuntime {
  server?: {
    rsc?: string;
  };
  transport?: BuildOutput["runtime"]["transport"];
}

export type ClientRuntimeTargetOutput = Pick<
  BuildOutput["apps"][string],
  "basepath" | "mount"
> & {
  module?: BuildOutput["apps"][string]["module"];
};

export type ClientRuntimePageOutput = ClientRuntimeTargetOutput &
  Pick<BuildOutput["pages"][string], "path" | "routeId">;

export type ClientRuntimeRouteOutput = Pick<
  BuildOutput["routes"][number],
  "id" | "path" | "pageId"
>;

export type ClientRuntimeRoutingOutput =
  | {
      kind: "spa";
      routes: ClientRuntimeRouteOutput[];
    }
  | {
      kind: "mpa";
      pages: Record<string, ClientRuntimePageOutput>;
    };

export interface FrameworkRuntimeOutput {
  version: 1;
  buildId: string;
  publicPath: string;
  runtime: BuildOutput["runtime"];
  routing: FrameworkRuntimeRouting;
  server: {
    renderers?: Record<string, FrameworkRuntimeRenderer>;
  };
  rsc?: FrameworkRuntimeRsc;
}

export type FrameworkRuntimePage = Pick<
  BuildOutput["pages"][string],
  | "assets"
  | "render"
  | "rendering"
  | "path"
  | "routeId"
  | "componentModel"
  | "metadata"
  | "mount"
> & {
  document?: FrameworkRuntimeDocumentShell;
  ppr?: FrameworkRuntimePprPage;
};

export type FrameworkRuntimeDocumentShell = ServerDocumentShell;

export interface FrameworkRuntimePprPage {
  delivery: NonNullable<BuildOutput["pages"][string]["ppr"]>["delivery"];
  shell: NonNullable<BuildOutput["pages"][string]["ppr"]>["shell"];
  regions: Record<string, FrameworkRuntimePprRegion>;
}

export type FrameworkRuntimePprRegion = Pick<
  NonNullable<BuildOutput["pages"][string]["ppr"]>["regions"][string],
  "id" | "assets" | "cache"
>;

export type FrameworkRuntimeRoute = Pick<
  BuildOutput["routes"][number],
  "id" | "path" | "pageId"
>;

export type FrameworkRuntimeRouting =
  | {
      kind: "spa";
      pages: Record<string, FrameworkRuntimePage>;
      routes: FrameworkRuntimeRoute[];
    }
  | {
      kind: "mpa";
      pages: Record<string, FrameworkRuntimePage>;
    };

export interface FrameworkRuntimeRenderer {
  kind: NonNullable<BuildOutput["server"]["renderers"]>[string]["kind"];
  owner?: FrameworkRuntimeOwner;
  assets: NonNullable<BuildOutput["server"]["renderers"]>[string]["assets"];
}

export type FrameworkRuntimeOwner = Pick<
  NonNullable<NonNullable<BuildOutput["server"]["renderers"]>[string]["owner"]>,
  "pageId" | "routeId" | "regionId"
>;

export interface FrameworkRuntimeRsc {
  pages?: Record<string, FrameworkRuntimeRscPage>;
  clientReferenceManifest?: Record<string, unknown>;
}

export interface FrameworkRuntimeOptions {
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
  };
  /** Build-compiled request-time document shells, keyed by Page id. */
  documentShells?: Record<string, FrameworkRuntimeDocumentShell>;
  /** Include build-phase renderers for static prerendering only. */
  includeBuildRenderers?: boolean;
}

export type FrameworkRuntimeRscPage = Pick<
  NonNullable<NonNullable<BuildOutput["rsc"]>["pages"]>[string],
  "renderer" | "assets" | "routeId"
>;

export function createClientRuntime(output: BuildOutput): ClientRuntimeOutput {
  return pruneUndefined({
    version: output.version,
    buildId: output.buildId,
    runtime: createClientRuntimeRuntime(output.runtime),
    app: createClientRuntimeApp(output),
    routing: createClientRuntimeRouting(output),
  });
}

function createClientRuntimeRouting(
  output: BuildOutput,
): ClientRuntimeRoutingOutput {
  if (!hasSpaRoutes(output) && Object.keys(output.pages).length > 0) {
    return {
      kind: "mpa",
      pages: Object.fromEntries(
        Object.entries(output.pages).map(([id, page]) => [
          id,
          createClientRuntimePage(output, id, page),
        ]),
      ),
    };
  }

  return {
    kind: "spa",
    routes: output.routes.map((route) =>
      pruneUndefined({
        id: route.id,
        path: route.path,
        pageId: route.pageId,
      }),
    ),
  };
}

function createClientRuntimePage(
  output: BuildOutput,
  id: string,
  page: BuildOutput["pages"][string],
): ClientRuntimePageOutput {
  const route = findOutputRouteForPage(output, id);
  return pruneUndefined({
    mount: page.mount,
    module: page.module,
    path: page.path ?? route?.path,
    routeId: page.routeId ?? route?.id,
  });
}

function createClientRuntimeApp(
  output: BuildOutput,
): ClientRuntimeTargetOutput | undefined {
  const app = output.apps.default ?? Object.values(output.apps)[0];
  if (!app) return undefined;
  return pruneUndefined({
    basepath: app.basepath,
    mount: app.mount,
    module: app.module,
  });
}

function createClientRuntimeRuntime(
  runtime: BuildOutput["runtime"],
): ClientRuntimeOutputRuntime {
  return pruneUndefined({
    server: runtime.server.rsc
      ? {
          rsc: runtime.server.rsc,
        }
      : undefined,
    transport: runtime.transport,
  });
}

export function createFrameworkRuntime(
  output: BuildOutput,
  options: FrameworkRuntimeOptions = {},
): FrameworkRuntimeOutput {
  assertDocumentShellPageIds(output, options.documentShells);
  const routing = createFrameworkRuntimeRouting(output, options.documentShells);
  const renderers = output.server.renderers
    ? Object.entries(output.server.renderers).filter(
        ([, renderer]) =>
          options.includeBuildRenderers === true || renderer.phase !== "build",
      )
    : [];
  return pruneUndefined({
    version: 1 as const,
    buildId: output.buildId,
    publicPath: output.publicPath,
    runtime: output.runtime,
    routing,
    server: pruneUndefined({
      renderers:
        renderers.length > 0
          ? Object.fromEntries(
              renderers.map(([id, renderer]) => [
                id,
                pruneUndefined({
                  kind: renderer.kind,
                  owner: createFrameworkRuntimeOwner(renderer.owner),
                  assets: renderer.assets,
                }),
              ]),
            )
          : undefined,
    }),
    rsc: createFrameworkRuntimeRsc(output.rsc, options.rscManifests),
  });
}

/**
 * Serialize a runtime for generated JavaScript without interpreting JSON keys
 * such as `__proto__` as object-literal syntax.
 */
export function serializeFrameworkRuntimeExpression(
  runtime: FrameworkRuntimeOutput | undefined,
): string {
  const json = JSON.stringify(runtime);
  if (json === undefined) return "undefined";
  return `JSON.parse(${JSON.stringify(json)})`;
}

function createFrameworkRuntimePages(
  output: BuildOutput,
  documentShells: FrameworkRuntimeOptions["documentShells"],
): Record<string, FrameworkRuntimePage> {
  return Object.fromEntries(
    Object.entries(output.pages).map(([id, page]) => [
      id,
      createFrameworkRuntimePage(output, id, page, documentShells?.[id]),
    ]),
  );
}

function createFrameworkRuntimeRouting(
  output: BuildOutput,
  documentShells: FrameworkRuntimeOptions["documentShells"],
): FrameworkRuntimeRouting {
  if (hasSpaRoutes(output) || Object.keys(output.pages).length === 0) {
    return {
      kind: "spa",
      pages: createFrameworkRuntimePages(output, documentShells),
      routes: output.routes.map((route) =>
        pruneUndefined({
          id: route.id,
          path: route.path,
          pageId: route.pageId,
        }),
      ),
    };
  }

  return {
    kind: "mpa",
    pages: createFrameworkRuntimePages(output, documentShells),
  };
}

function hasSpaRoutes(output: BuildOutput): boolean {
  return output.routes.some((route) => route.appId);
}

function createFrameworkRuntimePage(
  output: BuildOutput,
  id: string,
  page: BuildOutput["pages"][string],
  document: FrameworkRuntimeDocumentShell | undefined,
): FrameworkRuntimePage {
  const route = findOutputRouteForPage(output, id);
  return pruneUndefined({
    assets: page.assets,
    render: page.render,
    rendering: page.rendering,
    path: page.path ?? route?.path,
    routeId: page.routeId ?? route?.id,
    componentModel: page.componentModel,
    metadata: page.metadata,
    mount: page.mount,
    document,
    ppr: page.ppr
      ? {
          delivery: page.ppr.delivery,
          shell: page.ppr.shell,
          regions: Object.fromEntries(
            Object.entries(page.ppr.regions).map(([regionId, region]) => [
              regionId,
              pruneUndefined({
                id: region.id,
                assets: region.assets,
                cache: region.cache,
              }),
            ]),
          ),
        }
      : undefined,
  });
}

function assertDocumentShellPageIds(
  output: BuildOutput,
  documentShells: FrameworkRuntimeOptions["documentShells"],
): void {
  for (const pageId of Object.keys(documentShells ?? {})) {
    if (!Object.hasOwn(output.pages, pageId)) {
      throw new Error(
        `[evjs] Runtime document shell references missing Page "${pageId}".`,
      );
    }
  }
}

function findOutputRouteForPage(
  output: BuildOutput,
  pageId: string,
): BuildOutput["routes"][number] | undefined {
  return output.routes.find((route) => route.pageId === pageId);
}

function createFrameworkRuntimeRsc(
  rsc: BuildOutput["rsc"],
  rscManifests: FrameworkRuntimeOptions["rscManifests"],
): FrameworkRuntimeRsc | undefined {
  if (!rsc) return undefined;
  const runtimeRsc = pruneUndefined({
    pages: rsc.pages
      ? Object.fromEntries(
          Object.entries(rsc.pages).map(([id, page]) => [
            id,
            pruneUndefined({
              renderer: page.renderer,
              assets: page.assets,
              routeId: page.routeId,
            }),
          ]),
        )
      : undefined,
    clientReferenceManifest: rscManifests?.clientReferenceManifest,
  });
  return Object.keys(runtimeRsc).length > 0 ? runtimeRsc : undefined;
}

function createFrameworkRuntimeOwner(
  owner: NonNullable<BuildOutput["server"]["renderers"]>[string]["owner"],
): FrameworkRuntimeOwner | undefined {
  if (!owner) return undefined;
  const runtimeOwner = pruneUndefined({
    pageId: owner.pageId,
    routeId: owner.routeId,
    regionId: owner.regionId,
  });
  return Object.keys(runtimeOwner).length > 0 ? runtimeOwner : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}
