import type { AssetGroup, BuildOutput } from "../contracts.js";
import {
  assertPortableRelativeArtifactPath,
  canonicalPortableArtifactPathKey,
} from "./artifact-path.js";

export interface ServerArtifactGroupReference {
  assets: AssetGroup;
  source: string;
}

interface ServerArtifactOwner {
  path: string;
  source: string;
}

interface ServerArtifactPartitions {
  runtime: ServerArtifactGroupReference[];
  build: ServerArtifactGroupReference[];
}

/** Validate one path that will be resolved relative to BuildOutput.paths.serverDir. */
export function assertServerRelativeArtifactPath(
  value: unknown,
  source: string,
): string {
  return assertPortableRelativeArtifactPath(
    value,
    source,
    "server-relative artifact path",
  );
}

/**
 * Validate physical server artifact groups as one output namespace. Reusing
 * the exact same file across owners is supported; alternate case or Unicode
 * spellings are rejected because they alias on common file systems.
 */
export function assertServerArtifactGroups(
  groups: readonly ServerArtifactGroupReference[],
): void {
  const owners = new Map<string, ServerArtifactOwner>();
  const descendantOwners = new Map<string, ServerArtifactOwner>();
  for (const { assets, source } of groups) {
    assertServerArtifactGroupShape(assets, source);
    assertServerArtifactList(
      assets.js,
      `${source}.js`,
      owners,
      descendantOwners,
    );
    assertServerArtifactList(
      assets.css,
      `${source}.css`,
      owners,
      descendantOwners,
    );
  }
}

/**
 * Validate every BuildOutput field whose assets are loaded from serverDir and
 * enforce canonical SSG materialization and request-time runtime contracts.
 */
export function assertBuildOutputServerArtifacts(
  output: BuildOutput,
  source: string,
): void {
  validateBuildOutputServerArtifacts(output, source);
}

/** Return the exact JavaScript allowlist accepted by server module loaders. */
export function collectBuildOutputServerJavaScriptArtifacts(
  output: BuildOutput,
  source: string,
): string[] {
  const groups = validateBuildOutputServerArtifacts(output, source);
  const paths = groups.flatMap(({ assets }) => assets.js);
  return [...new Set(paths)];
}

function validateBuildOutputServerArtifacts(
  output: BuildOutput,
  source: string,
): ServerArtifactGroupReference[] {
  const groups = collectBuildOutputServerArtifactGroups(output, source);
  assertServerArtifactGroups(groups.runtime);
  assertServerArtifactGroups(groups.build);
  assertRoutedSsgDocuments(output, source);

  const entry = output.server.entry;
  if (entry === undefined) {
    const requirement = getServerRuntimeRequirement(output);
    if (requirement) {
      throw new Error(
        `[evjs] ${source}.server.entry is required because ${requirement}. A request-time server runtime must declare exactly one self-contained ${source}.server.assets.js artifact.`,
      );
    }
    return groups.runtime;
  }

  assertServerRelativeArtifactPath(entry, `${source}.server.entry`);
  if (output.server.assets.js.length !== 1) {
    throw new Error(
      `[evjs] ${source}.server.assets.js must declare exactly one self-contained JavaScript artifact when ${source}.server.entry is present; found ${output.server.assets.js.length}.`,
    );
  }
  if (output.server.assets.js[0] !== entry) {
    throw new Error(
      `[evjs] ${source}.server.entry "${entry}" must exactly match one ${source}.server.assets.js artifact.`,
    );
  }
  return groups.runtime;
}

function getServerRuntimeRequirement(output: BuildOutput): string | undefined {
  if (
    output.server.assets.js.length > 0 ||
    output.server.assets.css.length > 0
  ) {
    return "server runtime assets are present";
  }
  if (Object.keys(output.server.functions).length > 0) {
    return "server Functions are present";
  }
  if (output.server.routes.length > 0) {
    return "server request Routes are present";
  }
  if (Object.values(output.pages).some((page) => page.ppr !== undefined)) {
    return "a PPR Page is present";
  }
  if (Object.keys(output.rsc?.pages ?? {}).length > 0) {
    return "an RSC Page is present";
  }
  if (Object.values(output.pages).some((page) => page.render === "ssr")) {
    return "an SSR Page is present";
  }
  if (
    Object.values(output.server.renderers ?? {}).some(
      (renderer) => renderer.phase !== "build",
    )
  ) {
    return "a request-time server renderer is present";
  }
  return undefined;
}

