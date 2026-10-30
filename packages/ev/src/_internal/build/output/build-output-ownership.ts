import { isDeepStrictEqual } from "node:util";
import type { BuildOutput } from "@evjs/shared/manifest";

const ASSET_GROUP_CONTENTS_SNAPSHOT = true as const;

interface BuildOutputDocumentIdentity {
  owner: string;
  fileName?: string;
  aliases?: string[];
}

interface BuildOutputPageIdentity extends BuildOutputDocumentIdentity {
  path?: string;
  routeId?: string;
}

interface BuildOutputRouteIdentity {
  id: string;
  path: string;
  parentId?: string;
  kind?: BuildOutput["routes"][number]["kind"];
  appId?: string;
  pageId?: string;
}

interface BuildOutputIdentitySnapshot {
  appIds: string[];
  pageIds: string[];
  documents: Map<string, BuildOutputDocumentIdentity>;
  pages: Map<string, BuildOutputPageIdentity>;
  routes: BuildOutputRouteIdentity[];
}

type BuildOutputRecordSnapshot<TValue> = Array<
  readonly [key: string, value: TValue]
>;
type AssetGroupSemanticSnapshot = Omit<
  BuildOutput["assets"][string],
  "js" | "css"
> & {
  js: typeof ASSET_GROUP_CONTENTS_SNAPSHOT;
  css: typeof ASSET_GROUP_CONTENTS_SNAPSHOT;
};
type BuildOutputAppSemanticSnapshot = Omit<
  BuildOutput["apps"][string],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputPprRegionSemanticSnapshot = Omit<
  NonNullable<BuildOutput["pages"][string]["ppr"]>["regions"][string],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputPprSemanticSnapshot = Omit<
  NonNullable<BuildOutput["pages"][string]["ppr"]>,
  "shell" | "regions"
> & {
  shell: AssetGroupSemanticSnapshot;
  regions: BuildOutputRecordSnapshot<BuildOutputPprRegionSemanticSnapshot>;
};
type BuildOutputPageSemanticSnapshot = Omit<
  BuildOutput["pages"][string],
  "assets" | "ppr"
> & {
  assets: AssetGroupSemanticSnapshot;
  ppr?: BuildOutputPprSemanticSnapshot;
};
type BuildOutputServerRendererSemanticSnapshot = Omit<
  NonNullable<BuildOutput["server"]["renderers"]>[string],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputServerFunctionSemanticSnapshot = Omit<
  BuildOutput["server"]["functions"][string],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputServerRouteSemanticSnapshot = Omit<
  BuildOutput["server"]["routes"][number],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputServerSemanticSnapshot = Omit<
  BuildOutput["server"],
  "assets" | "renderers" | "functions" | "routes"
> & {
  assets: AssetGroupSemanticSnapshot;
  renderers?: BuildOutputRecordSnapshot<BuildOutputServerRendererSemanticSnapshot>;
  functions: BuildOutputRecordSnapshot<BuildOutputServerFunctionSemanticSnapshot>;
  routes: BuildOutputServerRouteSemanticSnapshot[];
};
type BuildOutputRscPageSemanticSnapshot = Omit<
  NonNullable<NonNullable<BuildOutput["rsc"]>["pages"]>[string],
  "assets"
> & {
  assets: AssetGroupSemanticSnapshot;
};
type BuildOutputRscSemanticSnapshot = Omit<
  NonNullable<BuildOutput["rsc"]>,
  "pages"
> & {
  pages?: BuildOutputRecordSnapshot<BuildOutputRscPageSemanticSnapshot>;
};
type BuildOutputSemanticSnapshot = Omit<
  BuildOutput,
  "assets" | "apps" | "pages" | "server" | "rsc" | "deployment"
> & {
  assets: BuildOutputRecordSnapshot<AssetGroupSemanticSnapshot>;
  apps: BuildOutputRecordSnapshot<BuildOutputAppSemanticSnapshot>;
  pages: BuildOutputRecordSnapshot<BuildOutputPageSemanticSnapshot>;
  server: BuildOutputServerSemanticSnapshot;
  rsc?: BuildOutputRscSemanticSnapshot;
};

