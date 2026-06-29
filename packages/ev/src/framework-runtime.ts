import type { BuildOutput } from "@evjs/shared/manifest";

export type ClientRuntimeOutput = Pick<BuildOutput, "version" | "buildId"> & {
  runtime: ClientRuntimeOutputRuntime;
  app?: ClientRuntimeTargetOutput;
  pages: Record<string, ClientRuntimeTargetOutput>;
  routes: ClientRuntimeRouteOutput[];
};

export interface ClientRuntimeOutputRuntime {
  server?: {
    rsc?: string;
  };
  transport?: BuildOutput["runtime"]["transport"];
}

export type ClientRuntimeTargetOutput = Pick<
  BuildOutput["apps"][string],
  "mount"
> & {
  module?: BuildOutput["apps"][string]["module"];
};

export type ClientRuntimeRouteOutput = Pick<
  BuildOutput["routes"][number],
  "id" | "path" | "pageId"
>;

export interface FrameworkRuntimeOutput {
  version: 1;
  buildId: string;
  publicPath: string;
  runtime: BuildOutput["runtime"];
  pages: Record<string, FrameworkRuntimePage>;
  routes: FrameworkRuntimeRoute[];
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
  | "mount"
> & {
  ppr?: FrameworkRuntimePprPage;
};

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
    pages: Object.fromEntries(
      Object.entries(output.pages).map(([id, page]) => [
        id,
        pruneUndefined({
          mount: page.mount,
          module: page.module,
        }),
      ]),
    ),
    routes: output.routes.map((route) =>
      pruneUndefined({
        id: route.id,
        path: route.path,
        pageId: route.pageId,
      }),
    ),
  });
}

function createClientRuntimeApp(
  output: BuildOutput,
): ClientRuntimeTargetOutput | undefined {
  const app = output.apps.default ?? Object.values(output.apps)[0];
  if (!app) return undefined;
  return pruneUndefined({
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
  return pruneUndefined({
    version: 1 as const,
    buildId: output.buildId,
    publicPath: output.publicPath,
    runtime: output.runtime,
    pages: Object.fromEntries(
      Object.entries(output.pages).map(([id, page]) => [
        id,
        pruneUndefined({
          assets: page.assets,
          render: page.render,
          rendering: page.rendering,
          path: page.path,
          routeId: page.routeId,
          componentModel: page.componentModel,
          mount: page.mount,
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
        }),
      ]),
    ),
    routes: output.routes.map((route) =>
      pruneUndefined({
        id: route.id,
        path: route.path,
        pageId: route.pageId,
      }),
    ),
    server: pruneUndefined({
      renderers: output.server.renderers
        ? Object.fromEntries(
            Object.entries(output.server.renderers).map(([id, renderer]) => [
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
