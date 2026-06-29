import {
  type ClientRuntime,
  getClientRuntimePages,
} from "../runtime-config.js";
import { isRecord } from "../validation.js";
import type { ActivationRequest, ResolvedShellTarget } from "./types.js";

export async function resolveTarget(
  runtime: ClientRuntime,
  request: ActivationRequest,
): Promise<ResolvedShellTarget> {
  if (request.pageId) {
    const page = getClientRuntimePages(runtime)[request.pageId];
    if (!page) {
      throw new Error(`[evjs] Page "${request.pageId}" is not in the runtime.`);
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
        runtime,
        output: page,
        request,
      },
    };
  }

  const app = runtime.app;
  if (!app) {
    throw new Error("[evjs] No app target is available in the runtime.");
  }
  const id = request.appId ?? "default";
  const label = request.appId ? `App "${request.appId}"` : "App";
  const href = readRuntimeModuleHref(app.module, label);
  if (!href) {
    throw new Error(`${label} does not expose an importable runtime module.`);
  }
  return {
    id,
    href,
    ctx: {
      id,
      kind: "app",
      runtime,
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