function assertRoutedSsgDocuments(output: BuildOutput, source: string): void {
  output.routes.forEach((route, index) => {
    if (!route.pageId) return;
    const page = output.pages[route.pageId];
    if (page?.render !== "ssg" || page.document) return;
    throw new Error(
      `[evjs] ${source}.pages.${route.pageId}.document is required because ${source}.routes[${index}] publishes SSG Page "${route.pageId}".`,
    );
  });
}

function collectBuildOutputServerArtifactGroups(
  output: BuildOutput,
  source: string,
): ServerArtifactPartitions {
  const runtime: ServerArtifactGroupReference[] = [
    {
      assets: output.server.assets,
      source: `${source}.server.assets`,
    },
  ];

  for (const [pageId, page] of Object.entries(output.pages)) {
    if (!page.ppr) continue;
    runtime.push({
      assets: page.ppr.shell,
      source: `${source}.pages.${pageId}.ppr.shell`,
    });
    for (const [regionId, region] of Object.entries(page.ppr.regions)) {
      runtime.push({
        assets: region.assets,
        source: `${source}.pages.${pageId}.ppr.regions.${regionId}.assets`,
      });
    }
  }

  const build: ServerArtifactGroupReference[] = [];
  for (const [rendererId, renderer] of Object.entries(
    output.server.renderers ?? {},
  )) {
    const partition = renderer.phase === "build" ? build : runtime;
    partition.push({
      assets: renderer.assets,
      source: `${source}.server.renderers.${rendererId}.assets`,
    });
  }
  for (const [functionId, serverFunction] of Object.entries(
    output.server.functions,
  )) {
    runtime.push({
      assets: serverFunction.assets,
      source: `${source}.server.functions.${functionId}.assets`,
    });
  }
  output.server.routes.forEach((route, index) => {
    runtime.push({
      assets: route.assets,
      source: `${source}.server.routes[${index}].assets`,
    });
  });
  for (const [pageId, page] of Object.entries(output.rsc?.pages ?? {})) {
    runtime.push({
      assets: page.assets,
      source: `${source}.rsc.pages.${pageId}.assets`,
    });
  }
  return { runtime, build };
}

function assertServerArtifactGroupShape(
  assets: AssetGroup,
  source: string,
): void {
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
  if (!Array.isArray(assets.js)) {
    throw new Error(`[evjs] ${source}.js must be an array.`);
  }
  if (!Array.isArray(assets.css)) {
    throw new Error(`[evjs] ${source}.css must be an array.`);
  }
}

function assertServerArtifactList(
  paths: readonly unknown[],
  source: string,
  owners: Map<string, ServerArtifactOwner>,
  descendantOwners: Map<string, ServerArtifactOwner>,
): void {
  paths.forEach((value, index) => {
    const itemSource = `${source}[${index}]`;
    const artifactPath = assertServerRelativeArtifactPath(value, itemSource);
    const key = canonicalPortableArtifactPathKey(artifactPath);
    const owner = { path: artifactPath, source: itemSource };
    const existing =
      owners.get(key) ??
      findAncestorOwner(key, owners) ??
      descendantOwners.get(key);
    if (existing && existing.path !== artifactPath) {
      throw new Error(
        `[evjs] ${itemSource} "${artifactPath}" conflicts with ${existing.source} "${existing.path}" on portable file systems. Server artifacts must use one case- and Unicode-stable spelling, and one file cannot be an ancestor of another.`,
      );
    }
    if (existing) return;
    owners.set(key, owner);
    registerDescendantOwner(key, owner, descendantOwners);
  });
}

function findAncestorOwner(
  key: string,
  owners: Map<string, ServerArtifactOwner>,
): ServerArtifactOwner | undefined {
  const segments = key.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const owner = owners.get(segments.slice(0, index).join("/"));
    if (owner) return owner;
  }
  return undefined;
}

function registerDescendantOwner(
  key: string,
  owner: ServerArtifactOwner,
  descendantOwners: Map<string, ServerArtifactOwner>,
): void {
  const segments = key.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    if (!descendantOwners.has(ancestor)) {
      descendantOwners.set(ancestor, owner);
    }
  }
}
