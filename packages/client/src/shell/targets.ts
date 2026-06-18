import type { BuildOutput } from "@evjs/shared/manifest";
import { isRecord } from "../validation.js";
import type { ActivationRequest, ResolvedShellTarget } from "./types.js";

export async function resolveTarget(
  manifest: BuildOutput,
  request: ActivationRequest,
): Promise<ResolvedShellTarget> {
  if (request.pageId) {
    const page = manifest.pages[request.pageId];
    if (!page) {
      throw new Error(
        `[evjs] Page "${request.pageId}" is not in the manifest.`,
      );
    }
    const href = readRuntimeModuleHref(page.module, `Page "${request.pageId}"`);
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

  const appId = request.appId ?? Object.keys(manifest.apps)[0];
  const app = appId ? manifest.apps[appId] : undefined;
  if (!appId || !app) {
    throw new Error("[evjs] No app target is available in the manifest.");
  }
  const href = readRuntimeModuleHref(app.module, `App "${appId}"`);
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

function readRuntimeModuleHref(
  module: unknown,
  label: string,
): string | undefined {
  if (module === undefined) return undefined;
  if (!isRecord(module)) {
    throw new Error(`[evjs] ${label} runtime module must be an object.`);
  }

  const href = module.href;
  if (href === undefined) return undefined;
  if (typeof href !== "string" || !href.trim()) {
    throw new Error(
      `[evjs] ${label} runtime module href must be a non-empty string.`,
    );
  }
  if (href.trim() !== href) {
    throw new Error(
      `[evjs] ${label} runtime module href must not contain leading or trailing whitespace.`,
    );
  }
  return href;
}
