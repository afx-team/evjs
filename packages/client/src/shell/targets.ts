import type { BuildOutput, RemoteManifest } from "@evjs/shared/manifest";
import {
  findRemoteIdForPath,
  getRequestPathname,
  resolveRemoteEntryId,
  resolveRemoteHref,
} from "./routing.js";
import { negotiateRemoteSharedDependencies } from "./shared.js";
import type {
  ActivationRequest,
  RemoteSharedResolution,
  ResolvedShellTarget,
  SharedScope,
  ShellOptions,
} from "./types.js";

export async function resolveTarget(
  manifest: BuildOutput,
  request: ActivationRequest,
  loadRemoteManifest: ShellOptions["loadRemoteManifest"],
  remoteManifestCache: Map<string, Promise<RemoteManifest>>,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
): Promise<ResolvedShellTarget> {
  if (request.pageId) {
    const page = manifest.pages[request.pageId];
    if (!page) {
      throw new Error(
        `[evjs] Page "${request.pageId}" is not in the manifest.`,
      );
    }
    const href = page.module?.href;
    if (!href) {
      throw new Error(
        `[evjs] Page "${request.pageId}" does not expose an importable runtime module.`,
      );
    }
    return {
      id: request.pageId,
      href,
      ctx: {
        id: request.pageId,
        kind: "page",
        manifest,
        output: page,
        request,
      },
    };
  }

  const remoteTarget = await resolveRemoteTarget(
    manifest,
    request,
    loadRemoteManifest,
    remoteManifestCache,
    warnedSharedRemotes,
    onWarning,
    sharedPolicy,
    onRemoteSharedNegotiated,
    sharedScope,
  );
  if (remoteTarget) return remoteTarget;

  const appId = request.appId ?? Object.keys(manifest.apps)[0];
  const app = appId ? manifest.apps[appId] : undefined;
  if (!appId || !app) {
    throw new Error("[evjs] No app target is available in the manifest.");
  }
  const href = app.module?.href;
  if (!href) {
    throw new Error(
      `[evjs] App "${appId}" does not expose an importable runtime module.`,
    );
  }
  return {
    id: appId,
    href,
    ctx: {
      id: appId,
      kind: "app",
      manifest,
      output: app,
      request,
    },
  };
}

async function resolveRemoteTarget(
  manifest: BuildOutput,
  request: ActivationRequest,
  loadRemoteManifest: ShellOptions["loadRemoteManifest"],
  remoteManifestCache: Map<string, Promise<RemoteManifest>>,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
): Promise<ResolvedShellTarget | undefined> {
  const pathname = getRequestPathname(request);
  const remoteId =
    request.remoteId ?? findRemoteIdForPath(manifest.remotes, pathname);
  if (!remoteId) return undefined;

  const remote = manifest.remotes?.[remoteId];
  if (!remote) {
    throw new Error(`[evjs] Remote "${remoteId}" is not in the manifest.`);
  }
  if (!loadRemoteManifest) {
    throw new Error("[evjs] No remote manifest loader is configured.");
  }

  let remoteManifestPromise = remoteManifestCache.get(remoteId);
  if (!remoteManifestPromise) {
    remoteManifestPromise = loadRemoteManifest(remote, {
      id: remoteId,
      request,
      manifest,
    }).catch((error) => {
      remoteManifestCache.delete(remoteId);
      throw error;
    });
    remoteManifestCache.set(remoteId, remoteManifestPromise);
  }

  const remoteManifest = await remoteManifestPromise;
  const shared = await negotiateRemoteSharedDependencies(
    remoteId,
    remoteManifest,
    request,
    warnedSharedRemotes,
    onWarning,
    sharedPolicy,
    onRemoteSharedNegotiated,
    sharedScope,
  );
  return resolveRemoteEntryTarget({
    hostManifest: manifest,
    remoteId,
    remoteManifest,
    request,
    shared,
    pathname,
  });
}

function resolveRemoteEntryTarget(options: {
  hostManifest: BuildOutput;
  remoteId: string;
  remoteManifest: RemoteManifest;
  request: ActivationRequest;
  shared: RemoteSharedResolution;
  pathname: string | undefined;
}): ResolvedShellTarget {
  const remote = options.hostManifest.remotes?.[options.remoteId];
  if (!remote) {
    throw new Error(
      `[evjs] Remote "${options.remoteId}" is not in the manifest.`,
    );
  }

  const entryId = resolveRemoteEntryId(
    options.remoteManifest,
    options.request,
    options.pathname,
  );
  const entry = options.remoteManifest.entries[entryId];
  const href = entry.module.href;
  if (!href) {
    throw new Error(
      `[evjs] Remote "${options.remoteId}" entry "${entryId}" does not expose an importable runtime module.`,
    );
  }

  return {
    id: `${options.remoteId}:${entryId}`,
    href: resolveRemoteHref(options.remoteManifest.baseUrl, href),
    ctx: {
      id: options.remoteId,
      kind: "remote",
      manifest: options.hostManifest,
      output: remote,
      request: options.request,
      remote: {
        id: options.remoteId,
        entryId,
        manifest: options.remoteManifest,
        entry,
        shared: options.shared,
      },
    },
  };
}
