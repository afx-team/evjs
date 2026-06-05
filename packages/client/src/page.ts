import type { BuildOutput } from "@evjs/shared/manifest";
import {
  type AppContext,
  type AppModule,
  createPageDriver,
  createShell,
  type Shell,
} from "./shell.js";
import { initTransportFromManifest } from "./transport.js";

export interface PageRuntimeOptions {
  document?: Document;
  manifest?: BuildOutput;
  manifestUrl?: string;
  mount?: string | Element;
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
}

export async function startPageRuntime(
  options: PageRuntimeOptions = {},
): Promise<Shell> {
  const doc = options.document ?? globalThis.document;
  const request = createPageDriver({ document: doc }).current();
  const manifest = options.manifest ?? (await loadManifest(doc, options));
  initTransportFromManifest(manifest);
  const shell = createShell({
    manifest,
    loadModule: options.loadModule,
    resolveMountPoint(ctx) {
      return resolveMountPoint(doc, options.mount ?? outputMount(ctx));
    },
  });

  await shell.start(request);
  return shell;
}

async function loadManifest(
  document: Document,
  options: PageRuntimeOptions,
): Promise<BuildOutput> {
  const embedded = readEmbeddedManifest(document);
  if (embedded) return embedded;

  const manifestUrl =
    options.manifestUrl ??
    document.documentElement?.getAttribute("data-evjs-manifest") ??
    "/manifest.json";
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `[evjs] Failed to load manifest "${manifestUrl}": ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<BuildOutput>;
}

function readEmbeddedManifest(document: Document): BuildOutput | undefined {
  const script = document.getElementById("__EVJS_MANIFEST__");
  const text = script?.textContent?.trim();
  if (!text) return undefined;
  return JSON.parse(text) as BuildOutput;
}

function outputMount(ctx: AppContext): string {
  if (ctx.kind === "page" && "mount" in ctx.output && ctx.output.mount) {
    return ctx.output.mount;
  }
  if (
    ctx.kind === "remote" &&
    ctx.remote?.entry.mount &&
    typeof ctx.remote.entry.mount === "string"
  ) {
    return ctx.remote.entry.mount;
  }
  return "#app";
}

function resolveMountPoint(
  document: Document,
  mount: string | Element,
): Element | null {
  if (typeof mount !== "string") return mount;
  return document.querySelector(mount);
}