export interface BuildOutputOwnershipSnapshot {
  identities: BuildOutputIdentitySnapshot;
  semantics: BuildOutputSemanticSnapshot;
}

export function snapshotBuildOutputOwnership(
  output: BuildOutput,
): BuildOutputOwnershipSnapshot {
  return {
    identities: snapshotBuildOutputIdentities(output),
    semantics: snapshotBuildOutputSemantics(output),
  };
}

export function assertBuildOutputOwnershipUnchanged(
  expected: BuildOutputOwnershipSnapshot,
  output: BuildOutput,
): void {
  assertBuildOutputIdentitiesUnchanged(expected.identities, output);
  assertBuildOutputSemanticsUnchanged(expected.semantics, output);
}

function snapshotBuildOutputIdentities(
  output: BuildOutput,
): BuildOutputIdentitySnapshot {
  const documents = new Map<string, BuildOutputDocumentIdentity>();
  const pages = new Map<string, BuildOutputPageIdentity>();
  for (const [id, app] of Object.entries(output.apps)) {
    documents.set(`app:${id}`, {
      owner: `Application "${id}"`,
      ...(app.document ? { fileName: app.document.fileName } : {}),
      ...(app.document?.aliases ? { aliases: [...app.document.aliases] } : {}),
    });
  }
  for (const [id, page] of Object.entries(output.pages)) {
    const identity = {
      owner: `Page "${id}"`,
      ...(page.document ? { fileName: page.document.fileName } : {}),
      ...(page.document?.aliases
        ? { aliases: [...page.document.aliases] }
        : {}),
      ...(page.path ? { path: page.path } : {}),
      ...(page.routeId ? { routeId: page.routeId } : {}),
    };
    documents.set(`page:${id}`, identity);
    pages.set(id, identity);
  }
  return {
    appIds: Object.keys(output.apps).sort(),
    pageIds: Object.keys(output.pages).sort(),
    documents,
    pages,
    routes: output.routes.map((route) => ({
      id: route.id,
      path: route.path,
      ...(route.parentId ? { parentId: route.parentId } : {}),
      ...(route.kind ? { kind: route.kind } : {}),
      ...(route.appId ? { appId: route.appId } : {}),
      ...(route.pageId ? { pageId: route.pageId } : {}),
    })),
  };
}

function snapshotBuildOutputSemantics(
  output: BuildOutput,
): BuildOutputSemanticSnapshot {
  const snapshot: BuildOutputSemanticSnapshot = {
    ...omitOwnFields(output, [
      "assets",
      "apps",
      "pages",
      "server",
      "rsc",
      "deployment",
    ] as const),
    assets: snapshotBuildOutputRecord(output.assets, snapshotAssetGroup),
    apps: snapshotBuildOutputRecord(output.apps, snapshotBuildOutputApp),
    pages: snapshotBuildOutputRecord(output.pages, snapshotBuildOutputPage),
    server: snapshotBuildOutputServer(output.server),
    ...(Object.hasOwn(output, "rsc")
      ? {
          rsc: output.rsc ? snapshotBuildOutputRsc(output.rsc) : undefined,
        }
      : {}),
  };
  return structuredClone(snapshot);
}

function snapshotBuildOutputApp(
  app: BuildOutput["apps"][string],
): BuildOutputAppSemanticSnapshot {
  return {
    ...omitOwnFields(app, ["assets"] as const),
    assets: snapshotAssetGroup(app.assets),
  };
}

function snapshotBuildOutputPage(
  page: BuildOutput["pages"][string],
): BuildOutputPageSemanticSnapshot {
  return {
    ...omitOwnFields(page, ["assets", "ppr"] as const),
    assets: snapshotAssetGroup(page.assets),
    ...(Object.hasOwn(page, "ppr")
      ? {
          ppr: page.ppr ? snapshotBuildOutputPpr(page.ppr) : undefined,
        }
      : {}),
  };
}

function snapshotBuildOutputPpr(
  ppr: NonNullable<BuildOutput["pages"][string]["ppr"]>,
): BuildOutputPprSemanticSnapshot {
  return {
    ...omitOwnFields(ppr, ["shell", "regions"] as const),
    shell: snapshotAssetGroup(ppr.shell),
    regions: snapshotBuildOutputRecord(
      ppr.regions,
      snapshotBuildOutputPprRegion,
    ),
  };
}

function snapshotBuildOutputPprRegion(
  region: NonNullable<BuildOutput["pages"][string]["ppr"]>["regions"][string],
): BuildOutputPprRegionSemanticSnapshot {
  return {
    ...omitOwnFields(region, ["assets"] as const),
    assets: snapshotAssetGroup(region.assets),
  };
}

function snapshotBuildOutputServer(
  server: BuildOutput["server"],
): BuildOutputServerSemanticSnapshot {
  return {
    ...omitOwnFields(server, [
      "assets",
      "renderers",
      "functions",
      "routes",
    ] as const),
    assets: snapshotAssetGroup(server.assets),
    ...(Object.hasOwn(server, "renderers")
      ? {
          renderers: server.renderers
            ? snapshotBuildOutputRecord(
                server.renderers,
                snapshotBuildOutputServerRenderer,
              )
            : undefined,
        }
      : {}),
    functions: snapshotBuildOutputRecord(
      server.functions,
      snapshotBuildOutputServerFunction,
    ),
    routes: server.routes.map(snapshotBuildOutputServerRoute),
  };
}

function snapshotBuildOutputServerRenderer(
  renderer: NonNullable<BuildOutput["server"]["renderers"]>[string],
): BuildOutputServerRendererSemanticSnapshot {
  return {
    ...omitOwnFields(renderer, ["assets"] as const),
    assets: snapshotAssetGroup(renderer.assets),
  };
}

function snapshotBuildOutputServerFunction(
  serverFunction: BuildOutput["server"]["functions"][string],
): BuildOutputServerFunctionSemanticSnapshot {
  return {
    ...omitOwnFields(serverFunction, ["assets"] as const),
    assets: snapshotAssetGroup(serverFunction.assets),
  };
}

function snapshotBuildOutputServerRoute(
  route: BuildOutput["server"]["routes"][number],
): BuildOutputServerRouteSemanticSnapshot {
  return {
    ...omitOwnFields(route, ["assets"] as const),
    assets: snapshotAssetGroup(route.assets),
  };
}

function snapshotBuildOutputRsc(
  rsc: NonNullable<BuildOutput["rsc"]>,
): BuildOutputRscSemanticSnapshot {
  return {
    ...omitOwnFields(rsc, ["pages"] as const),
    ...(Object.hasOwn(rsc, "pages")
      ? {
          pages: rsc.pages
            ? snapshotBuildOutputRecord(rsc.pages, snapshotBuildOutputRscPage)
            : undefined,
        }
      : {}),
  };
}

function snapshotBuildOutputRscPage(
  page: NonNullable<NonNullable<BuildOutput["rsc"]>["pages"]>[string],
): BuildOutputRscPageSemanticSnapshot {
  return {
    ...omitOwnFields(page, ["assets"] as const),
    assets: snapshotAssetGroup(page.assets),
  };
}

function snapshotAssetGroup(
  assets: BuildOutput["assets"][string],
): AssetGroupSemanticSnapshot {
  return {
    ...omitOwnFields(assets, ["js", "css"] as const),
    js: ASSET_GROUP_CONTENTS_SNAPSHOT,
    css: ASSET_GROUP_CONTENTS_SNAPSHOT,
  };
}

function snapshotBuildOutputRecord<TValue, TSnapshot>(
  record: Readonly<Record<string, TValue>>,
  snapshotValue: (value: TValue) => TSnapshot,
): BuildOutputRecordSnapshot<TSnapshot> {
  return Object.entries(record).map(
    ([key, value]) => [key, snapshotValue(value)] as const,
  );
}

function omitOwnFields<
  TValue extends object,
  const TKeys extends readonly (keyof TValue)[],
>(value: TValue, keys: TKeys): Omit<TValue, TKeys[number]> {
  const result = { ...value };
  for (const key of keys) Reflect.deleteProperty(result, key);
  return result;
}

function assertBuildOutputIdentitiesUnchanged(
  expected: BuildOutputIdentitySnapshot,
  output: BuildOutput,
): void {
  const actual = snapshotBuildOutputIdentities(output);
  if (!arraysEqual(expected.appIds, actual.appIds)) {
    throw new Error(
      "[evjs] transformOutput hooks cannot add, remove, or rename Applications. Application identity is owned by the CoreGraph.",
    );
  }
  if (!arraysEqual(expected.pageIds, actual.pageIds)) {
    throw new Error(
      "[evjs] transformOutput hooks cannot add, remove, or rename Pages. Page identity is owned by the CoreGraph.",
    );
  }
  if (!routeIdentitiesEqual(expected.routes, actual.routes)) {
    throw new Error(
      "[evjs] transformOutput hooks cannot add, remove, reorder, or rename Routes, or change Route paths and ownership. Route identity is owned by the CoreGraph.",
    );
  }
  for (const [id, identity] of expected.pages) {
    const candidate = actual.pages.get(id);
    if (
      candidate?.path !== identity.path ||
      candidate?.routeId !== identity.routeId
    ) {
      throw new Error(
        `[evjs] transformOutput hooks cannot change Page "${id}" path or routeId. Page and Route identity is owned by the CoreGraph.`,
      );
    }
  }
  for (const [key, identity] of expected.documents) {
    const candidate = actual.documents.get(key);
    if (
      candidate !== undefined &&
      candidate.fileName === identity.fileName &&
      optionalArraysEqual(candidate.aliases, identity.aliases)
    ) {
      continue;
    }
    throw new Error(
      `[evjs] transformOutput hooks cannot change ${identity.owner} Document fileName or aliases. Configure static Document identity in framework configuration before the CoreGraph is linked.`,
    );
  }
  for (const [key, identity] of actual.documents) {
    if (expected.documents.has(key) || identity.fileName === undefined)
      continue;
    throw new Error(
      `[evjs] transformOutput hooks cannot add a Document to ${identity.owner}. Configure static Document identity in framework configuration before the CoreGraph is linked.`,
    );
  }
}

function assertBuildOutputSemanticsUnchanged(
  expected: BuildOutputSemanticSnapshot,
  output: BuildOutput,
): void {
  const actual = snapshotBuildOutputSemantics(output);
  if (
    isDeepStrictEqual(
      snapshotOrderedValue(expected),
      snapshotOrderedValue(actual),
    )
  ) {
    return;
  }
  throw new Error(
    "[evjs] transformOutput hooks cannot change non-asset BuildOutput fields. Hooks may only adjust existing AssetGroup contents or deployment metadata.",
  );
}

function snapshotOrderedValue(value: unknown): unknown {
  // Plain-object key order is observable in fields such as Page metadata, but
  // isDeepStrictEqual otherwise treats that order as insignificant.
  if (Array.isArray(value)) {
    return ["array", value.map(snapshotOrderedValue)] as const;
  }
  if (value && typeof value === "object") {
    return [
      "object",
      Object.entries(value).map(
        ([key, item]) => [key, snapshotOrderedValue(item)] as const,
      ),
    ] as const;
  }
  return value;
}

function optionalArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || !right) return left === right;
  return arraysEqual(left, right);
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function routeIdentitiesEqual(
  left: readonly BuildOutputRouteIdentity[],
  right: readonly BuildOutputRouteIdentity[],
): boolean {
  return (
    left.length === right.length &&
    left.every((route, index) => {
      const candidate = right[index];
      return (
        candidate?.id === route.id &&
        candidate.path === route.path &&
        candidate.parentId === route.parentId &&
        candidate.kind === route.kind &&
        candidate.appId === route.appId &&
        candidate.pageId === route.pageId
      );
    })
  );
}
